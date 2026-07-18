"""One-click unsubscribe endpoints for notification emails.

Two-step by design: the link in the email is a GET that renders a small
confirmation page with a button; the button POSTs to actually unsubscribe.
This keeps email-client link *prefetching* from silently unsubscribing
people (a real problem with single-GET unsubscribe links).

Served as self-contained HTML by the API so no frontend page is needed.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Form, Response, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.core.exceptions import BadRequestError
from app.core.notifications import (
    MANDATORY_CATEGORIES,
    NotificationCategory,
    resubscribe,
    unsubscribe,
    verify_unsubscribe_token,
)
from app.db.deps import get_db
from app.modules.notifications.models import (
    DeviceToken,
    NotificationChannel,
    NotificationUnsubscribe,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])

_CATEGORY_LABELS = {
    "PLACE_VERIFIED": "updates when a place you saved becomes verified",
    "CLAIM_DECISION": "halal-claim decision emails",
    "DISPUTE": "dispute emails",
    "VERIFIER": "verifier emails",
}


def _page(title: str, body: str, *, status: int = 200) -> HTMLResponse:
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f6f7;margin:0;padding:48px 16px;color:#1a1a1a;">
  <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #ececef;border-radius:12px;padding:28px;">
    {body}
  </div>
</body></html>"""
    return HTMLResponse(content=html, status_code=status)


_INVALID = _page(
    "Link expired",
    "<h1 style='font-size:20px;margin:0 0 10px;'>This link is no longer valid</h1>"
    "<p style='color:#555;margin:0;'>The unsubscribe link is malformed or has "
    "expired. You can manage email preferences from your account settings.</p>",
    status=400,
)


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe_landing(token: str) -> HTMLResponse:
    parsed = verify_unsubscribe_token(token)
    if parsed is None:
        return _INVALID
    _, category = parsed
    label = _CATEGORY_LABELS.get(category, "these emails")
    body = (
        "<h1 style='font-size:20px;margin:0 0 10px;'>Unsubscribe?</h1>"
        f"<p style='color:#555;margin:0 0 20px;'>Stop receiving {label}?</p>"
        '<form method="post" action="/notifications/unsubscribe">'
        f'<input type="hidden" name="token" value="{token}">'
        '<button type="submit" style="background:#6f8b3e;color:#fff;border:0;'
        'font-weight:600;padding:11px 20px;border-radius:8px;cursor:pointer;">'
        "Yes, unsubscribe</button></form>"
    )
    return _page("Unsubscribe", body)


