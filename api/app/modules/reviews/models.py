"""SQLAlchemy models for diner reviews, owner replies, and reports.

Three tables:

  * ``place_reviews`` — a diner's star rating + free text about a place.
    One per person per place, enforced by a unique constraint. That single
    constraint is the most valuable anti-spam control in the whole feature
    and it costs nothing: you edit your review rather than stacking more.
  * ``place_review_replies`` — the owner's public response. A separate table
    rather than columns on the review, because a reply has its own author,
    its own timestamps, and its own moderation state. Owners are reportable
    too; behaving badly in public is not an owner privilege.
  * ``place_review_reports`` — a flag raised against a review *or* a reply.

Aggregates (``places.review_rating_avg`` / ``review_count``) are denormalized
onto the place, mirroring how ``google_rating`` already lives there. That
keeps search and every result card free of a join, and is recomputed in the
same transaction as any change that could move the number.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

import sqlalchemy as sa
from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.reviews.enums import (
    PlaceReviewStatus,
    ReviewReportReason,
    ReviewReportStatus,
)


class PlaceReview(Base):
    """A diner's rating and written review of a place."""

    __tablename__ = "place_reviews"
    __table_args__ = (
        # One review per person per place. Editing replaces; it never stacks.
        UniqueConstraint(
            "place_id", "author_user_id", name="uq_place_reviews_place_author"
        ),
        CheckConstraint(
            "rating BETWEEN 1 AND 5", name="ck_place_reviews_rating_range"
        ),
        # Every public read is "visible reviews for this place, newest first".
        Index(
            "ix_place_reviews_place_status_created",
            "place_id",
            "status",
            sa.text("created_at DESC"),
        ),
        Index("ix_place_reviews_author", "author_user_id"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # CASCADE, unlike disputes and photos which use SET NULL. A review is a
    # personal opinion attributed by name; an orphaned one attributed to
    # nobody isn't useful to a reader and isn't something a deleted user
    # consented to leave behind. Deleting the account takes its reviews.
    author_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
    )

    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    # "When did you eat here" — cheap credibility signal, unverified by
    # design. We have no receipt or check-in mechanism, so treating this as
    # proof would be dishonest; it's context for readers and moderators.
    visited_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(
        sa.Enum(
            PlaceReviewStatus,
            name="place_review_status",
            native_enum=False,
            length=32,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        server_default=text("'PUBLISHED'"),
        index=True,
    )

    # Written to the author, not about them — it's rendered verbatim in the
    # removal email. Required when an admin removes or hides.
    moderation_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    moderated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    moderated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Non-null ⇒ render an "edited" marker. Readers deserve to know a review
    # changed after an owner replied to it.
    edited_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Reserved for a later "did the halal info here match what you saw?"
    # question that would route a No into the dispute flow. Nullable and
    # unused by v1 — one column now costs nothing and saves a migration if
    # we decide reviews should feed the trust profile.
    halal_matched: Mapped[Optional[bool]] = mapped_column(
        sa.Boolean, nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    reply: Mapped[Optional["PlaceReviewReply"]] = relationship(
        back_populates="review",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        uselist=False,
    )

    @property
    def is_visible(self) -> bool:
        return self.status == PlaceReviewStatus.PUBLISHED.value


class PlaceReviewReply(Base):
    """The owner's single public response to a review."""

    __tablename__ = "place_review_replies"
    __table_args__ = (
        # One reply per review, enforced in the schema rather than the
        # handler — Google's model, and it stops a review's comment section
        # from becoming an argument.
        UniqueConstraint("review_id", name="uq_place_review_replies_review"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.place_reviews.id", ondelete="CASCADE"),
        nullable=False,
    )

    # SET NULL: the reply speaks for the business, not the individual, so it
    # should survive a manager leaving and their account being deleted. The
    # organization_id below is the identity that actually matters here.
    author_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    body: Mapped[str] = mapped_column(Text, nullable=False)

    # Replies carry the same moderation states as reviews. An owner swearing
    # at a diner in public does more damage to Trust Halal than the review
    # that provoked it, because a reply carries the platform's implicit
    # endorsement in a way an anonymous review doesn't.
    status: Mapped[str] = mapped_column(
        sa.Enum(
            PlaceReviewStatus,
            name="place_review_status",
            native_enum=False,
            length=32,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        server_default=text("'PUBLISHED'"),
    )
    moderation_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    moderated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    moderated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    edited_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    review: Mapped["PlaceReview"] = relationship(back_populates="reply")

    @property
    def is_visible(self) -> bool:
        return self.status == PlaceReviewStatus.PUBLISHED.value


class PlaceReviewReport(Base):
    """A flag raised against a review or an owner reply."""

    __tablename__ = "place_review_reports"
    __table_args__ = (
        # One report per person per review. A brigade of one can't inflate
        # the queue, and the report count stays a meaningful signal.
        UniqueConstraint(
            "review_id", "reporter_user_id", name="uq_review_reports_review_reporter"
        ),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.place_reviews.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Non-null when the *reply* is what's being reported. The review_id is
    # still populated either way so the queue can group and the moderator
    # always sees the exchange in context — a reply almost never makes sense
    # to judge without the review that provoked it.
    reply_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.place_review_replies.id", ondelete="CASCADE"),
        nullable=True,
    )

    reporter_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    reason: Mapped[str] = mapped_column(
        sa.Enum(
            ReviewReportReason,
            name="review_report_reason",
            native_enum=False,
            length=32,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        sa.Enum(
            ReviewReportStatus,
            name="review_report_status",
            native_enum=False,
            length=32,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        server_default=text("'OPEN'"),
        index=True,
    )

    resolved_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolution_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
