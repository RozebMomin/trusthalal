"""Pydantic schemas for halal claims.

The most important piece here is ``HalalQuestionnaireResponse`` —
the typed shape of the JSONB column ``halal_claims.structured_response``.
Owner-portal forms produce this, admin review reads it, profile
derivation flips it into the ``halal_profiles`` columns.

Keeping it Pydantic-typed (rather than free-form JSON) gives us:
  * Type safety on every read/write through Python.
  * Auto-generated TypeScript via openapi-typescript (frontends use
    the same shape).
  * One canonical place to evolve the questionnaire — add a field
    here and downstream consumers fail loudly until they update.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.halal_claims.enums import (
    HalalClaimAttachmentType,
    HalalClaimStatus,
    HalalClaimType,
)
from app.modules.halal_profiles.enums import (
    AlcoholPolicy,
    MenuPosture,
    SlaughterMethod,
)


# ---------------------------------------------------------------------------
# Questionnaire — the typed shape of structured_response (JSONB)
# ---------------------------------------------------------------------------


class MeatSourcing(BaseModel):
    """How a single meat type is sourced.

    Repeated per meat (chicken / beef / lamb / goat / etc.). Owner
    can declare ``not_served`` to mark "we don't serve this protein"
    without leaving an awkward "n/a" answer. ``supplier_name`` and
    ``supplier_location`` are free-form text — admin uses them to
    sanity-check the certificate authority claims.
    """

    model_config = ConfigDict(extra="forbid")

    slaughter_method: SlaughterMethod = Field(
        ...,
        description=(
            "ZABIHAH / MACHINE / NOT_SERVED. NOT_SERVED means the "
            "restaurant doesn't serve this protein at all."
        ),
    )
    supplier_name: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Halal supplier name, if applicable.",
    )
    supplier_location: Optional[str] = Field(
        default=None,
        max_length=255,
        description="City / state / country of the supplier.",
    )


class HalalQuestionnaireResponse(BaseModel):
    """STRICT shape — all required fields populated.

    Used at submit-time to validate that a draft is complete. Fields
    that are conceptually required for a real submission live here as
    non-Optional. Owners save partial progress with the draft
    shape (``HalalQuestionnaireDraft``) and we re-parse the stored
    JSONB through this strict shape when they hit submit.

    Versioned via ``questionnaire_version`` so future additions don't
    break old rows. v1 covers the questions the user settled on in
    the design pass: menu posture, alcohol, per-meat sourcing,
    certification, free-text caveats.
    """

    model_config = ConfigDict(extra="forbid")

    # Schema version — bump when you add/rename/remove questions so
    # admin review can render the right UI for older claims.
    questionnaire_version: int = Field(
        default=1, ge=1, description="Questionnaire schema version."
    )

    # Core menu posture.
    menu_posture: MenuPosture
    has_pork: bool = Field(
        ..., description="True if pork or pork products are on the menu."
    )
    alcohol_policy: AlcoholPolicy
    alcohol_in_cooking: bool = Field(
        ...,
        description=(
            "True if alcohol is used in any cooking process (wine "
            "reductions, mirin, etc.)."
        ),
    )

    # Per-meat detail. Optional fields so an owner can submit "we "
    # don't serve goat" by either omitting the key or sending
    # ``slaughter_method: NOT_SERVED``.
    chicken: Optional[MeatSourcing] = None
    beef: Optional[MeatSourcing] = None
    lamb: Optional[MeatSourcing] = None
    goat: Optional[MeatSourcing] = None
    seafood_only: bool = Field(
        default=False,
        description=(
            "True if the kitchen serves no land-meat at all. Mutually "
            "exclusive with the per-meat fields above (admin can flag)."
        ),
    )

    # Certification context — does the owner claim a recognized cert?
    has_certification: bool = Field(
        ...,
        description=(
            "True if the restaurant or supplier holds a halal "
            "certificate from a recognized authority. Owner uploads "
            "the document as a HALAL_CERTIFICATE attachment."
        ),
    )
    certifying_body_name: Optional[str] = Field(
        default=None,
        max_length=255,
        description=(
            "Name of the certifying authority (IFANCA, HMA, HFSAA, "
            "local mosque XYZ, etc.). Required if has_certification."
        ),
    )

    # Free-form caveats — surfaces to consumers as "Anything else?"
    caveats: Optional[str] = Field(
        default=None,
        max_length=2000,
        description=(
            "Anything else a halal-conscious diner should know. "
            "Examples: 'Halal only at lunch', 'No halal on holidays.'"
        ),
    )


class HalalQuestionnaireDraft(BaseModel):
    """PERMISSIVE shape — every field optional.

    Used as the ``structured_response`` payload while the claim is in
    DRAFT, so owners can save partial progress across multiple
    sessions without Pydantic rejecting incomplete answers. The
    submit endpoint re-validates the stored dict through the strict
    ``HalalQuestionnaireResponse`` and returns a 422 with field-level
    errors if anything's missing.

    Field set is identical to ``HalalQuestionnaireResponse`` minus
    the requiredness — keep both shapes in lock-step when adding new
    questions.
    """

    model_config = ConfigDict(extra="forbid")

    questionnaire_version: int = Field(default=1, ge=1)

    menu_posture: Optional[MenuPosture] = None
    has_pork: Optional[bool] = None
    alcohol_policy: Optional[AlcoholPolicy] = None
    alcohol_in_cooking: Optional[bool] = None

    chicken: Optional[MeatSourcing] = None
    beef: Optional[MeatSourcing] = None
    lamb: Optional[MeatSourcing] = None
    goat: Optional[MeatSourcing] = None
    seafood_only: Optional[bool] = None

    has_certification: Optional[bool] = None
    certifying_body_name: Optional[str] = Field(default=None, max_length=255)

    caveats: Optional[str] = Field(default=None, max_length=2000)


# ---------------------------------------------------------------------------
# HalalClaim — read/create/patch shapes
# ---------------------------------------------------------------------------


class HalalClaimAttachmentRead(BaseModel):
    """Metadata for a claim's attached document. Bytes are at
    ``storage_path`` — frontends fetch via signed URL, not directly."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    claim_id: UUID
    document_type: HalalClaimAttachmentType
    issuing_authority: Optional[str] = None
    certificate_number: Optional[str] = None
    valid_until: Optional[datetime] = None
    original_filename: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime


