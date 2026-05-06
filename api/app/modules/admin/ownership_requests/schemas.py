from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.ownership_requests.schemas import (
    MyOwnershipRequestOrgSummary,
    MyOwnershipRequestPlaceSummary,
    OwnershipRequestAttachmentRead,
)


class OwnershipRequestAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    requester_user_id: UUID | None
    organization_id: UUID | None

    contact_name: str
    contact_email: EmailStr
    message: str | None
    # Admin's most recent guidance note (set by request-evidence).
    # Surfaces on both admin + owner detail views so both sides
    # see the same instruction.
    decision_note: str | None = None

    status: str
    created_at: datetime
    updated_at: datetime

    # Attachments embedded so the admin claim-review UI can render
    # the evidence list inline (filename + size + signed-URL link)
    # without a per-row roundtrip to the attachments endpoint.
    # Empty list when nothing was uploaded.
    attachments: list[OwnershipRequestAttachmentRead] = []

    # Place summary (name + address fields) inlined so the admin
    # ownership-requests queue can render "Khan Halal Grill — 123
    # Main St, Detroit" instead of a truncated UUID. Same shape
    # the owner-portal /me/claims feed uses; reusing it keeps the
    # two surfaces in lockstep. Required because every claim row
    # has a place FK (the place_id column is non-nullable).
    place: MyOwnershipRequestPlaceSummary

    # Sponsoring organization summary so admin queue can show
    # "Khan Halal LLC — UNDER_REVIEW" inline. Nullable because
    # legacy claims (pre-slice-5b) didn't carry an org.
    organization: MyOwnershipRequestOrgSummary | None = None


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
    message: str | None = Field(default=None, max_length=2000)


class OwnershipRequestApprove(BaseModel):
    """Approve an ownership request.

    Slice 5d removed the create-org-on-approval path. The sponsoring
    organization is now read off the claim row itself
    (set at submission time via the owner-portal flow). Admin
    staff verifies the org separately at /admin/organizations
    before approving the claim — this endpoint refuses unless the
    claim's organization is VERIFIED.

    ``organization_id`` remains in the body purely as a fallback for
    legacy claims submitted via the public anonymous endpoint
    (POST /places/{id}/ownership-requests), which doesn't capture
    an org. For owner-portal-filed claims the field is ignored —
    the claim already says which org owns it.
    """

    organization_id: UUID | None = None

    # Role assigned to the requester inside the organization
    member_role: str = Field(default="OWNER_ADMIN", max_length=50)

    # Role on the PlaceOwner join row
    place_owner_role: str = Field(default="PRIMARY", max_length=50)

    # Optional note attached to the approval event
    note: str | None = Field(default=None, max_length=2000)


class OwnershipRequestReject(BaseModel):
    reason: str = Field(..., min_length=3, max_length=2000)


class OwnershipRequestEvidence(BaseModel):
    """POST /admin/ownership-requests/{id}/request-evidence body.

    ``note`` is required (min_length=3, mirrors reject + verify) so
    the owner has actionable guidance on what to upload next. Without
    it, NEEDS_EVIDENCE is a dead-end status — the owner sees the
    state change but no instructions, and admin staff just bounce
    the claim around without driving it to a decision.
    """

    note: str = Field(..., min_length=3, max_length=2000)
