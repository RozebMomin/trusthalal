from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.users.enums import UserRole


class UserAdminCreate(BaseModel):
    email: EmailStr
    role: UserRole = UserRole.CONSUMER
    display_name: str | None = Field(default=None, max_length=120)


class UserAdminPatch(BaseModel):
    role: UserRole | None = None
    display_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class UserAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    role: UserRole
    display_name: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserAdminCreateResponse(BaseModel):
    """Response shape for ``POST /admin/users``.

    Extends the plain ``UserAdminRead`` with the fields the admin needs
    to actually onboard the invited user:

      * ``invite_token`` — the raw, never-stored plaintext. Shown
        exactly once in this response; there is no endpoint to fetch it
        again. The admin copies it or the pre-baked URL from this
        payload and shares it however makes sense for their flow.
      * ``invite_url`` — ``ADMIN_PANEL_ORIGIN`` + ``/set-password?token=…``
        so the admin doesn't have to compose the URL themselves.
      * ``invite_expires_at`` — exposes the TTL the server applied,
        both to show in the UI and so the copy-to-clipboard pane can
        say "valid until X."

    Backward-compatible: existing callers that typed the response as
    ``UserAdminRead`` still see every field they were reading, because
    this model extends (not replaces) that shape.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    role: UserRole
    display_name: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    invite_token: str
    invite_url: str
    invite_expires_at: datetime


class UserOrganizationSummary(BaseModel):
    """Compact org summary nested inside a user's membership row.

    Just enough for the "Organizations" section on the admin user detail
    page to link to the org and name it — keeps the response payload
    small since a user can be in several orgs.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    contact_email: str | None = None


class UserOrganizationMembershipRead(BaseModel):
    """One ``organization_members`` row belonging to a user, with the
    org summary nested inline.

    Includes REMOVED memberships — the admin UI can choose to show or
    hide them, but historical context matters when triaging a support
    case ("they left Acme three months ago").
    """

    model_config = ConfigDict(from_attributes=False)

    id: UUID
    role: str
    status: str
    created_at: datetime
    updated_at: datetime
    organization: UserOrganizationSummary
