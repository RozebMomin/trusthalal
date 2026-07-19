"""Data access + business rules for reviews, replies, and reports.

House convention: no service layer — logic lives here, and the caller (the
router) owns the transaction boundary and fires notifications. Repo functions
``db.add``/``db.flush`` and let the router commit, except where a function is
documented as owning its own commit.

The one thing worth reading before changing anything here is
``recompute_place_review_stats``: every mutation that can move a place's
rating has to call it in the same transaction, or the denormalized aggregate
silently drifts from the reviews it claims to summarize.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Sequence
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from app.core.config import settings
from app.modules.organizations.models import OrganizationMember, PlaceOwner
from app.modules.places.models import Place, PlacePhoto
from app.modules.places.photos.storage_cleanup import enqueue_orphans
from app.modules.reviews.enums import (
    PlaceReviewStatus,
    ReviewReportStatus,
    ReviewSort,
)
from app.modules.reviews.models import (
    PlaceReview,
    PlaceReviewReply,
    PlaceReviewReport,
)

_VISIBLE = PlaceReviewStatus.PUBLISHED.value


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------


def recompute_place_review_stats(db: Session, *, place_id: UUID) -> None:
    """Recompute ``places.review_rating_avg`` / ``review_count``.

    Must be called inside the same transaction as any insert, edit, delete,
    or status change on a review of this place. It is deliberately a full
    recount rather than an incremental adjustment: incremental arithmetic
    drifts the moment one path forgets to apply its delta, and a rating
    that's quietly wrong is worse than a slightly slower write. The count is
    small (reviews per place, not per platform) and it's one indexed query.

    PUBLISHED only — hidden and removed reviews must not move the number, or
    moderation would have no effect on the thing readers actually see.
    """
    row = db.execute(
        select(
            func.count(PlaceReview.id),
            func.avg(PlaceReview.rating),
        ).where(
            PlaceReview.place_id == place_id,
            PlaceReview.status == _VISIBLE,
        )
    ).one()

    count, avg = int(row[0] or 0), row[1]

    place = db.get(Place, place_id)
    if place is None:  # pragma: no cover - defensive
        return

    place.review_count = count
    # Round to one decimal to match the column and the Google field beside
    # it, so the two numbers are visually comparable.
    place.review_rating_avg = round(float(avg), 1) if avg is not None else None
    db.add(place)


def rating_histogram(db: Session, *, place_id: UUID) -> dict[str, int]:
    """1–5 → count, zero-filled. Powers the bar chart in the list header."""
    rows = db.execute(
        select(PlaceReview.rating, func.count(PlaceReview.id))
        .where(PlaceReview.place_id == place_id, PlaceReview.status == _VISIBLE)
        .group_by(PlaceReview.rating)
    ).all()
    hist = {str(n): 0 for n in range(1, 6)}
    for rating, count in rows:
        hist[str(int(rating))] = int(count)
    return hist


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def _sorted(stmt: Select, sort: ReviewSort) -> Select:
    if sort == ReviewSort.RATING_HIGH:
        return stmt.order_by(PlaceReview.rating.desc(), PlaceReview.created_at.desc())
    if sort == ReviewSort.RATING_LOW:
        return stmt.order_by(PlaceReview.rating.asc(), PlaceReview.created_at.desc())
    return stmt.order_by(PlaceReview.created_at.desc())


def list_place_reviews(
    db: Session,
    *,
    place_id: UUID,
    sort: ReviewSort = ReviewSort.RECENT,
    limit: int = 10,
    offset: int = 0,
) -> tuple[list[PlaceReview], int]:
    """Visible reviews for a place, newest-first by default.

    Replies are eager-loaded (``selectin`` on the relationship) so rendering
    a page of reviews with their owner responses is two queries, not eleven.
    """
    base = select(PlaceReview).where(
        PlaceReview.place_id == place_id, PlaceReview.status == _VISIBLE
    )

    total = int(
        db.execute(
            select(func.count()).select_from(base.subquery())
        ).scalar_one()
    )

    rows = (
        db.execute(_sorted(base, sort).limit(limit).offset(offset))
        .scalars()
        .unique()
        .all()
    )
    return list(rows), total


def get_review(db: Session, review_id: UUID) -> Optional[PlaceReview]:
    return db.execute(
        select(PlaceReview).where(PlaceReview.id == review_id)
    ).scalar_one_or_none()


def get_review_for_author(
    db: Session, *, review_id: UUID, author_user_id: UUID
) -> PlaceReview:
    """The caller's own review, or 404.

    404 rather than 403 for someone else's row — same existence-non-disclosure
    rule the verification-visits module already follows. A 403 confirms the id
    is real, which is a small leak but a free one to avoid.
    """
    row = get_review(db, review_id)
    if row is None or row.author_user_id != author_user_id:
        raise NotFoundError("REVIEW_NOT_FOUND", "That review doesn't exist.")
    return row


def get_my_review_for_place(
    db: Session, *, place_id: UUID, author_user_id: UUID
) -> Optional[PlaceReview]:
    return db.execute(
        select(PlaceReview).where(
            PlaceReview.place_id == place_id,
            PlaceReview.author_user_id == author_user_id,
        )
    ).scalar_one_or_none()


def list_my_reviews(
    db: Session, *, author_user_id: UUID, limit: int = 50, offset: int = 0
) -> tuple[list[PlaceReview], int]:
    """Everything the caller has written, including hidden and removed ones.

    Deliberately not filtered to visible: a removed review must be visible to
    its author along with the reason. Moderation that happens silently is
    indistinguishable from a bug, and the author is the one person who is
    owed an explanation.
    """
    base = select(PlaceReview).where(PlaceReview.author_user_id == author_user_id)
    total = int(
        db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    )
    rows = (
        db.execute(
            base.order_by(PlaceReview.created_at.desc()).limit(limit).offset(offset)
        )
        .scalars()
        .unique()
        .all()
    )
    return list(rows), total


def reported_review_ids_for_user(
    db: Session, *, user_id: UUID, review_ids: Sequence[UUID]
) -> set[UUID]:
    """Which of these the caller already reported.

    Batched so the list endpoint can render "Reported" instead of offering a
    button that will 409 — one query for the page, not one per row.
    """
    if not review_ids:
        return set()
    rows = db.execute(
        select(PlaceReviewReport.review_id).where(
            PlaceReviewReport.reporter_user_id == user_id,
            PlaceReviewReport.review_id.in_(list(review_ids)),
        )
    ).scalars().all()
    return set(rows)


def open_report_counts(
    db: Session, review_ids: Sequence[UUID]
) -> dict[UUID, int]:
    if not review_ids:
        return {}
    rows = db.execute(
        select(PlaceReviewReport.review_id, func.count(PlaceReviewReport.id))
        .where(
            PlaceReviewReport.review_id.in_(list(review_ids)),
            PlaceReviewReport.status == ReviewReportStatus.OPEN.value,
        )
        .group_by(PlaceReviewReport.review_id)
    ).all()
    return {rid: int(c) for rid, c in rows}


# ---------------------------------------------------------------------------
# Writes — reviews
# ---------------------------------------------------------------------------


def create_review(
    db: Session,
    *,
    place_id: UUID,
    author_user_id: UUID,
    rating: int,
    body: str,
    visited_on=None,
) -> PlaceReview:
    """Create a review. Caller owns the commit.

    The one-per-place rule is enforced here with an explicit pre-check rather
    than by catching the unique violation, so the error can carry the
    existing review's id — the client redirects to edit instead of showing a
    dead end for something the user reasonably thinks is a new action.
    """
    place = db.get(Place, place_id)
    if place is None or place.is_deleted:
        raise NotFoundError("PLACE_NOT_FOUND", "That restaurant doesn't exist.")

    existing = get_my_review_for_place(
        db, place_id=place_id, author_user_id=author_user_id
    )
    if existing is not None:
        raise ConflictError(
            "REVIEW_ALREADY_EXISTS",
            "You've already reviewed this restaurant. Edit your review instead.",
            extra={"review_id": str(existing.id)},
        )

    row = PlaceReview(
        place_id=place_id,
        author_user_id=author_user_id,
        rating=rating,
        body=body,
        visited_on=visited_on,
        status=PlaceReviewStatus.PUBLISHED.value,
    )
    db.add(row)
    db.flush()
    recompute_place_review_stats(db, place_id=place_id)
    return row


def update_review(
    db: Session,
    *,
    review: PlaceReview,
    rating: int | None = None,
    body: str | None = None,
    visited_on=None,
    visited_on_provided: bool = False,
) -> PlaceReview:
    """Edit in place, stamping ``edited_at``. Caller owns the commit.

    A removed review can't be edited back into visibility — that would let
    anyone whose content was taken down simply re-post it. Hidden ones can be
    edited, which is the point of hidden being reversible: fix it and ask.
    """
    if review.status == PlaceReviewStatus.REMOVED.value:
        raise ForbiddenError(
            "REVIEW_REMOVED",
            "This review was removed by moderation and can't be edited.",
        )

    changed = False
    if rating is not None and rating != review.rating:
        review.rating = rating
        changed = True
    if body is not None and body != review.body:
        review.body = body
        changed = True
    if visited_on_provided and visited_on != review.visited_on:
        review.visited_on = visited_on
        changed = True

    if changed:
        # Readers deserve to know a review changed after an owner replied to
        # it — otherwise a reply can be made to look like a response to
        # something that was never said.
        review.edited_at = datetime.now(timezone.utc)
        db.add(review)
        db.flush()
        recompute_place_review_stats(db, place_id=review.place_id)

    return review


def delete_review(db: Session, *, review: PlaceReview) -> UUID:
    """Hard delete, returning the place id so the caller can log an event.

    Hard rather than soft: these are the author's own words and they're
    entitled to withdraw them. The reply, photos, and reports cascade. Admin
    moderation uses status instead, because *that* needs an audit trail.

    The photo rows cascade at the *database* level, which means no application
    code runs and the storage paths become unrecoverable the instant the delete
    lands. So the paths are read and queued for the bucket sweeper first —
    reordering these two statements silently reintroduces the leak.
    """
    place_id = review.place_id

    orphaned_paths = (
        db.execute(
            select(PlacePhoto.storage_path).where(PlacePhoto.review_id == review.id)
        )
        .scalars()
        .all()
    )
    enqueue_orphans(
        db,
        bucket=settings.SUPABASE_PHOTOS_BUCKET,
        storage_paths=orphaned_paths,
        reason="review_deleted",
    )

    db.delete(review)
    db.flush()
    recompute_place_review_stats(db, place_id=place_id)
    return place_id


# ---------------------------------------------------------------------------
# Writes — replies
# ---------------------------------------------------------------------------


def get_reply(db: Session, reply_id: UUID) -> Optional[PlaceReviewReply]:
    return db.execute(
        select(PlaceReviewReply).where(PlaceReviewReply.id == reply_id)
    ).scalar_one_or_none()


def owning_organization_for_place(
    db: Session, *, place_id: UUID, user_id: UUID
) -> Optional[UUID]:
    """The org this user manages that owns this place, if any.

    Returns the id so the reply can be attributed to the business rather than
    the individual — the byline is "Response from the owner", and a manager
    leaving shouldn't orphan it.
    """
    return db.execute(
        select(PlaceOwner.organization_id)
        .join(
            OrganizationMember,
            OrganizationMember.organization_id == PlaceOwner.organization_id,
        )
        .where(
            PlaceOwner.place_id == place_id,
            PlaceOwner.status.in_(("ACTIVE", "VERIFIED")),
            OrganizationMember.user_id == user_id,
            OrganizationMember.status == "ACTIVE",
            OrganizationMember.role.in_(("OWNER_ADMIN", "MANAGER")),
        )
        .limit(1)
    ).scalar_one_or_none()


def create_reply(
    db: Session,
    *,
    review: PlaceReview,
    author_user_id: UUID,
    organization_id: UUID,
    body: str,
) -> PlaceReviewReply:
    """One public reply per review. Caller owns the commit."""
    if review.reply is not None:
        raise ConflictError(
            "REVIEW_REPLY_EXISTS",
            "You've already replied to this review. Edit your reply instead.",
            extra={"reply_id": str(review.reply.id)},
        )
    if review.status != _VISIBLE:
        # Replying to something readers can't see would produce a public
        # response to an invisible review.
        raise ConflictError(
            "REVIEW_NOT_VISIBLE",
            "This review isn't publicly visible, so it can't be replied to.",
        )

    row = PlaceReviewReply(
        review_id=review.id,
        author_user_id=author_user_id,
        organization_id=organization_id,
        body=body,
        status=PlaceReviewStatus.PUBLISHED.value,
    )
    db.add(row)
    db.flush()
    return row


def update_reply(
    db: Session, *, reply: PlaceReviewReply, body: str
) -> PlaceReviewReply:
    if reply.status == PlaceReviewStatus.REMOVED.value:
        raise ForbiddenError(
            "REPLY_REMOVED",
            "This reply was removed by moderation and can't be edited.",
        )
    if body != reply.body:
        reply.body = body
        reply.edited_at = datetime.now(timezone.utc)
        db.add(reply)
        db.flush()
    return reply


def delete_reply(db: Session, *, reply: PlaceReviewReply) -> None:
    db.delete(reply)
    db.flush()


# ---------------------------------------------------------------------------
# Writes — reports
# ---------------------------------------------------------------------------


def create_report(
    db: Session,
    *,
    review: PlaceReview,
    reporter_user_id: UUID,
    reason: str,
    detail: str | None,
    reply_id: UUID | None = None,
) -> PlaceReviewReport:
    """File a report. Caller owns the commit.

    One per person per review, so a single motivated reporter can't inflate
    the queue and make the report count meaningless as a triage signal.
    """
    if reply_id is not None:
        reply = get_reply(db, reply_id)
        if reply is None or reply.review_id != review.id:
            raise NotFoundError("REPLY_NOT_FOUND", "That reply doesn't exist.")

    existing = db.execute(
        select(PlaceReviewReport).where(
            PlaceReviewReport.review_id == review.id,
            PlaceReviewReport.reporter_user_id == reporter_user_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(
            "REVIEW_ALREADY_REPORTED",
            "You've already reported this. We'll take a look.",
        )

    row = PlaceReviewReport(
        review_id=review.id,
        reply_id=reply_id,
        reporter_user_id=reporter_user_id,
        reason=reason,
        detail=(detail or None),
        status=ReviewReportStatus.OPEN.value,
    )
    db.add(row)
    db.flush()
    return row


# ---------------------------------------------------------------------------
# Moderation
# ---------------------------------------------------------------------------


def set_review_status(
    db: Session,
    *,
    review: PlaceReview,
    status: PlaceReviewStatus,
    moderator_user_id: UUID,
    note: str | None,
) -> PlaceReview:
    """Hide, remove, or restore a review. Caller owns the commit.

    The note is required for anything that takes content down, because it's
    shown to the author verbatim. Enforced here rather than only in the
    schema so a direct repo caller can't skip it.
    """
    if status in (PlaceReviewStatus.HIDDEN, PlaceReviewStatus.REMOVED) and not (
        note or ""
    ).strip():
        raise BadRequestError(
            "MODERATION_NOTE_REQUIRED",
            "Explain why — the author is shown this reason.",
        )

    review.status = status.value
    review.moderation_note = (note or None) if status != PlaceReviewStatus.PUBLISHED else None
    review.moderated_by_user_id = moderator_user_id
    review.moderated_at = datetime.now(timezone.utc)
    db.add(review)
    db.flush()
    # Visibility changed, so the place's rating has to change with it.
    recompute_place_review_stats(db, place_id=review.place_id)
    return review


def set_reply_status(
    db: Session,
    *,
    reply: PlaceReviewReply,
    status: PlaceReviewStatus,
    moderator_user_id: UUID,
    note: str | None,
) -> PlaceReviewReply:
    """Same treatment for owner replies — owners are not exempt.

    No stats recompute: a reply doesn't carry a rating, so hiding one doesn't
    move the place's average.
    """
    if status in (PlaceReviewStatus.HIDDEN, PlaceReviewStatus.REMOVED) and not (
        note or ""
    ).strip():
        raise BadRequestError(
            "MODERATION_NOTE_REQUIRED",
            "Explain why — the author is shown this reason.",
        )

    reply.status = status.value
    reply.moderation_note = (note or None) if status != PlaceReviewStatus.PUBLISHED else None
    reply.moderated_by_user_id = moderator_user_id
    reply.moderated_at = datetime.now(timezone.utc)
    db.add(reply)
    db.flush()
    return reply


def resolve_reports_for_review(
    db: Session,
    *,
    review_id: UUID,
    decision: ReviewReportStatus,
    resolver_user_id: UUID,
    note: str | None,
) -> int:
    """Close every open report on a review. Returns how many.

    Resolves the whole group rather than one report at a time: the moderator
    looked at the content once and reached one conclusion, so leaving sibling
    reports open would just re-surface the same decision tomorrow.
    """
    rows = db.execute(
        select(PlaceReviewReport).where(
            PlaceReviewReport.review_id == review_id,
            PlaceReviewReport.status == ReviewReportStatus.OPEN.value,
        )
    ).scalars().all()

    now = datetime.now(timezone.utc)
    for row in rows:
        row.status = decision.value
        row.resolved_by_user_id = resolver_user_id
        row.resolved_at = now
        row.resolution_note = note or None
        db.add(row)

    db.flush()
    return len(rows)
