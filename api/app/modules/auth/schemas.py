from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.password_policy import NewPassword
from app.modules.users.enums import UserRole


class MeResponse(BaseModel):
    """GET /me response.

    Adds ``display_name`` + ``email`` on top of the bare id+role pair
    so clients can render "Signed in as <name>" without a second
    roundtrip. ``display_name`` is nullable — legacy admin-invited
    users may have NULL there. ``email`` is required for any active
    user, but typed Optional for symmetry with the User model column.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: UserRole
    display_name: str | None = None
    email: EmailStr | None = None
    # Lets a client show the "confirm your email" prompt before the user
    # writes a whole review and gets refused at submit. Sourced from the
    # timestamp column; the timestamp itself isn't exposed because no client
    # needs it and it's noise in the payload.
    email_verified: bool = False


class LoginRequest(BaseModel):
    """POST /auth/login body."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    # Bounded so a multi-megabyte password can't amplify the per-request
    # Argon2 verify cost into a cheap DoS. 256 mirrors signup/set-password.
    password: str = Field(..., max_length=256)


class LoginResponse(BaseModel):
    """POST /auth/login response.

    ``redirect_path`` is computed server-side per user role so the admin
    panel, future owner dashboard, etc. land the user in the right
    place without hard-coding role-aware routing on every client.
    """

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: EmailStr
    role: UserRole
    display_name: str | None = None
    redirect_path: str


class InviteInfoResponse(BaseModel):
    """Prefetch response for GET /auth/invite/{token}.

    The set-password page calls this to render "Set your password for
    <email>" before the user submits. We expose the minimum identifying
    info (email + display_name) and nothing else — no role, no user id,
    no created-at — so the endpoint can't be used as an oracle for
    enumerating the user table.
    """

    model_config = ConfigDict(from_attributes=True)

    email: EmailStr
    display_name: str | None = None


class SetPasswordRequest(BaseModel):
    """POST /auth/set-password body.

    ``password`` minimum is 8 characters to match the login flow's
    current expectation. No max-complexity rules right now — we can
    layer a zxcvbn check later if the risk profile warrants it.
    """

    model_config = ConfigDict(extra="forbid")

    token: str = Field(..., min_length=16, max_length=128)
    password: NewPassword


class SetPasswordResponse(BaseModel):
    """POST /auth/set-password response.

    Returns the same shape as LoginResponse — setting a password via
    invite auto-logs the user in, so the client treats the two
    responses identically: store whatever ``/me`` cache is needed and
    route to ``redirect_path``.
    """

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: EmailStr
    role: UserRole
    display_name: str | None = None
    redirect_path: str


class SignupRequest(BaseModel):
    """POST /auth/signup body.

    Two public surfaces use this endpoint: the owner portal (role
    defaults to OWNER) and the consumer site (passes
    ``role=CONSUMER``). The trust gate is the human-reviewed
    ownership claim downstream of OWNER signup, not the signup
    itself, so the endpoint stays light.

    ``role`` is restricted to OWNER and CONSUMER — promotion to
    ADMIN or VERIFIER stays an admin-only operation via the user
    CRUD endpoints. The router rejects other values defensively
    even though Pydantic validates the literal here.

    ``display_name`` is required (unlike on the User model) so admin
    staff reviewing claims, and restaurant owners reviewing
    disputes, see a human-readable name instead of just an email.
    Length matches the column (120 chars).

    ``password`` minimum mirrors the invite ``SetPasswordRequest`` —
    8 chars, no max-complexity rules. zxcvbn-style scoring can layer
    on later if abuse warrants it.
    """

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: NewPassword
    display_name: str = Field(..., min_length=1, max_length=120)
    role: Literal[UserRole.OWNER, UserRole.CONSUMER] = Field(
        default=UserRole.OWNER,
        description=(
            "Public-signup role. Defaults to OWNER for backward "
            "compatibility with the owner portal; the consumer site "
            "passes CONSUMER explicitly."
        ),
    )


class SignupResponse(BaseModel):
    """POST /auth/signup response.

    Same shape as LoginResponse — signup auto-logs the user in via the
    session cookie, so clients treat the two endpoints identically: read
    /me, route to ``redirect_path``.
    """

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: EmailStr
    role: UserRole
    display_name: str | None = None
    redirect_path: str


# ---------------------------------------------------------------------------
# Self-service password reset (POST /auth/forgot-password, /auth/reset-password)
# ---------------------------------------------------------------------------


