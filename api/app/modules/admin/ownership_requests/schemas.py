from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.ownership_requests.schemas import OwnershipRequestAttachmentRead


class OwnershipRequestAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    requester_user_id: UUID | None

    contact_name: str
    contact_email: EmailStr
    contact_phone: str | None
    message: str | None

    status: str
    created_at: datetime
    updated_at: datetime

    # Attachments embedded so the admin claim-review UI can render
    # the evidence list inline (filename + size + signed-URL link)
    # without a per-row roundtrip to the attachments endpoint.
    # Empty list when nothing was uploaded.
    attachments: list[OwnershipRequestAttachmentRead] = []


class OwnershipRequestAdminCreate(BaseModel):
    """Admin-supplied body for creating an ownership request on someone's behalf.

    Different from the public ``OwnershipRequestCreate`` in two ways:
      1. ``place_id`` is in the body instead of the URL — the admin UI
         picks the place via a search widget rather than navigating to
         the place detail page first.
      2. ``requester_user_id`` is optional and admin-supplied. The
         public endpoint derives this from the caller's auth; an admin
         creating on behalf of someone else shouldn't end up as the
         requester on the record. Leave null for unauthenticated
         requesters (phone-call, in-person intake, etc.).
    """

    model_config = ConfigDict(extra="forbid")

    place_id: UUID
    requester_user_id: UUID | None = None

    contact_name: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr = Field(..., max_length=255)
    contact_phone: str | None = Field(default=None, max_length=50)
    message: str | None = Field(default=None, max_length=2000)


class OwnershipRequestApprove(BaseModel):
    """Approve an ownership request.

    Provide either an existing `organization_id` OR `new_organization_name`
    (to create a new org on the fly). Exactly one is required.
    """

    organization_id: UUID | None = None
    new_organization_name: str | None = Field(default=None, max_length=255)

    # Role assigned to the requester inside the organization
    member_role: str = Field(default="OWNER_ADMIN", max_length=50)

    # Role on the PlaceOwner join row
    place_owner_role: str = Field(default="PRIMARY", max_length=50)

    # Optional note attached to the approval event
    note: str | None = Field(default=None, max_length=2000)


class OwnershipRequestReject(BaseModel):
    reason: str = Field(..., min_length=3, max_length=2000)


class OwnershipRequestEvidence(BaseModel):
    note: str | None = Field(default=None, max_length=2000)
