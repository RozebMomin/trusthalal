"""Pydantic schemas for reviews, replies, and reports."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.modules.reviews.enums import (
    ModerationAction,
    PlaceReviewStatus,
    ReviewReportReason,
    ReviewReportStatus,
)

# Body bounds. The 20-character floor is a real editorial choice: "great!"
# tells a diner nothing, and a review that carries a restaurant's reputation
# should cost at least a sentence to write.
BODY_MIN = 20
BODY_MAX = 5000
REPLY_MIN = 1
REPLY_MAX = 3000


class PlaceReviewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: int = Field(..., ge=1, le=5)
    body: str = Field(..., min_length=BODY_MIN, max_length=BODY_MAX)
    visited_on: Optional[date] = None

    #: Set by the client when re-submitting after seeing the "this reads
    #: heated" nudge. Waives the WARN verdict only — the text is re-scored on
    #: the second pass and a BLOCK still refuses, so this can't be used to
    #: skip moderation by sending it on the first request.
    acknowledged_warning: bool = False

    @field_validator("body")
    @classmethod
    def _strip_body(cls, v: str) -> str:
        # Validate the stripped length, not the raw one — otherwise 20 spaces
        # plus "ok" passes the floor while carrying nothing.
        stripped = v.strip()
        if len(stripped) < BODY_MIN:
            raise ValueError(
                f"Please write at least {BODY_MIN} characters so other diners "
                "get something useful."
            )
        return stripped

    @field_validator("visited_on")
    @classmethod
    def _not_future(cls, v: Optional[date]) -> Optional[date]:
        # Unverifiable either way, but a future visit date is definitionally
        # wrong and usually a date-picker slip rather than a lie.
        if v is not None and v > date.today():
            raise ValueError("That date is in the future.")
        return v


class PlaceReviewUpdate(BaseModel):
    """Partial edit by the author. Every supplied field is re-moderated."""

    model_config = ConfigDict(extra="forbid")

    rating: Optional[int] = Field(default=None, ge=1, le=5)
    body: Optional[str] = Field(
        default=None, min_length=BODY_MIN, max_length=BODY_MAX
    )
    visited_on: Optional[date] = None

    #: Set by the client when re-submitting after seeing the "this reads
    #: heated" nudge. Waives the WARN verdict only — the text is re-scored on
    #: the second pass and a BLOCK still refuses, so this can't be used to
    #: skip moderation by sending it on the first request.
    acknowledged_warning: bool = False


class ReviewAuthorRead(BaseModel):
    """Public identity on a review.

    Deliberately carries no ``role``. A verifier's review renders exactly
    like anyone else's: verifier standing is earned against *facts* and
    doesn't transfer to weight of *opinion* about a meal. Not exposing the
    field is what stops a badge creeping back in later.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    display_name: Optional[str] = None


class ReviewPhotoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    url: str


class PlaceReviewReplyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    review_id: UUID
    organization_id: UUID
    organization_name: Optional[str] = None
    body: str
    edited_at: Optional[datetime] = None
    created_at: datetime


class PlaceReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    author: ReviewAuthorRead
    rating: int
    body: str
    visited_on: Optional[date] = None
    status: PlaceReviewStatus
    edited_at: Optional[datetime] = None
    created_at: datetime

    photos: list[ReviewPhotoRead] = Field(default_factory=list)
    reply: Optional[PlaceReviewReplyRead] = None

    #: True when this review was edited *after* the owner's reply was written.
    #:
    #: A bare "edited" marker doesn't distinguish the harmless case (fixed a
    #: typo, then the owner answered) from the one that misleads readers: the
    #: review was rewritten afterwards, so the reply now appears to be
    #: answering words that were never there. Only the second deserves a
    #: caveat next to the reply.
    #:
    #: Computed here rather than left to each client to compare timestamps —
    #: three clients doing the same date arithmetic is three chances to get
    #: the comparison backwards.
    edited_after_reply: bool = False

    #: True when the caller wrote this one — drives Edit vs Report in the UI.
    is_mine: bool = False
    #: True when the caller has already reported it, so the client can show
    #: "Reported" instead of letting them press a button that 409s.
    reported_by_me: bool = False
    #: Populated only for the author, on their own non-published reviews.
    #: Removal must never be silent.
    moderation_note: Optional[str] = None


