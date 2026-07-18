"""Notification dispatch — the single chokepoint for outbound user-facing
notifications.

v1 is email-only (via ``send_email``). Every product notification goes
through ``notify(...)`` rather than calling ``send_email`` directly, so that
preferences, unsubscribe links, and observability are enforced in one place —
and so adding an in-app feed / push later means teaching *this* function a new
channel, not editing every call site.

Design:
  * Notifications default ON. A row in ``notification_unsubscribes`` means the
    user opted OUT of that category.
  * ``MANDATORY_CATEGORIES`` are transactional (claim decisions, disputes,
    verifier outcomes) — always sent, no unsubscribe link. Only softer,
    promotional-ish categories (a saved place becoming verified) are
    opt-outable and carry an unsubscribe link.
  * Sends run in a FastAPI ``BackgroundTask`` so the triggering request isn't
    blocked, and a Resend outage can't fail the underlying action.
  * Unsubscribe links are stateless HMAC-signed tokens — no token table.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from enum import StrEnum
from urllib.parse import urlencode
from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.config import settings
from app.core.email import EmailError, send_email
from app.core.push import deliver as deliver_push
from app.core.push import tokens_for_user
from app.modules.notifications.models import (
    NotificationChannel,
    NotificationUnsubscribe,
)

logger = logging.getLogger(__name__)


class NotificationCategory(StrEnum):
    CLAIM_DECISION = "CLAIM_DECISION"
    DISPUTE = "DISPUTE"
    VERIFIER = "VERIFIER"
    PLACE_VERIFIED = "PLACE_VERIFIED"


# Transactional categories: the user needs these regardless of preferences
# (they're about actions on their own account/place), so they're always sent
# and carry no unsubscribe link. Everything else is opt-outable.
MANDATORY_CATEGORIES: frozenset[str] = frozenset(
    {
        NotificationCategory.CLAIM_DECISION,
        NotificationCategory.DISPUTE,
        NotificationCategory.VERIFIER,
    }
)


# ---------------------------------------------------------------------------
# Unsubscribe tokens (stateless, HMAC-signed)
# ---------------------------------------------------------------------------


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload: str) -> str:
    sig = hmac.new(
        settings.NOTIFICATION_UNSUBSCRIBE_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return _b64(sig)


def make_unsubscribe_token(user_id: UUID, category: str) -> str:
    payload = f"{user_id}:{category}"
    return f"{_b64(payload.encode('utf-8'))}.{_sign(payload)}"


def verify_unsubscribe_token(token: str) -> tuple[UUID, str] | None:
    """Return ``(user_id, category)`` if the token is valid, else None."""
    try:
        body_b64, sig = token.split(".", 1)
        payload = _unb64(body_b64).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    try:
        user_str, category = payload.split(":", 1)
        return UUID(user_str), category
    except (ValueError, AttributeError):
        return None


def build_unsubscribe_url(user_id: UUID, category: str) -> str:
    token = make_unsubscribe_token(user_id, category)
    base = settings.API_PUBLIC_BASE_URL.rstrip("/")
    return f"{base}/notifications/unsubscribe?{urlencode({'token': token})}"


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


def is_unsubscribed(
    db: Session,
    *,
    user_id: UUID,
    category: str,
    channel: str = NotificationChannel.EMAIL,
) -> bool:
    row = db.execute(
        select(NotificationUnsubscribe.user_id).where(
            NotificationUnsubscribe.user_id == user_id,
            NotificationUnsubscribe.category == category,
            NotificationUnsubscribe.channel == channel,
        )
    ).first()
    return row is not None


def unsubscribe(
    db: Session,
    *,
    user_id: UUID,
    category: str,
    channel: str = NotificationChannel.EMAIL,
) -> None:
    """Idempotently opt a user out of a category on one channel."""
    if is_unsubscribed(db, user_id=user_id, category=category, channel=channel):
        return
    db.add(
        NotificationUnsubscribe(
            user_id=user_id, category=category, channel=channel
        )
    )
    db.commit()


def resubscribe(
    db: Session,
    *,
    user_id: UUID,
    category: str,
    channel: str = NotificationChannel.EMAIL,
) -> None:
    """Idempotently opt a user back IN to a category on one channel."""
    db.execute(
        delete(NotificationUnsubscribe).where(
            NotificationUnsubscribe.user_id == user_id,
            NotificationUnsubscribe.category == category,
            NotificationUnsubscribe.channel == channel,
        )
    )
    db.commit()


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


def _send_safe(*, to: str, subject: str, template: str, context: dict) -> None:
    try:
        send_email(to=to, subject=subject, template=template, context=context)
    except EmailError as exc:
        # Best-effort: the triggering action already committed. Log and move on.
        logger.warning("[notifications] send failed: %s", exc)


def notify(
    background: BackgroundTasks,
    *,
    db: Session,
    user_id: UUID,
    email: str,
    display_name: str | None,
    category: NotificationCategory | str,
    subject: str,
    template: str,
    context: dict,
    push_title: str | None = None,
    push_body: str | None = None,
    push_data: dict | None = None,
) -> bool:
    """Dispatch one notification across every channel the user allows.

    Returns True if anything was scheduled, False if fully suppressed.

    Channels:
      * **Email** — always, unless the category is opt-outable AND the user
        opted out of it on the EMAIL channel.
      * **Push** — only when the caller supplies ``push_title``/``push_body``
        (i.e. the event is meaningful on a phone), the user has a registered
        device, and they haven't opted out on the PUSH channel.

    Note the asymmetry: ``MANDATORY_CATEGORIES`` forces *email* through
    (transactional receipts you can't unsubscribe from), but push is ALWAYS
    opt-outable. A buzzing phone is far more intrusive than an inbox row, and
    "keep emailing me but stop pushing" is the request that shows up the day
    after push ships.

    Both sends run in ``background`` so the caller's request/txn isn't blocked
    and an outage at Resend or Expo can't fail the underlying action. Token
    lookup happens synchronously here because the request's DB session is gone
    by the time the background task runs.
    """
    category = str(category)
    mandatory = category in MANDATORY_CATEGORIES
    scheduled = False

    # --- Email -------------------------------------------------------------
    email_suppressed = not mandatory and is_unsubscribed(
        db, user_id=user_id, category=category, channel=NotificationChannel.EMAIL
    )
    if not email_suppressed:
        ctx = dict(context)
        ctx.setdefault("display_name", display_name or "")
        ctx["unsubscribe_url"] = (
            None if mandatory else build_unsubscribe_url(user_id, category)
        )
        background.add_task(
            _send_safe, to=email, subject=subject, template=template, context=ctx
        )
        track(
            "notification_sent",
            distinct_id=str(user_id),
            properties={
                "category": category,
                "template": template,
                "channel": NotificationChannel.EMAIL,
            },
        )
        scheduled = True

    # --- Push --------------------------------------------------------------
    if push_title and push_body:
        push_suppressed = is_unsubscribed(
            db, user_id=user_id, category=category, channel=NotificationChannel.PUSH
        )
        if not push_suppressed:
            tokens = tokens_for_user(db, user_id)
            if tokens:
                background.add_task(
                    deliver_push,
                    tokens=tokens,
                    title=push_title,
                    body=push_body,
                    data=push_data or {},
                )
                track(
                    "notification_sent",
                    distinct_id=str(user_id),
                    properties={
                        "category": category,
                        "template": template,
                        "channel": NotificationChannel.PUSH,
                    },
                )
                scheduled = True

    return scheduled