@router.post("/unsubscribe", response_class=HTMLResponse)
def unsubscribe_confirm(
    token: str = Form(...),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    parsed = verify_unsubscribe_token(token)
    if parsed is None:
        return _INVALID
    user_id, category = parsed
    # Email-link unsubscribes only ever silence EMAIL — a user clicking
    # "stop these emails" hasn't asked us to stop pushing to their phone.
    unsubscribe(
        db, user_id=user_id, category=category, channel=NotificationChannel.EMAIL
    )
    return _page(
        "Unsubscribed",
        "<h1 style='font-size:20px;margin:0 0 10px;'>You're unsubscribed</h1>"
        "<p style='color:#555;margin:0;'>You won't get these emails anymore. "
        "You can still manage all preferences from your account settings.</p>",
    )


# ---------------------------------------------------------------------------
# /me — push device registration + per-channel preferences (mobile app)
# ---------------------------------------------------------------------------

me_router = APIRouter(prefix="/me", tags=["notifications"])


class DeviceRegisterRequest(BaseModel):
    """Expo push token from the mobile app."""

    token: str = Field(..., min_length=8, max_length=255)
    platform: Literal["ios", "android"]


class DeviceRegisterResponse(BaseModel):
    registered: bool


@me_router.post(
    "/devices",
    response_model=DeviceRegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register this device for push notifications",
    description=(
        "Idempotent upsert keyed on the Expo push token. Re-registering the "
        "same token refreshes ``last_seen_at``; a token that moved to a "
        "different account (shared phone, or a sign-out/sign-in) is reassigned "
        "to the caller so the previous user stops receiving that device's "
        "pushes."
    ),
)
def register_device(
    payload: DeviceRegisterRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DeviceRegisterResponse:
    existing = db.execute(
        select(DeviceToken).where(DeviceToken.token == payload.token)
    ).scalar_one_or_none()

    if existing is None:
        db.add(
            DeviceToken(
                user_id=user.id,
                token=payload.token,
                platform=payload.platform,
            )
        )
    else:
        existing.user_id = user.id
        existing.platform = payload.platform
        existing.last_seen_at = datetime.now(timezone.utc)
        db.add(existing)

    db.commit()
    return DeviceRegisterResponse(registered=True)


@me_router.delete(
    "/devices/{token}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unregister this device (called on sign-out)",
    description=(
        "Deletes the token so the device stops receiving pushes for this "
        "account. Scoped to the caller's own tokens. Idempotent — unregistering "
        "an unknown token is a no-op 204 rather than a 404, so a sign-out never "
        "fails on a token we already pruned."
    ),
)
def unregister_device(
    token: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    db.execute(
        delete(DeviceToken).where(
            DeviceToken.token == token,
            DeviceToken.user_id == user.id,
        )
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class NotificationPreference(BaseModel):
    category: str
    email: bool
    push: bool


class NotificationPreferencesResponse(BaseModel):
    preferences: list[NotificationPreference]


class NotificationPreferenceUpdate(BaseModel):
    category: str
    channel: Literal["EMAIL", "PUSH"]
    enabled: bool


@me_router.get(
    "/notification-preferences",
    response_model=NotificationPreferencesResponse,
    summary="Per-category, per-channel notification preferences",
    description=(
        "Everything defaults ON. Transactional categories can't be silenced on "
        "email (``email`` stays true) but can always be silenced on push."
    ),
)
def get_notification_preferences(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> NotificationPreferencesResponse:
    rows = db.execute(
        select(
            NotificationUnsubscribe.category, NotificationUnsubscribe.channel
        ).where(NotificationUnsubscribe.user_id == user.id)
    ).all()
    opted_out = {(c, ch) for c, ch in rows}

    prefs = [
        NotificationPreference(
            category=str(cat),
            # Mandatory categories always deliver by email regardless of rows.
            email=(
                True
                if str(cat) in MANDATORY_CATEGORIES
                else (str(cat), NotificationChannel.EMAIL) not in opted_out
            ),
            push=(str(cat), NotificationChannel.PUSH) not in opted_out,
        )
        for cat in NotificationCategory
    ]
    return NotificationPreferencesResponse(preferences=prefs)


@me_router.put(
    "/notification-preferences",
    response_model=NotificationPreferencesResponse,
    summary="Turn one category/channel on or off",
    description=(
        "Rejects attempts to disable EMAIL on a transactional category — those "
        "are receipts for actions on the user's own account. PUSH is always "
        "toggleable."
    ),
)
def update_notification_preference(
    payload: NotificationPreferenceUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> NotificationPreferencesResponse:
    valid = {str(c) for c in NotificationCategory}
    if payload.category not in valid:
        raise BadRequestError(
            "NOTIFICATION_CATEGORY_UNKNOWN",
            f"Unknown category. Expected one of {sorted(valid)}.",
        )
    if (
        payload.channel == NotificationChannel.EMAIL
        and payload.category in MANDATORY_CATEGORIES
        and not payload.enabled
    ):
        raise BadRequestError(
            "NOTIFICATION_CATEGORY_MANDATORY",
            "This category is transactional — email can't be turned off. "
            "You can still disable push for it.",
        )

    if payload.enabled:
        resubscribe(
            db,
            user_id=user.id,
            category=payload.category,
            channel=payload.channel,
        )
    else:
        unsubscribe(
            db,
            user_id=user.id,
            category=payload.category,
            channel=payload.channel,
        )
    return get_notification_preferences(db=db, user=user)