class ReviewSummary(BaseModel):
    """Aggregates for the header block.

    ``google_rating`` rides along so the client can render both numbers
    side by side, each labeled. Showing a bare star that silently means
    Google's is the thing this feature has to stop doing.
    """

    model_config = ConfigDict(from_attributes=True)

    average: Optional[float] = None
    count: int = 0
    #: rating value (1–5, as a string key) → number of reviews.
    histogram: dict[str, int] = Field(default_factory=dict)
    google_rating: Optional[float] = None
    google_rating_count: Optional[int] = None


class PlaceReviewListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    summary: ReviewSummary
    items: list[PlaceReviewRead]
    total: int
    #: Null when there's nothing more to fetch.
    next_offset: Optional[int] = None
    #: Whether the caller may post one (signed in, verified, hasn't already).
    #: Lets the client explain *why* the button is unavailable instead of
    #: hiding it and leaving the user guessing.
    can_review: bool = False
    my_review_id: Optional[UUID] = None


class PlaceReviewReplyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(..., min_length=REPLY_MIN, max_length=REPLY_MAX)

    #: Set by the client when re-submitting after seeing the "this reads
    #: heated" nudge. Waives the WARN verdict only — the text is re-scored on
    #: the second pass and a BLOCK still refuses, so this can't be used to
    #: skip moderation by sending it on the first request.
    acknowledged_warning: bool = False

    @field_validator("body")
    @classmethod
    def _strip(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Write something before posting.")
        return stripped


class ReviewReportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: ReviewReportReason
    detail: Optional[str] = Field(default=None, max_length=2000)
    #: Set when reporting the owner's reply rather than the review.
    reply_id: Optional[UUID] = None

    #: Set by the client when re-submitting after seeing the "this reads
    #: heated" nudge. Waives the WARN verdict only — the text is re-scored on
    #: the second pass and a BLOCK still refuses, so this can't be used to
    #: skip moderation by sending it on the first request.
    acknowledged_warning: bool = False

    @model_validator(mode="after")
    def _detail_required_for_other(self):
        # Must be a model_validator, not a field_validator on `detail`:
        # Pydantic v2 skips field validators when the field is absent and
        # takes its default, which is exactly the case this rule exists to
        # catch — "OTHER" with no explanation is unactionable, the moderator
        # has literally nothing to weigh.
        if self.reason == ReviewReportReason.OTHER and not (self.detail or "").strip():
            raise ValueError("Tell us what's wrong with it.")
        return self


class ReviewReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    review_id: UUID
    reply_id: Optional[UUID] = None
    reason: ReviewReportReason
    detail: Optional[str] = None
    status: ReviewReportStatus
    created_at: datetime


# ---------------------------------------------------------------------------
# Owner inbox
# ---------------------------------------------------------------------------


class OwnerReviewPlace(BaseModel):
    """Slim place summary embedded on an owner inbox row, so the list can
    show the restaurant name without an N+1 lookup."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    city: Optional[str] = None
    region: Optional[str] = None


class MyReviewRead(PlaceReviewRead):
    """The author's own review, with enough place context to render a list.

    The bare read carries only ``place_id``, which is unusable on a page
    listing reviews across restaurants — "you reviewed 4c7b789d…" tells
    someone nothing. Same slim embed the owner inbox uses.
    """

    place: Optional[OwnerReviewPlace] = None


class OwnerReviewRead(PlaceReviewRead):
    place: Optional[OwnerReviewPlace] = None
    #: Number of open reports against this review — an owner should know a
    #: review they're about to answer is already contested.
    open_report_count: int = 0


class OwnerReviewListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[OwnerReviewRead]
    total: int
    #: Across every place the owner manages. This is the number that drives
    #: the nav badge, which is the whole reason the inbox exists.
    needs_reply_count: int = 0
    #: Reviews that changed after the owner already replied — their published
    #: reply may now be answering words that aren't there. Also scoped to
    #: every managed place, for the same badge reason.
    edited_after_reply_count: int = 0
    next_offset: Optional[int] = None


# ---------------------------------------------------------------------------
# Admin moderation
# ---------------------------------------------------------------------------


class AdminReportReviewSnapshot(BaseModel):
    """The reported content plus the context a moderator needs.

    ``author_account_age_days`` and ``author_review_count`` are here because
    an unsupported accusation from a three-day-old account with no other
    activity is a different thing from a detailed account by an established
    reviewer — and no classifier can make that call.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    place_name: Optional[str] = None
    author: ReviewAuthorRead
    author_email: Optional[str] = None
    author_account_age_days: Optional[int] = None
    author_review_count: int = 0
    rating: int
    body: str
    status: PlaceReviewStatus
    created_at: datetime
    reply: Optional[PlaceReviewReplyRead] = None


class AdminPlaceReviewRow(BaseModel):
    """One review on a place, for the moderator's context list.

    Slimmer than the snapshot above on purpose: this answers "what else has
    been written about this restaurant", not "should this come down". The
    body is an excerpt — a moderator scanning for a pattern needs shape, not
    ten full reviews.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    author: ReviewAuthorRead
    rating: int
    excerpt: str
    status: PlaceReviewStatus
    open_report_count: int = 0
    created_at: datetime
    edited_at: Optional[datetime] = None
    #: True for the review the moderator is currently judging, so the list
    #: can mark it rather than making them match ids by eye.
    is_subject: bool = False


class AdminPlaceReviewsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    place_id: UUID
    place_name: Optional[str] = None
    items: list[AdminPlaceReviewRow] = Field(default_factory=list)
    total: int = 0
    #: Every status, not just published — a place with three removed reviews
    #: is telling you something a published-only count would hide.
    removed_count: int = 0
    hidden_count: int = 0


class AdminReviewReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    review_id: UUID
    reply_id: Optional[UUID] = None
    reason: ReviewReportReason
    detail: Optional[str] = None
    status: ReviewReportStatus
    reporter_display_name: Optional[str] = None
    reporter_email: Optional[str] = None
    #: OWNER when the report came from someone who manages the place.
    #: Owner-filed reports on their own reviews carry an obvious interest and
    #: a moderator should see that plainly.
    reporter_relationship: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    resolution_note: Optional[str] = None


class AdminReportQueueRow(BaseModel):
    """One grouped row in the queue — a review with all reports against it."""

    model_config = ConfigDict(from_attributes=True)

    review_id: UUID
    reply_id: Optional[UUID] = None
    place_id: UUID
    place_name: Optional[str] = None
    excerpt: str
    rating: int
    review_status: PlaceReviewStatus
    reasons: list[ReviewReportReason] = Field(default_factory=list)
    report_count: int
    open_report_count: int
    latest_report_at: datetime
    #: True when the reported content is the owner's reply rather than the
    #: diner's review. Owners behaving badly is a first-class case here.
    targets_reply: bool = False


class AdminReportQueueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[AdminReportQueueRow]
    total: int
    next_offset: Optional[int] = None


class AdminReportDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    review: AdminReportReviewSnapshot
    reports: list[AdminReviewReportRead]


class AdminResolveReportRequest(BaseModel):
    """Resolve every open report on a review, and optionally act on it.

    Verdict and action are separate fields because they're separate facts:
    a report can be upheld while the content stays up. There is deliberately
    no "open a dispute" action — a dispute is the consumer's own accusation
    to file, and lodging one on their behalf would put Trust Halal's weight
    behind a private person's claim.
    """

    model_config = ConfigDict(extra="forbid")

    decision: ReviewReportStatus
    action: ModerationAction = ModerationAction.NONE
    #: Shown verbatim to the author when the action hides or removes, so it's
    #: written to them, not as an internal memo.
    resolution_note: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("decision")
    @classmethod
    def _terminal(cls, v: ReviewReportStatus) -> ReviewReportStatus:
        if v == ReviewReportStatus.OPEN:
            raise ValueError("Resolve to UPHELD or DISMISSED.")
        return v


class AdminReviewStatusRequest(BaseModel):
    """Direct status override, for content staff catch without a report."""

    model_config = ConfigDict(extra="forbid")

    status: PlaceReviewStatus
    moderation_note: Optional[str] = Field(default=None, max_length=2000)
    #: Set to act on the reply instead of the review.
    reply_id: Optional[UUID] = None
