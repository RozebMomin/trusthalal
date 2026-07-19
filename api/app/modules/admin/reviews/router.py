"""Admin moderation for reported reviews and owner replies.

Four endpoints:

  * ``GET  /admin/review-reports`` — the queue, grouped by review so a
    moderator sees one row per piece of content rather than one per
    complaint.
  * ``GET  /admin/review-reports/{review_id}`` — the content, every report
    against it, and the context needed to judge it.
  * ``POST /admin/review-reports/{review_id}/resolve`` — one decide
    endpoint taking a verdict plus an action.
  * ``POST /admin/reviews/{review_id}/status`` — direct override for
    content staff catch without a report.

Two deliberate absences worth stating, because both look like omissions:

**No pre-publish queue.** Reviews go live immediately; this surface is
reactive. A cold-start platform can't put a human between a diner writing
something and anyone reading it.

**No "open a dispute" action.** A dispute is a consumer's own accusation
against a place, and filing one on their behalf would put Trust Halal's
institutional weight behind a private person's claim and muddy a trail
that's supposed to record who alleged what. When a removed review contains
a factual claim worth investigating, the removal email points its author at
the dispute flow and they choose.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import NotFoundError
from app.db.deps import get_db
from app.modules.notifications.events import (
    notify_review_moderated,
    notify_review_report_resolved,
)
from app.modules.organizations.models import Organization, OrganizationMember, PlaceOwner
from app.modules.places.enums import PlaceEventType
from app.modules.places.models import Place
from app.modules.places.repo import log_place_event
from app.modules.reviews import repo
from app.modules.reviews.enums import (
    ModerationAction,
    PlaceReviewStatus,
    ReviewReportStatus,
)
from app.modules.reviews.models import PlaceReview, PlaceReviewReport
from app.modules.reviews.schemas import (
    AdminReportDetailResponse,
    AdminReportQueueResponse,
    AdminReportQueueRow,
    AdminReportReviewSnapshot,
    AdminResolveReportRequest,
    AdminReviewReportRead,
    AdminReviewStatusRequest,
    PlaceReviewReplyRead,
    ReviewAuthorRead,
)
from app.modules.users.enums import UserRole
from app.modules.users.models import User

admin_reviews_router = APIRouter(prefix="/admin", tags=["admin-reviews"])

_EXCERPT_CHARS = 240


def _excerpt(body: str) -> str:
    body = " ".join(body.split())
    return body if len(body) <= _EXCERPT_CHARS else body[:_EXCERPT_CHARS] + "…"


@admin_reviews_router.get(
    "/review-reports",
    response_model=AdminReportQueueResponse,
    summary="Reported reviews queue",
    description=(
        "Grouped by review: multiple complaints about the same content "
        "collapse into one row with a count, because they're one decision. "
        "Defaults to open reports."
    ),
)
def list_review_reports(
    report_status: ReviewReportStatus = Query(
        default=ReviewReportStatus.OPEN, alias="status"
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AdminReportQueueResponse:
    grouped = (
        select(
            PlaceReviewReport.review_id,
            func.count(PlaceReviewReport.id).label("report_count"),
            func.max(PlaceReviewReport.created_at).label("latest"),
        )
        .where(PlaceReviewReport.status == report_status.value)
        .group_by(PlaceReviewReport.review_id)
        .order_by(func.max(PlaceReviewReport.created_at).desc())
    )

    total = int(
        db.execute(select(func.count()).select_from(grouped.subquery())).scalar_one()
    )
    rows = db.execute(grouped.limit(limit).offset(offset)).all()

    items: list[AdminReportQueueRow] = []
    for review_id, report_count, latest in rows:
        review = repo.get_review(db, review_id)
        if review is None:  # cascade raced us
            continue

        reports = db.execute(
            select(PlaceReviewReport).where(
                PlaceReviewReport.review_id == review_id
            )
        ).scalars().all()

        place = db.get(Place, review.place_id)
        targets_reply = any(r.reply_id is not None for r in reports)
        # When the reply is what's reported, the excerpt has to be the reply
        # — showing the diner's review for a complaint about the owner's
        # response would put the wrong text in front of the moderator.
        body = (
            review.reply.body
            if targets_reply and review.reply is not None
            else review.body
        )

        items.append(
            AdminReportQueueRow(
                review_id=review.id,
                reply_id=review.reply.id if (targets_reply and review.reply) else None,
                place_id=review.place_id,
                place_name=place.name if place else None,
                excerpt=_excerpt(body),
                rating=review.rating,
                review_status=PlaceReviewStatus(review.status),
                reasons=sorted({r.reason for r in reports}),
                report_count=int(report_count),
                open_report_count=len(
                    [r for r in reports if r.status == ReviewReportStatus.OPEN.value]
                ),
                latest_report_at=latest,
                targets_reply=targets_reply,
            )
        )

    return AdminReportQueueResponse(
        items=items,
        total=total,
        next_offset=(offset + limit) if (offset + limit) < total else None,
    )


@admin_reviews_router.get(
    "/review-reports/{review_id}",
    response_model=AdminReportDetailResponse,
    summary="Reported review with full context",
    description=(
        "Includes author account age and review count. Those aren't "
        "decorative: an unsupported accusation from a three-day-old account "
        "with no other activity is a different thing from a detailed account "
        "by an established reviewer, and no classifier can make that call."
    ),
)
def get_review_report(
    review_id: UUID,
    _admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AdminReportDetailResponse:
    review = repo.get_review(db, review_id)
    if review is None:
        raise NotFoundError("REVIEW_NOT_FOUND", "That review doesn't exist.")

    author = db.get(User, review.author_user_id)
    place = db.get(Place, review.place_id)

    age_days: Optional[int] = None
    if author is not None and author.created_at is not None:
        age_days = (datetime.now(timezone.utc) - author.created_at).days

    author_review_count = int(
        db.execute(
            select(func.count(PlaceReview.id)).where(
                PlaceReview.author_user_id == review.author_user_id
            )
        ).scalar_one()
    )

    reply_read: Optional[PlaceReviewReplyRead] = None
    if review.reply is not None:
        org = db.get(Organization, review.reply.organization_id)
        reply_read = PlaceReviewReplyRead(
            id=review.reply.id,
            review_id=review.id,
            organization_id=review.reply.organization_id,
            organization_name=org.name if org else None,
            body=review.reply.body,
            edited_at=review.reply.edited_at,
            created_at=review.reply.created_at,
        )

    reports = db.execute(
        select(PlaceReviewReport)
        .where(PlaceReviewReport.review_id == review_id)
        .order_by(PlaceReviewReport.created_at.desc())
    ).scalars().all()

    # Whether each reporter manages this place. An owner reporting a review
    # of their own restaurant has an obvious interest, and a moderator should
    # see that plainly rather than having to go and check.
    manager_ids = set(
        db.execute(
            select(OrganizationMember.user_id)
            .join(
                PlaceOwner,
                PlaceOwner.organization_id == OrganizationMember.organization_id,
            )
            .where(
                PlaceOwner.place_id == review.place_id,
                PlaceOwner.status.in_(("ACTIVE", "VERIFIED")),
                OrganizationMember.status == "ACTIVE",
            )
        ).scalars().all()
    )

    report_reads: list[AdminReviewReportRead] = []
    for r in reports:
        reporter = db.get(User, r.reporter_user_id)
        report_reads.append(
            AdminReviewReportRead(
                id=r.id,
                review_id=r.review_id,
                reply_id=r.reply_id,
                reason=r.reason,
                detail=r.detail,
                status=ReviewReportStatus(r.status),
                reporter_display_name=reporter.display_name if reporter else None,
                reporter_email=reporter.email if reporter else None,
                reporter_relationship=(
                    "OWNER" if r.reporter_user_id in manager_ids else "DINER"
                ),
                created_at=r.created_at,
                resolved_at=r.resolved_at,
                resolution_note=r.resolution_note,
            )
        )

    snapshot = AdminReportReviewSnapshot(
        id=review.id,
        place_id=review.place_id,
        place_name=place.name if place else None,
        author=ReviewAuthorRead(
            id=review.author_user_id,
            display_name=author.display_name if author else None,
        ),
        author_email=author.email if author else None,
        author_account_age_days=age_days,
        author_review_count=author_review_count,
        rating=review.rating,
        body=review.body,
        status=PlaceReviewStatus(review.status),
        created_at=review.created_at,
        reply=reply_read,
    )

    return AdminReportDetailResponse(review=snapshot, reports=report_reads)


@admin_reviews_router.post(
    "/review-reports/{review_id}/resolve",
    response_model=AdminReportDetailResponse,
    summary="Resolve the reports on a review",
    description=(
        "Closes every open report on the review in one decision — the "
        "moderator looked once and reached one conclusion. `decision` is the "
        "verdict on the reports; `action` is what happens to the content. "
        "They're separate because a report can be valid while the content "
        "stays up. A note is required whenever the action hides or removes, "
        "and is shown to the author verbatim."
    ),
)
def resolve_review_report(
    review_id: UUID,
    payload: AdminResolveReportRequest,
    background: BackgroundTasks,
    admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AdminReportDetailResponse:
    review = repo.get_review(db, review_id)
    if review is None:
        raise NotFoundError("REVIEW_NOT_FOUND", "That review doesn't exist.")

    target_reply = any(
        r.reply_id is not None
        for r in db.execute(
            select(PlaceReviewReport).where(
                PlaceReviewReport.review_id == review_id,
                PlaceReviewReport.status == ReviewReportStatus.OPEN.value,
            )
        ).scalars().all()
    )

    new_status: PlaceReviewStatus | None = None
    if payload.action == ModerationAction.HIDE:
        new_status = PlaceReviewStatus.HIDDEN
    elif payload.action == ModerationAction.REMOVE:
        new_status = PlaceReviewStatus.REMOVED

    if new_status is not None:
        if target_reply and review.reply is not None:
            repo.set_reply_status(
                db,
                reply=review.reply,
                status=new_status,
                moderator_user_id=admin.id,
                note=payload.resolution_note,
            )
        else:
            repo.set_review_status(
                db,
                review=review,
                status=new_status,
                moderator_user_id=admin.id,
                note=payload.resolution_note,
            )
            if new_status == PlaceReviewStatus.REMOVED:
                log_place_event(
                    db,
                    place_id=review.place_id,
                    event_type=PlaceEventType.REVIEW_REMOVED,
                    actor_user_id=admin.id,
                    message="A review was removed by moderation.",
                )

    resolved = repo.resolve_reports_for_review(
        db,
        review_id=review_id,
        decision=payload.decision,
        resolver_user_id=admin.id,
        note=payload.resolution_note,
    )
    db.commit()
    db.refresh(review)

    track(
        "review_moderated",
        distinct_id=admin.id,
        properties={
            "review_id": str(review_id),
            "decision": payload.decision.value,
            "action": payload.action.value,
            "reports_closed": resolved,
        },
    )

    # The author is told whenever their content came down. Silent moderation
    # is indistinguishable from a bug to the person it happened to.
    if new_status is not None:
        notify_review_moderated(
            background,
            db,
            review=review,
            status=new_status,
            note=payload.resolution_note,
            targeted_reply=bool(target_reply and review.reply is not None),
        )
    notify_review_report_resolved(
        background, db, review=review, decision=payload.decision
    )

    return get_review_report(review_id=review_id, _admin=admin, db=db)


@admin_reviews_router.post(
    "/reviews/{review_id}/status",
    response_model=AdminReportDetailResponse,
    summary="Set a review's or reply's status directly",
    description=(
        "For content staff find themselves, with no report behind it. Same "
        "note requirement: hiding or removing always tells the author why."
    ),
)
def set_review_status(
    review_id: UUID,
    payload: AdminReviewStatusRequest,
    background: BackgroundTasks,
    admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AdminReportDetailResponse:
    review = repo.get_review(db, review_id)
    if review is None:
        raise NotFoundError("REVIEW_NOT_FOUND", "That review doesn't exist.")

    targeted_reply = payload.reply_id is not None
    if targeted_reply:
        if review.reply is None or review.reply.id != payload.reply_id:
            raise NotFoundError("REPLY_NOT_FOUND", "That reply doesn't exist.")
        repo.set_reply_status(
            db,
            reply=review.reply,
            status=payload.status,
            moderator_user_id=admin.id,
            note=payload.moderation_note,
        )
    else:
        repo.set_review_status(
            db,
            review=review,
            status=payload.status,
            moderator_user_id=admin.id,
            note=payload.moderation_note,
        )
        if payload.status == PlaceReviewStatus.REMOVED:
            log_place_event(
                db,
                place_id=review.place_id,
                event_type=PlaceEventType.REVIEW_REMOVED,
                actor_user_id=admin.id,
                message="A review was removed by moderation.",
            )

    db.commit()
    db.refresh(review)

    track(
        "review_moderated",
        distinct_id=admin.id,
        properties={"review_id": str(review_id), "action": payload.status.value},
    )
    if payload.status != PlaceReviewStatus.PUBLISHED:
        notify_review_moderated(
            background,
            db,
            review=review,
            status=payload.status,
            note=payload.moderation_note,
            targeted_reply=targeted_reply,
        )

    return get_review_report(review_id=review_id, _admin=admin, db=db)