class MyHalalClaimPlaceSummary(BaseModel):
    """Embedded place fields on the owner-side claim read shape.

    Surfaces enough context for the list page to render a real
    place name + address line without a second fetch. Stays slim
    so the wire shape doesn't carry geom/timezone/etc the UI
    doesn't need.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    country_code: Optional[str] = None


class MyHalalClaimOrgSummary(BaseModel):
    """Embedded org fields on the owner-side claim read shape."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str


class MyHalalClaimCreate(BaseModel):
    """Payload for ``POST /me/halal-claims``. Creates a DRAFT.

    The owner must already have ownership of the place (via an
    approved ``ownership_request``) and a sponsoring organization
    in UNDER_REVIEW or VERIFIED status.

    The questionnaire is optional at creation and accepts the
    ``HalalQuestionnaireDraft`` shape — owners save partial progress
    across multiple sessions, then submit. Validation that all
    required fields are populated runs at the submit step.
    """

    model_config = ConfigDict(extra="forbid")

    place_id: UUID
    organization_id: UUID
    structured_response: Optional[HalalQuestionnaireDraft] = None


class MyHalalClaimPatch(BaseModel):
    """Payload for ``PATCH /me/halal-claims/{id}``. DRAFT-only.

    Accepts the permissive draft shape so partial saves don't 422.
    """

    model_config = ConfigDict(extra="forbid")

    structured_response: Optional[HalalQuestionnaireDraft] = None


class MyHalalClaimRead(BaseModel):
    """Owner-side read shape. Includes attachments + decision context.

    ``structured_response`` is returned as a raw dict because the
    stored JSONB may be a draft (partial answers) or a complete
    response — the read shape stays loose to cover both. Frontends
    parse it through ``HalalQuestionnaireDraft`` if they want
    typed access.

    ``place`` and ``organization`` summaries are embedded so the
    list page renders 'Khan Halal Grill — owned by Khan LLC' without
    a second fetch per row. Both are nullable: a claim's referenced
    org could go away (FK ondelete=SET NULL), and place is
    technically nullable post-cascade for the same reason.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    place_id: UUID
    organization_id: Optional[UUID]
    place: Optional[MyHalalClaimPlaceSummary] = None
    organization: Optional[MyHalalClaimOrgSummary] = None
    claim_type: HalalClaimType
    status: HalalClaimStatus
    structured_response: Optional[dict] = None
    attachments: list[HalalClaimAttachmentRead] = Field(default_factory=list)

    submitted_at: Optional[datetime]
    decided_at: Optional[datetime]
    # decision_note exposed to owner. Internal notes stay server-side.
    decision_note: Optional[str]
    expires_at: Optional[datetime]

    created_at: datetime
    updated_at: datetime


class MyHalalClaimBatchSelection(BaseModel):
    """One (place, sponsoring org) pair inside a batch create."""

    model_config = ConfigDict(extra="forbid")

    place_id: UUID
    organization_id: UUID


class MyHalalClaimBatchCreate(BaseModel):
    """Payload for ``POST /me/halal-claims/batch``.

    Lets an owner create N draft claims in one call, all sharing
    the same questionnaire payload. Use case: a chain restaurant
    where every location maintains the same halal standard — the
    owner fills out the questionnaire once and applies it to each
    place.

    Limits:
      * 1..20 selections per batch — beyond that, performance and
        UX both degrade. Owners with more locations submit in
        smaller groups.
      * Every selection runs the same authorization gates as the
        single-create path (membership + place ownership). If any
        selection fails, the whole batch rolls back so the owner
        gets a clean retry rather than a partial mess.

    After creation the claims are independent — each can be edited,
    submitted, and decided on separately. The shared questionnaire
    is just the starting point.
    """

    model_config = ConfigDict(extra="forbid")

    selections: list[MyHalalClaimBatchSelection] = Field(
        ..., min_length=1, max_length=20
    )
    structured_response: Optional[HalalQuestionnaireDraft] = None


class HalalClaimAdminRead(MyHalalClaimRead):
    """Admin-side read. Adds internal_notes + decided_by_user_id +
    submitted_by_user_id (the owner-side hides these for tidiness)."""

    submitted_by_user_id: Optional[UUID] = None
    decided_by_user_id: Optional[UUID] = None
    triggered_by_dispute_id: Optional[UUID] = None
    internal_notes: Optional[str] = None
