"""Expo push delivery.

Callers go through ``app.core.notifications.notify`` rather than here — that's
where preferences and channel policy live. This module only knows how to get
bytes to a phone.

Why Expo's service rather than APNs/FCM directly: the app ships through EAS,
so Expo already holds the APNs key and FCM credentials. One HTTP call, one
token format, no per-platform payload juggling in the API.

Threading model
---------------
``tokens_for_user`` runs synchronously inside the request (same rule the
notification event helpers follow), and ``deliver`` runs in a FastAPI
BackgroundTask *after* the response — by which point the request's DB session
is closed. So ``deliver`` opens its own short-lived session, and only when it
actually has dead tokens to prune.

Dead-token pruning
------------------
Expo returns a per-message *ticket*. ``details.error == "DeviceNotRegistered"``
means the app was uninstalled or the token rotated, so we delete that row
rather than retrying it forever. Every other failure is logged and dropped: a
push is best-effort and must never fail the action that triggered it.

``EXPO_ACCESS_TOKEN`` is optional — Expo only requires it when a project turns
on "enhanced security" — but we send it when present.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.notifications.models import DeviceToken

logger = logging.getLogger(__name__)

_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Expo accepts up to 100 messages per request.
_BATCH_SIZE = 100
_TIMEOUT_SECONDS = 10.0


def tokens_for_user(db: Session, user_id: UUID) -> list[str]:
    """Every Expo push token registered to this user. Call inside the request."""
    rows = (
        db.execute(select(DeviceToken.token).where(DeviceToken.user_id == user_id))
        .scalars()
        .all()
    )
    return list(rows)


def _prune(dead: list[str]) -> None:
    """Delete unregistered tokens using a fresh session (we're post-response)."""
    if not dead:
        return
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        db.execute(delete(DeviceToken).where(DeviceToken.token.in_(dead)))
        db.commit()
        logger.info("[push] pruned %d unregistered device token(s)", len(dead))
    except Exception as exc:  # never surface from a background task
        db.rollback()
        logger.warning("[push] prune failed: %s", exc)
    finally:
        db.close()


def deliver(
    *,
    tokens: list[str],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> int:
    """Push one message to each token. Returns how many Expo accepted.

    Never raises — this runs as a background task after the triggering action
    already committed.
    """
    if not tokens:
        return 0

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "data": data or {},
            "sound": "default",
            # Matches the Android channel the app creates on boot.
            "channelId": "default",
        }
        for token in tokens
    ]

    headers = {"Content-Type": "application/json"}
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"

    accepted = 0
    dead: list[str] = []

    for start in range(0, len(messages), _BATCH_SIZE):
        batch = messages[start : start + _BATCH_SIZE]
        try:
            with httpx.Client(timeout=_TIMEOUT_SECONDS) as client:
                resp = client.post(_EXPO_PUSH_URL, json=batch, headers=headers)
                resp.raise_for_status()
                tickets = resp.json().get("data") or []
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("[push] batch send failed: %s", exc)
            continue

        # Tickets come back positionally aligned with the batch we sent.
        for msg, ticket in zip(batch, tickets):
            if not isinstance(ticket, dict):
                continue
            if ticket.get("status") == "ok":
                accepted += 1
                continue
            error = (ticket.get("details") or {}).get("error")
            if error == "DeviceNotRegistered":
                dead.append(msg["to"])
            else:
                logger.warning(
                    "[push] ticket error for token=%s: %s",
                    msg["to"][:24],
                    ticket.get("message") or error,
                )

    _prune(dead)
    return accepted
