"""Owner-portal-facing schemas for the Organization self-service flow.

Distinct from the admin schemas in ``app/modules/admin/organizations``
on purpose: the admin surface is "show me everything, let me create
on someone's behalf"; the owner surface is "let me manage my own org
end-to-end without needing Trust Halal staff."

Naming convention mirrors the claim flow: ``MyOrganization*`` for
owner-portal-facing types so a quick scan of /me routes lights up
immediately.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.organizations.enums import OrganizationStatus


class OrganizationAttachmentRead(BaseModel):
    """Wire shape for an org's uploaded supporting document."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    original_filename: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime


class MyOrganizationCreate(BaseModel):
    """POST /me/organizations body.

    Solo operators are welcome — the bar is "you exist as some kind
    of business entity," not "you have an LLC." Owner can create with
    just a name and add documentation later.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr | None = None


class MyOrganizationPatch(BaseModel):
    """PATCH /me/organizations/{id} body.

    Only allowed while the org is DRAFT or UNDER_REVIEW — once an
    admin reviewer has signed off (VERIFIED) or rejected, the row
    becomes audit-immutable. Owners who need to change a verified
    org's details contact admin support; future work could add an
    explicit "amend" workflow.

    Omitted fields are left alone. ``contact_email: null`` clears
    the column; absent leaves it as-is.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    contact_email: EmailStr | None = None


class MyOrganizationRead(BaseModel):
    """GET /me/organizations row + most owner-facing org responses.

    Includes attachments[] inline so the org detail page doesn't need
    a per-row fetch. status reflects the verification state; the
    /claim flow gates on this when picking a requesting org.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    contact_email: str | None
    status: OrganizationStatus
    submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    attachments: list[OrganizationAttachmentRead] = []
