from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class OwnershipRequestCreate(BaseModel):
    contact_name: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr = Field(..., max_length=255)
    contact_phone: str | None = Field(default=None, max_length=50)
    message: str | None = Field(default=None, max_length=2000)


class MyOwnershipRequestCreate(BaseModel):
    """POST /me/ownership-requests body.

    The owner-portal-facing variant of OwnershipRequestCreate. Contact
    name + email are pulled from the authenticated user server-side, so
    the wire shape collapses to "what are you claiming, and what should
    we know?". Phone is optional and lets the user offer a callback
    line if they have one.

    ``message`` is the catch-all freeform field admin staff sees in the
    review queue. The owner portal UI gives users a friendlier surface
    over this — separate fields for "anything we should know?" and a
    URL for evidence — and concatenates them client-side. Server is
    intentionally agnostic.
    """

    model_config = ConfigDict(extra="forbid")

    place_id: UUID
    message: str | None = Field(default=None, max_length=2000)
    contact_phone: str | None = Field(default=None, max_length=50)


class MyOwnershipRequestPlaceSummary(BaseModel):
    """Lean place fields embedded in MyOwnershipRequestRead.

    Just enough for the /my-claims list to render "Khan Halal — 123
    Main St, Brooklyn" without a second roundtrip per row. We avoid
    PlaceDetail because it fans out to claims + ingest fields the
    owner doesn't need at this level.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: str | None = None
    city: str | None = None
    region: str | None = None
    country_code: str | None = None


class MyOwnershipRequestRead(BaseModel):
    """GET /me/ownership-requests row + POST /me/ownership-requests
    response shape.

    Same status semantics as OwnershipRequestRead but with the place
    nested so the portal can render the row without a second fetch.
    Contact fields aren't included — the owner already knows their
    own contact info; surfacing them here is just clutter.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place: MyOwnershipRequestPlaceSummary
    status: str
    message: str | None
    created_at: datetime
    updated_at: datetime


class OwnershipRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    requester_user_id: UUID | None
    contact_name: str
    contact_email: str
    contact_phone: str | None
    message: str | None
    status: str
    created_at: datetime
    updated_at: datetime


class OwnershipRequestStatusRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    status: str
    created_at: datetime
    updated_at: datetime


class OwnershipRequestDetailRead(BaseModel):
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