class ForgotPasswordRequest(BaseModel):
    """POST /auth/forgot-password body.

    ``audience`` picks which frontend hosts the reset page the email
    links to (consumer / owner / admin). The API maps it to a configured
    origin from an allowlist — a raw URL is never accepted. Mobile passes
    ``consumer`` (its reset happens on the consumer web page).
    """

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    audience: Literal["consumer", "owner", "admin"] = "consumer"


class ForgotPasswordResponse(BaseModel):
    """Deliberately generic — identical whether or not the email matches
    an account, so the endpoint can't be used to enumerate users."""

    ok: Literal[True] = True
    message: str = (
        "If an account exists for that email, a reset link is on its way."
    )


class ResetInfoResponse(BaseModel):
    """Prefetch for GET /auth/reset/{token} — lets the reset page show
    whose password is being reset. Gated behind a valid single-use token,
    so exposing the email here is safe (only the link holder sees it)."""

    model_config = ConfigDict(from_attributes=True)

    email: EmailStr
    display_name: str | None = None


class ResetPasswordRequest(BaseModel):
    """POST /auth/reset-password body. ``password`` bounds mirror
    signup / set-password (8–256)."""

    model_config = ConfigDict(extra="forbid")

    token: str = Field(..., min_length=16, max_length=128)
    password: NewPassword


class ResetPasswordResponse(BaseModel):
    """No auto-login on reset (unlike invite set-password): the user is
    routed to the login page to sign in with the new password. Returns the
    email so the client can prefill the login form."""

    model_config = ConfigDict(from_attributes=True)

    email: EmailStr


# ---------------------------------------------------------------------------
# Email verification (POST /auth/verify-email*)
# ---------------------------------------------------------------------------


class VerifyEmailRequest(BaseModel):
    """POST /auth/verify-email body. Anonymous — the token is the proof.

    People click these from a phone while signed in on a laptop, so requiring
    a session would break the common case for no security gain.
    """

    model_config = ConfigDict(extra="forbid")

    token: str = Field(..., min_length=16, max_length=128)


class VerifyEmailResponse(BaseModel):
    """Returns the confirmed address so the landing page can say which one,
    and ``already_verified`` so a second click on the same link reads as
    "you're all set" rather than an error."""

    model_config = ConfigDict(from_attributes=True)

    email: EmailStr
    already_verified: bool = False


class ResendVerificationRequest(BaseModel):
    """POST /auth/verify-email/resend body.

    Authenticated — the address is taken from the session, never the body.
    That's what keeps this endpoint from being an enumeration oracle, and
    it's why (unlike forgot-password) it can return an honest answer.
    """

    model_config = ConfigDict(extra="forbid")

    audience: str = Field(default="consumer", max_length=32)


class ResendVerificationResponse(BaseModel):
    """``sent=False`` means the address was already confirmed — not a
    failure, and the client should say so rather than showing an error."""

    model_config = ConfigDict(from_attributes=True)

    sent: bool
    email: EmailStr


# ---------------------------------------------------------------------------
# Mobile bearer-token auth (POST /auth/mobile/*)
# ---------------------------------------------------------------------------


class MobileUser(BaseModel):
    """The user object embedded in every mobile auth response.

    Same fields the web reads off /me — the app renders "signed in as
    <name>" and gates verifier surfaces on ``role`` without a second
    round trip.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    role: UserRole
    display_name: str | None = None


class MobileAuthResponse(BaseModel):
    """Login / signup / refresh all return the same envelope.

    ``expires_in`` is the ACCESS token TTL in seconds — the client
    schedules a refresh slightly ahead of it. The refresh token's own
    (30-day) expiry is deliberately not surfaced; the client treats a
    failed refresh as "sign in again."
    """

    model_config = ConfigDict(extra="forbid")

    user: MobileUser
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class MobileSignupRequest(BaseModel):
    """POST /auth/mobile/signup body.

    Mobile-only surface, so unlike the web ``SignupRequest`` there is
    no ``role`` field — the app mints CONSUMER accounts, full stop.
    Owners and staff use the web portals.
    """

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: NewPassword
    display_name: str = Field(..., min_length=1, max_length=120)


class MobileRefreshRequest(BaseModel):
    """POST /auth/mobile/refresh + /auth/mobile/logout body."""

    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(..., min_length=16, max_length=512)
