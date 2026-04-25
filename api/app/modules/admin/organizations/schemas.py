from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class OrganizationAdminCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr | None = None


class OrganizationAdminPatch(BaseModel):
    """Partial update for an organization.

    Omitted fields are left alone (not cleared). ``contact_email`` accepts
    either an EmailStr or explicit null — null means "remove the contact
    email", absent means "don't touch".
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    contact_email: EmailStr | None = None


class OrganizationAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    contact_email: str | None
    created_at: datetime
    updated_at: datetime


class OrganizationMemberAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    user_id: UUID
    role: str
    status: str
    created_at: datetime
    updated_at: datetime


class OrganizationDetailRead(OrganizationAdminRead):
    members: list[OrganizationMemberAdminRead] = Field(default_factory=list)


class MemberAdminCreate(BaseModel):
    user_id: UUID
    role: str = Field(default="OWNER_ADMIN", max_length=50)


class OrganizationPlaceSummary(BaseModel):
    """Compact place view nested inside an org's place-owner row.

    Smaller than PlaceAdminRead on purpose — the org detail page just
    needs enough to identify the place, link to its detail, and badge
    a soft-deleted row distinctly. City + country_code let admins
    quickly scan which region a given org operates in.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: str | None = None
    city: str | None = None
    country_code: str | None = None
    is_deleted: bool


class OrganizationPlaceOwnerRead(BaseModel):
    """One ``place_owners`` row belonging to an org, with the place
    summary nested inline.

    Includes REVOKED history alongside live rows so the org detail
    page can show "Acme Inc used to own Halal Test Diner" as
    meaningful audit context. UI sorts ACTIVE-first and can choose to
    fade/badge the REVOKED entries.
    """

    model_config = ConfigDict(from_attributes=False)

    # PlaceOwner row id — same shape as OrganizationMember's. Future
    # admin actions (e.g. force-revoke from the org side) can target
    # it even though today the revoke lives on the place detail page.
    id: UUID
    role: str
    status: str
    created_at: datetime
    place: OrganizationPlaceSummary
