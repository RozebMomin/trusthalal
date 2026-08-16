"""Pydantic schemas for verifier applications, profiles, and visits."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.halal_claims.schemas import HalalQuestionnaireResponse
from app.modules.halal_profiles.enums import MeatType
from app.modules.verifiers.enums import (
    AmenityStatus,
    CheckResult,
    MeatCheckEvidence,
    MenuPartialScope,
    VerificationVisitStatus,
    VerifierApplicationStatus,
    VerifierMeatFinding,
    VerifierProfileStatus,
    VisitDisclosure,
)


# ---------------------------------------------------------------------------
# Verifier applications — public apply form + admin queue
# ---------------------------------------------------------------------------


class VerifierApplicationCreate(BaseModel):
    """Public ``POST /verifier-applications`` payload."""

    model_config = ConfigDict(extra="forbid")

    applicant_email: EmailStr
    applicant_name: str = Field(..., min_length=1, max_length=255)
    motivation: str = Field(..., min_length=20, max_length=2000)
    background: Optional[str] = Field(default=None, max_length=2000)
    social_links: Optional[dict[str, Any]] = Field(
        default=None,
        description=(
            "Free-form social handles. Suggested keys: instagram, "
            "tiktok, youtube, website. Frontends should validate the "
            "handle shapes; backend just stores."
        ),
    )


class VerifierApplicationRead(BaseModel):
    """Read shape — admin sees this in the queue."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    applicant_user_id: Optional[UUID]
    applicant_email: str
    applicant_name: str
    motivation: str
    background: Optional[str]
    social_links: Optional[dict[str, Any]]
    status: VerifierApplicationStatus
    decided_at: Optional[datetime]
    decided_by_user_id: Optional[UUID]
    decision_note: Optional[str]
    resulting_verifier_profile_id: Optional[UUID]
    submitted_at: datetime
    updated_at: datetime


class VerifierApplicationDecision(BaseModel):
    """Admin payload for approving or rejecting an application."""

    model_config = ConfigDict(extra="forbid")

    decision: VerifierApplicationStatus = Field(
        ...,
        description=(
            "Must be APPROVED or REJECTED. Other values rejected at "
            "validation."
        ),
    )
    decision_note: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Required on REJECTED so applicant gets context.",
    )


# ---------------------------------------------------------------------------
# Verifier profiles
# ---------------------------------------------------------------------------


class VerifierProfileRead(BaseModel):
    """Verifier-self read shape (``GET /me/verifier-profile``)."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    user_id: UUID
    public_handle: Optional[str]
    bio: Optional[str]
    social_links: Optional[dict[str, Any]]
    is_public: bool
    status: VerifierProfileStatus
    joined_as_verifier_at: datetime
    updated_at: datetime


class VerifierProfilePatch(BaseModel):
    """Verifier-self edit (``PATCH /me/verifier-profile``).

    Allows updating bio / handle / socials / public-toggle. Status
    changes are admin-only and live on a separate endpoint.
    """

    model_config = ConfigDict(extra="forbid")

    public_handle: Optional[str] = Field(
        default=None,
        min_length=3,
        max_length=80,
        pattern=r"^[a-z0-9_-]+$",
        description="URL-safe slug. Lowercase alphanumeric + hyphens/underscores.",
    )
    bio: Optional[str] = Field(default=None, max_length=2000)
    social_links: Optional[dict[str, Any]] = None
    is_public: Optional[bool] = None


class VerifierPublicProfileRead(BaseModel):
    """Public-facing verifier read (``GET /verifiers/{handle}``).

    Only returned when ``is_public=true`` and ``status=ACTIVE``.
    Strictly the fields the verifier opted to publish.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    public_handle: str
    bio: Optional[str]
    social_links: Optional[dict[str, Any]]
    joined_as_verifier_at: datetime


class VerifierPublicVisitPlace(BaseModel):
    """Slim place summary embedded in a public visit row.

    Just enough for the verifier page to link to the restaurant
    without exposing internal fields.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    name: str
    city: Optional[str]
    region: Optional[str]


class VerifierPublicVisitSummary(BaseModel):
    """One ACCEPTED visit as it appears on the verifier's public
    profile page.

    We only surface visits that have been ACCEPTED by admin, since
    those are the only visits the platform stands behind. In-flight
    or rejected visits stay on the verifier's private dashboard.
    Disclosure IS shown publicly — the whole point of the
    disclosure norm is that it's visible.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    visited_at: datetime
    disclosure: VisitDisclosure
    public_review_url: Optional[str]
    place: VerifierPublicVisitPlace


class VerifierPublicProfileDetail(VerifierPublicProfileRead):
    """Extended public profile with recent accepted visits inline.

    The verifier's page is more compelling when it shows what they've
    actually done. This shape is what ``GET /verifiers/{handle}``
    returns — the base fields plus up to ``visits_returned`` recent
    ACCEPTED visits, newest first.
    """

    model_config = ConfigDict(from_attributes=False, extra="forbid")

    recent_visits: list[VerifierPublicVisitSummary] = Field(
        default_factory=list,
        description=(
            "Newest-first list of the verifier's ACCEPTED visits, "
            "capped server-side. In-flight and rejected visits are "
            "never surfaced here."
        ),
    )
    total_accepted_visits: int = Field(
        default=0,
        description=(
            "Total ACCEPTED visits for this verifier, regardless of "
            "how many rows landed in ``recent_visits``. Lets the UI "
            "render 'X visits verified' as a headline number."
        ),
    )


# ---------------------------------------------------------------------------
# Verification visits
# ---------------------------------------------------------------------------


class VerificationVisitAttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    visit_id: UUID
    original_filename: str
    content_type: str
    size_bytes: int
    caption: Optional[str]
    uploaded_at: datetime


class VerifierMeatCheck(BaseModel):
    """A verifier's on-the-spot finding for one meat.

    ``finding`` is what staff said (mirrors the slaughter vocab, plus
    UNSURE); ``evidence`` is how well it was corroborated. Together they
    let a visit speak to a *single meat* rather than the whole kitchen,
    and map onto the confidence tiers so a cert-backed finding outweighs a
    verbal one.
    """

    model_config = ConfigDict(extra="forbid")

    finding: VerifierMeatFinding
    evidence: MeatCheckEvidence = MeatCheckEvidence.VERBAL
    note: Optional[str] = Field(default=None, max_length=500)


class VerifierOtherMeatCheck(VerifierMeatCheck):
    """A per-item finding for something outside the four tracked meats
    (duck, fish, a specific dish), labelled free-text by the verifier."""

    label: str = Field(..., min_length=1, max_length=100)


class MenuPartialDetail(BaseModel):
    """Set when the 'menu fully halal' check is PARTIAL — what shape the
    partial coverage takes, plus the verifier's specifics."""

    model_config = ConfigDict(extra="forbid")

    scope: MenuPartialScope
    note: Optional[str] = Field(
        default=None,
        max_length=1000,
        description="Free text: which meats/dishes are the halal ones.",
    )


class VisitObservations(BaseModel):
    """Lightweight structured observations a verifier logs on the spot.

    Separate from ``structured_findings`` (the heavy owner-style
    questionnaire): these are the quick "you ordered / tappable checks"
    signals from the mobile observe step. Stored so they can be
    surfaced/filtered later rather than buried in free-text notes.
    """

    model_config = ConfigDict(extra="forbid")

    ordered_items: list[str] = Field(
        default_factory=list,
        max_length=40,
        description="Dishes the verifier ordered, as free-text chips.",
    )
    checks: dict[str, CheckResult] = Field(
        default_factory=dict,
        description=(
            "Prompt → YES/NO/PARTIAL. Keys are the check labels shown in "
            "the app (e.g. 'Halal cert visible on premises')."
        ),
    )
    # Item-wise findings: the verifier asks staff about each meat and records
    # what they were told + how well it was backed up. Keyed by MeatType for
    # the four tracked meats (CHICKEN/BEEF/LAMB/GOAT); anything else goes in
    # ``other_meat_checks`` with a free-text label. Empty when the verifier
    # only did the blanket ``checks`` above — additive, so pre-existing visits
    # and older app builds that omit it stay valid.
    meat_checks: dict[MeatType, VerifierMeatCheck] = Field(
        default_factory=dict,
        description=(
            "Per-meat finding keyed by MeatType. What staff said about each "
            "meat, plus the evidence level behind it."
        ),
    )
    other_meat_checks: list[VerifierOtherMeatCheck] = Field(
        default_factory=list,
        max_length=10,
        description="Per-item findings for meats/dishes outside the four tracked.",
    )
    # Detail behind a PARTIAL 'menu fully halal' answer: is the halal part a
    # whole meat group or specific dishes, plus the specifics as free text.
    # Null when the menu is fully halal (or the check wasn't answered).
    menu_partial: Optional[MenuPartialDetail] = None
    # Family/cleanliness amenities the verifier checked for, keyed by a stable
    # code (PRAYER_SPACE / WUDU / BIDET / BABY_CHANGING). Empty when none were
    # recorded; additive, so older app builds that omit it stay valid. Kept
    # structured (not free text) because these become consumer filters later.
    amenities: dict[str, AmenityStatus] = Field(default_factory=dict)


class VerificationVisitCreate(BaseModel):
    """Verifier submitting a site-visit record.

    Findings are validated via HalalQuestionnaireResponse — same
    shape the owner submits, so admin can diff them.
    """

    model_config = ConfigDict(extra="forbid")

    place_id: UUID
    visited_at: datetime
    structured_findings: Optional[HalalQuestionnaireResponse] = None
    observations: Optional[VisitObservations] = None
    notes_for_admin: Optional[str] = Field(default=None, max_length=4000)
    public_review_url: Optional[str] = Field(
        default=None, max_length=2048
    )
    disclosure: VisitDisclosure = VisitDisclosure.SELF_FUNDED
    disclosure_note: Optional[str] = Field(default=None, max_length=2000)


class VerificationVisitRead(BaseModel):
    """Verifier-self + admin-shared read shape."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    verifier_user_id: UUID
    place_id: UUID
    place: Optional[VerifierPublicVisitPlace] = None
    visited_at: datetime
    structured_findings: Optional[HalalQuestionnaireResponse]
    observations: Optional[VisitObservations] = None
    notes_for_admin: Optional[str]
    public_review_url: Optional[str]
    disclosure: VisitDisclosure
    disclosure_note: Optional[str]
    status: VerificationVisitStatus
    attachments: list[VerificationVisitAttachmentRead] = Field(
        default_factory=list
    )

    decided_at: Optional[datetime]
    decided_by_user_id: Optional[UUID]
    decision_note: Optional[str]
    submitted_at: datetime
    updated_at: datetime


class VerificationVisitDecision(BaseModel):
    """Admin decision payload."""

    model_config = ConfigDict(extra="forbid")

    decision: VerificationVisitStatus = Field(
        ...,
        description="Must be ACCEPTED or REJECTED.",
    )
    decision_note: Optional[str] = Field(default=None, max_length=2000)
