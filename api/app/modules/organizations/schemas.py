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

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

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

    Address is now REQUIRED on create — admin staff need it to
    disambiguate same-name LLCs across states, and a fresh org with
    no address is too easy a path to "we'll fix it later" that
    never gets fixed. Existing rows in the DB with NULL address
    fields are unaffected (the column is still nullable in the
    schema); this validator runs only on the create payload.

    ``country_code`` defaults server-side to "US" when omitted
    rather than failing validation, since the platform is US-only
    for v1. The owner UI doesn't surface a country picker yet.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr | None = None

    # All four explicitly required. ``min_length=1`` rejects empty
    # strings; the repo additionally trims so a whitespace-only
    # input doesn't sneak through.
    address: str = Field(..., min_length=1, max_length=500)
    city: str = Field(..., min_length=1, max_length=120)
    region: str = Field(
        ...,
        min_length=1,
        max_length=120,
        description=(
            "State / region. For US the UI ships a 50-state + DC + "
            "territories dropdown; the server stores the chosen "
            "value verbatim so future jurisdictions don't need a "
            "schema migration."
        ),
    )
    country_code: str = Field(
        default="US",
        min_length=2,
        max_length=2,
        description=(
            "ISO-3166-1 alpha-2 country code. Defaults to 'US' since "
            "the platform is US-only for v1; widen the UI before "
            "loosening the default."
        ),
    )
    postal_code: str = Field(..., min_length=1, max_length=20)

    # ``min_length=1`` rejects the literal empty string, but a payload
    # with whitespace-only values (e.g. "   ") would slip past it and
    # then collapse to NULL inside the repo's _clean_str. Strip first
    # and re-check to keep "required" actually required.
    @field_validator("address", "city", "region", "postal_code", mode="after")
    @classmethod
    def _no_blank_required_field(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("must not be blank")
        return cleaned


class MyOrganizationPatch(BaseModel):
    """PATCH /me/organizations/{id} body.

    Only allowed while the org is DRAFT or UNDER_REVIEW — once an
    admin reviewer has signed off (VERIFIED) or rejected, the row
    becomes audit-immutable. Owners who need to change a verified
    org's details contact admin support; future work could add an
    explicit "amend" workflow.

    Omitted fields are left alone. ``contact_email: null`` clears
    the column; absent leaves it as-is. Same null-vs-absent semantics
    apply to the address fields.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    contact_email: EmailStr | None = None

    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    country_code: str | None = Field(
        default=None, min_length=2, max_length=2
    )
    postal_code: str | None = Field(default=None, max_length=20)


class MyOrganizationRead(BaseModel):
    """GET /me/organizations row + most owner-facing org responses.

    Includes attachments[] inline so the org detail page doesn't need
    a per-row fetch. status reflects the verification state; the
    /claim flow gates on this when picking a requesting org.

    ``decision_note`` mirrors the admin-side column. We surface it on
    the owner shape so a REJECTED org tells the owner WHY (per the
    polish-pass requirement) rather than leaving them in the dark.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    contact_email: str | None
    address: str | None = None
    city: str | None = None
    region: str | None = None
    country_code: str | None = None
    postal_code: str | None = None
    status: OrganizationStatus
    submitted_at: datetime | None
    decided_at: datetime | None = None
    decision_note: str | None = None
    created_at: datetime
    updated_at: datetime
    attachments: list[OrganizationAttachmentRead] = []
