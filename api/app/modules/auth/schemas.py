from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.users.enums import UserRole


class LoginRequest(BaseModel):
    """POST /auth/login body."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str


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
    password: str = Field(..., min_length=8, max_length=256)


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
