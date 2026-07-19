"""Email-verification service.

Deliberately a near-copy of ``password_reset.py``: same token table
(``invite_tokens`` via a ``purpose`` discriminator), same audience → origin
allowlist so a link can never be pointed at a client-supplied URL, same
best-effort Resend send. If you're changing one of these two modules, look at
the other.

What differs from password reset:

  * **TTL is days, not minutes.** A reset link is a live credential — short
    windows are a security property. A verification link only proves the
    recipient can read the inbox, and the realistic failure mode is somebody
    getting to their email tomorrow. 3 days by default.
  * **No session revocation on redeem.** Confirming an address doesn't change
    an authentication factor, so there's nothing to invalidate.
  * **Redeem is anonymous.** People click these from a phone while signed in
    on a laptop. The token *is* the proof; requiring a session would break
    the common case for no security gain.

Enumeration posture: minting is never triggered by an anonymous caller naming
an arbitrary address. Signup mints for the account it just created, and resend
requires a session and uses that session's user — so there's no oracle here to
probe, and the resend endpoint can safely give a real answer instead of the
deliberately-vague response ``/auth/forgot-password`` has to return.
"""
from __future__ import annotations

from datetime import timedelta
from urllib.parse import urlencode
from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.core.email import EmailError, send_email
from app.modules.auth.invite_repo import mint_invite, resolve_invite
from app.modules.auth.models import InviteToken

# ``purpose`` value written to invite_tokens for verification rows. Keeps
# them separable from invites and resets for audit, and gives each its own
# slot in the per-(user, purpose) partial unique index.
PURPOSE_EMAIL_VERIFICATION = "EMAIL_VERIFICATION"

# Allowlisted audiences → the frontend origin hosting the confirmation page.
# The client sends an audience string; we map it here. A raw URL from the
# client is never trusted (prevents open-redirect / phishing link abuse).
_AUDIENCE_ORIGINS: dict[str, str] = {
    "consumer": settings.CONSUMER_ORIGIN,
    "owner": settings.OWNER_PORTAL_ORIGIN,
    "admin": settings.ADMIN_PANEL_ORIGIN,
}

DEFAULT_AUDIENCE = "consumer"


def is_valid_audience(audience: str) -> bool:
    return audience in _AUDIENCE_ORIGINS


def build_verify_url(audience: str, token_plain: str) -> str:
    """Compose ``{origin}/verify-email?token=...`` for the audience.

    Caller must pass a validated audience (see ``is_valid_audience``).
    """
    origin = _AUDIENCE_ORIGINS[audience].rstrip("/")
    query = urlencode({"token": token_plain})
    return f"{origin}/verify-email?{query}"


def mint_verification_token(
    db: DbSession, *, user_id: UUID
) -> tuple[InviteToken, str]:
    """Create a live verification token and return ``(row, plaintext)``.

    ``mint_invite`` hard-deletes any prior live token for this
    (user, purpose) pair, so "resend" needs no extra handling: the previous
    link dies the moment a new one is issued, which is what a user expects
    when they press Resend.
    """
    return mint_invite(
        db,
        user_id=user_id,
        created_by_user_id=None,  # user-initiated / automatic on signup
        purpose=PURPOSE_EMAIL_VERIFICATION,
        ttl=timedelta(days=settings.EMAIL_VERIFICATION_TTL_DAYS),
    )


def resolve_verification_token(
    db: DbSession, *, token_plain: str
) -> InviteToken | None:
    """Return the live verification token for ``token_plain``, else None."""
    return resolve_invite(
        db, token_plain=token_plain, purpose=PURPOSE_EMAIL_VERIFICATION
    )


def send_verification_email(
    *, to: str, display_name: str | None, verify_url: str
) -> None:
    """Send the confirmation email.

    Best-effort at every call site: a Resend outage must not fail a signup
    that otherwise succeeded. The user can always press Resend.
    """
    send_email(
        to=to,
        subject="Confirm your email for Trust Halal",
        template="verify_email",
        context={
            "preheader": "Confirm your email address to finish setting up Trust Halal.",
            "display_name": display_name or "",
            "verify_url": verify_url,
            "ttl_days": settings.EMAIL_VERIFICATION_TTL_DAYS,
        },
    )


def _send_quietly(*, to: str, display_name: str | None, verify_url: str) -> None:
    """Send, swallowing transport errors.

    Runs as a background task, i.e. after the response has been returned —
    so raising here would produce an unhandled exception in the task runner
    and no user-visible benefit. ``send_email`` already logs, and it's a
    no-op when RESEND_API_KEY is unset.
    """
    try:
        send_verification_email(
            to=to, display_name=display_name, verify_url=verify_url
        )
    except EmailError:
        pass


def issue_verification_email(
    db: DbSession,
    background: BackgroundTasks,
    *,
    user_id: UUID,
    email: str,
    display_name: str | None,
    audience: str = DEFAULT_AUDIENCE,
) -> None:
    """Mint a token and queue the confirmation email. Never raises.

    The single entry point for both signup paths and the resend endpoint, so
    the "validate audience, mint, build URL, send" sequence exists once.

    Two deliberate properties:

    * **Token minting is synchronous, sending is not.** The row is flushed
      inside the caller's transaction, so if anything later in the request
      fails, the token rolls back with it rather than leaving a live link
      for a user that was never created. The Resend call is a network
      round-trip and goes to ``BackgroundTasks`` — signup must not block on
      a third party's latency, and a Resend outage must not fail an
      otherwise-good signup.
    * **An unknown audience falls back rather than raising.** These strings
      come from clients; a typo shouldn't 500 a signup, and an attacker
      shouldn't be able to steer the link off-origin.
    """
    if not is_valid_audience(audience):
        audience = DEFAULT_AUDIENCE

    _row, plaintext = mint_verification_token(db, user_id=user_id)
    verify_url = build_verify_url(audience, plaintext)

    background.add_task(
        _send_quietly,
        to=email,
        display_name=display_name,
        verify_url=verify_url,
    )


__all__ = [
    "PURPOSE_EMAIL_VERIFICATION",
    "DEFAULT_AUDIENCE",
    "EmailError",
    "build_verify_url",
    "is_valid_audience",
    "issue_verification_email",
    "mint_verification_token",
    "resolve_verification_token",
    "send_verification_email",
]
