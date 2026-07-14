"""Self-service password-reset service.

Reuses the ``invite_tokens`` table via ``purpose="PASSWORD_RESET"`` — the
model was explicitly designed for this (see InviteToken docstring), so no
new table is needed. This module layers the reset-specific concerns on top
of ``invite_repo``:

  * a short (config-driven) TTL, distinct from the 7-day invite,
  * audience → origin routing so the email link lands on the right domain
    (consumer / owner / admin) from an allowlist — never a client URL,
  * the reset email itself.

Security-sensitive behaviors (silent response on unknown emails, session +
mobile-token revocation on redeem) live in the router endpoints, not here.
"""
from __future__ import annotations

from datetime import timedelta
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.email import EmailError, send_email
from app.modules.auth.invite_repo import mint_invite, resolve_invite
from app.modules.auth.models import InviteToken

# ``purpose`` value written to invite_tokens for reset rows. Keeps them
# cleanly separable from onboarding invites for audit + the per-purpose
# "one live token" partial unique index.
PURPOSE_PASSWORD_RESET = "PASSWORD_RESET"

# Allowlisted audiences → the frontend origin that hosts the reset page.
# The client sends an audience string; we map it here. A raw URL from the
# client is never trusted (prevents open-redirect / phishing link abuse).
_AUDIENCE_ORIGINS: dict[str, str] = {
    "consumer": settings.CONSUMER_ORIGIN,
    "owner": settings.OWNER_PORTAL_ORIGIN,
    "admin": settings.ADMIN_PANEL_ORIGIN,
}


def is_valid_audience(audience: str) -> bool:
    return audience in _AUDIENCE_ORIGINS


def build_reset_url(audience: str, token_plain: str) -> str:
    """Compose ``{origin}/reset-password?token=...`` for the audience.

    Caller must pass a validated audience (see ``is_valid_audience``).
    """
    origin = _AUDIENCE_ORIGINS[audience].rstrip("/")
    query = urlencode({"token": token_plain})
    return f"{origin}/reset-password?{query}"


def mint_reset_token(db: DbSession, *, user_id: UUID) -> tuple[InviteToken, str]:
    """Create a live reset token (revoking any prior one) and return
    ``(row, plaintext)``. TTL from ``PASSWORD_RESET_TTL_MINUTES``."""
    return mint_invite(
        db,
        user_id=user_id,
        created_by_user_id=None,  # user-initiated; no admin actor
        purpose=PURPOSE_PASSWORD_RESET,
        ttl=timedelta(minutes=settings.PASSWORD_RESET_TTL_MINUTES),
    )


def resolve_reset_token(db: DbSession, *, token_plain: str) -> InviteToken | None:
    """Return the live reset token for ``token_plain``, else None."""
    return resolve_invite(
        db, token_plain=token_plain, purpose=PURPOSE_PASSWORD_RESET
    )


def send_password_reset_email(
    *, to: str, display_name: str | None, reset_url: str
) -> None:
    """Send the reset email. Best-effort: a Resend failure is swallowed by
    the caller so the response stays generic (no enumeration signal)."""
    ttl_minutes = settings.PASSWORD_RESET_TTL_MINUTES
    send_email(
        to=to,
        subject="Reset your Trust Halal password",
        template="password_reset",
        context={
            "preheader": "Reset your Trust Halal password",
            "display_name": display_name or "",
            "reset_url": reset_url,
            "ttl_minutes": ttl_minutes,
        },
    )


# Re-exported so the router can catch it around the best-effort send.
__all__ = [
    "PURPOSE_PASSWORD_RESET",
    "EmailError",
    "build_reset_url",
    "is_valid_audience",
    "mint_reset_token",
    "resolve_reset_token",
    "send_password_reset_email",
]
