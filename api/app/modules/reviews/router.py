"""HTTP endpoints for diner reviews, owner replies, and reports.

Three routers, registered bare in ``main.py``:

  * ``place_reviews_router`` — ``/places/{place_id}/reviews``, the public
    list plus create.
  * ``me_reviews_router`` — ``/me/reviews``, the author's own reviews
    (including moderated ones, with the reason).
  * ``owner_reviews_router`` — ``/me/place-reviews`` inbox and the
    reply endpoints under ``/places/reviews/{review_id}``.

Two cross-cutting rules live here rather than in the repo, because both are
about the request rather than the data:

**Every free-text field is moderated before it lands.** Review bodies, reply
bodies, and report details all go through the same check at the same
thresholds. Owners are not exempt — see ``_moderate``.

**Moderation runs on submit, not while typing.** There's no
``/moderation/check-text`` endpoint on purpose: scoring on every keystroke
would hand someone an oracle to iterate against until they found phrasing
that passes, and would be a free classifier hanging off the API.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.auth import (
    CurrentUser,
    get_current_user,
    get_current_user_optional,
    require_verified_email,
)
from app.core.exceptions import (
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    ServiceUnavailableError,
)
from app.core.rate_limit import limiter, user_or_ip_key
from app.core.text_moderation import (
    TextModerationClient,
    TextModerationError,
    get_text_moderation_client,
    rejection_message,
)
from app.core.storage import StorageClient, get_photos_storage_client
from app.db.deps import get_db
from app.modules.notifications.events import (
    notify_review_edited_after_reply,
    notify_review_posted,
    notify_review_replied,
)
from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.places.enums import PlaceEventType
from app.modules.places.models import Place, PlacePhoto
from app.modules.places.repo import log_place_event
from app.modules.reviews import repo
from app.modules.reviews.enums import PlaceReviewStatus, ReviewSort
from app.modules.reviews.models import PlaceReview
from app.modules.reviews.schemas import (
    OwnerReviewListResponse,
    OwnerReviewPlace,
    OwnerReviewRead,
    PlaceReviewCreate,
    PlaceReviewListResponse,
    PlaceReviewRead,
    PlaceReviewReplyCreate,
    PlaceReviewReplyRead,
    PlaceReviewUpdate,
    ReviewAuthorRead,
    ReviewPhotoRead,
    ReviewReportCreate,
    ReviewReportRead,
    ReviewSummary,
)
from app.modules.users.models import User

place_reviews_router = APIRouter(prefix="/places", tags=["reviews"])
me_reviews_router = APIRouter(prefix="/me/reviews", tags=["reviews"])
owner_reviews_router = APIRouter(tags=["reviews"])


# ---------------------------------------------------------------------------
# Moderation helper
# ---------------------------------------------------------------------------


def _moderate(text: str, moderator: TextModerationClient) -> None:
    """Refuse text that trips the content filter. Raises or returns None.

    Applied identically to diners and owners. The instinct when building this
    is to trust the verified business more; that instinct is wrong. An owner
    swearing at a diner in public does more damage to Trust Halal than the
    review that provoked it, because a reply carries the platform's implicit
    endorsement in a way an anonymous review doesn't.

    Fail-closed on an outage, matching the photo pipeline: no answer from the
    scanner means no publish. The client keeps the draft and shows
    "that's on us, not your review" — the one thing this must never do is
    imply we judged the content when we simply couldn't reach Google.
    """
    try:
        result = moderator.evaluate(text)
    except TextModerationError as exc:
        raise ServiceUnavailableError(
            "MODERATION_UNAVAILABLE",
            "We couldn't run our content check just now — that's on us, not "
            "your writing. Your draft is saved; try posting again in a moment.",
        ) from exc

    if result.blocked:
        raise BadRequestError(
            "REVIEW_TEXT_REJECTED",
            rejection_message(result),
            extra={"category": result.category},
        )


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def _author_read(db: Session, user_id: UUID) -> ReviewAuthorRead:
    user = db.get(User, user_id)
    # No role field, ever. A verifier's review renders like everyone else's.
    return ReviewAuthorRead(
        id=user_id, display_name=user.display_name if user else None
    )


def _photos_for(db: Session, review_ids: list[UUID], storage) -> dict[UUID, list[ReviewPhotoRead]]:
    """Photos grouped by review id.

    Batched rather than per-review: rendering a page of ten reviews should
    cost one query here, not ten. URLs are derived at read time from the
    storage path (never stored) so the bucket or CDN can rotate.
    """
    if not review_ids:
        return {}
    rows = db.execute(
        select(PlacePhoto).where(
            PlacePhoto.review_id.in_(review_ids),
            PlacePhoto.deleted_at.is_(None),
        )
    ).scalars().all()
    out: dict[UUID, list[ReviewPhotoRead]] = {}
    for row in rows:
        out.setdefault(row.review_id, []).append(
            ReviewPhotoRead(id=row.id, url=storage.public_url(row.storage_path))
        )
    return out


def _reply_read(db: Session, reply) -> Optional[PlaceReviewReplyRead]:
    if reply is None or reply.status != PlaceReviewStatus.PUBLISHED.value:
        return None
    org = db.get(Organization, reply.organization_id)
    return PlaceReviewReplyRead(
        id=reply.id,
        review_id=reply.review_id,
        organization_id=reply.organization_id,
        organization_name=org.name if org else None,
        body=reply.body,
        edited_at=reply.edited_at,
        created_at=reply.created_at,
    )


def _review_read(
    db: Session,
    review: PlaceReview,
    *,
    viewer_id: UUID | None = None,
    reported: bool = False,
    include_moderation_note: bool = False,
    photos: list[ReviewPhotoRead] | None = None,
) -> PlaceReviewRead:
    return PlaceReviewRead(
        id=review.id,
        place_id=review.place_id,
        author=_author_read(db, review.author_user_id),
        rating=review.rating,
        body=review.body,
        visited_on=review.visited_on,
        status=PlaceReviewStatus(review.status),
        edited_at=review.edited_at,
        created_at=review.created_at,
        photos=photos or [],
        reply=_reply_read(db, review.reply),
        is_mine=viewer_id is not None and review.author_user_id == viewer_id,
        reported_by_me=reported,
        moderation_note=review.moderation_note if include_moderation_note else None,
        edited_after_reply=repo.was_edited_after_reply(review),
    )


# ---------------------------------------------------------------------------
# Public list + create
# ---------------------------------------------------------------------------


@place_reviews_router.get(
    "/{place_id}/reviews",
    response_model=PlaceReviewListResponse,
    summary="Published reviews for a place, with rating summary",
    description=(
        "Anonymous-friendly. Returns the Trust Halal average and histogram "
        "alongside Google's rating so a client can label both — a bare "
        "unattributed star is the thing this replaces. `sort` is one of "
        "`recent` (default), `rating_high`, `rating_low`."
    ),
)
def list_reviews(
    place_id: UUID,
    sort: ReviewSort = Query(default=ReviewSort.RECENT),
    limit: int = Query(default=10, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
    storage: StorageClient = Depends(get_photos_storage_client),
) -> PlaceReviewListResponse:
    place = db.get(Place, place_id)
    if place is None or place.is_deleted:
        raise NotFoundError("PLACE_NOT_FOUND", "That restaurant doesn't exist.")

    rows, total = repo.list_place_reviews(
        db, place_id=place_id, sort=sort, limit=limit, offset=offset
    )

    reported: set[UUID] = set()
    my_review_id: UUID | None = None
    can_review = False
    if user is not None:
        reported = repo.reported_review_ids_for_user(
            db, user_id=user.id, review_ids=[r.id for r in rows]
        )
        mine = repo.get_my_review_for_place(
            db, place_id=place_id, author_user_id=user.id
        )
        my_review_id = mine.id if mine else None
        # Surfaced so the client can explain *why* the button is unavailable
        # rather than hiding it and leaving the user to guess.
        user_row = db.get(User, user.id)
        verified = user_row is not None and user_row.email_verified_at is not None
        can_review = verified and mine is None

    photos_by_review = _photos_for(db, [r.id for r in rows], storage)

    summary = ReviewSummary(
        average=float(place.review_rating_avg)
        if place.review_rating_avg is not None
        else None,
        count=place.review_count or 0,
        histogram=repo.rating_histogram(db, place_id=place_id),
        google_rating=float(place.google_rating)
        if place.google_rating is not None
        else None,
        google_rating_count=place.google_rating_count,
    )

    return PlaceReviewListResponse(
        summary=summary,
        items=[
            _review_read(
                db,
                r,
                viewer_id=user.id if user else None,
                reported=r.id in reported,
                photos=photos_by_review.get(r.id, []),
            )
            for r in rows
        ],
        total=total,
        next_offset=(offset + limit) if (offset + limit) < total else None,
        can_review=can_review,
        my_review_id=my_review_id,
    )


@place_reviews_router.post(
    "/{place_id}/reviews",
    response_model=PlaceReviewRead,
    status_code=status.HTTP_201_CREATED,
    summary="Write a review",
    description=(
        "Requires a signed-in account with a **confirmed email address** "
        "(403 `EMAIL_NOT_VERIFIED` otherwise). One review per person per "
        "place — a second attempt returns 409 `REVIEW_ALREADY_EXISTS` with "
        "the existing id so the client can switch to editing. Body text is "
        "screened on submit; 400 `REVIEW_TEXT_REJECTED` names the category. "
        "Rate-limited at 10/hour."
    ),
)
@limiter.limit("10/hour", key_func=user_or_ip_key)
def create_review(
    request: Request,
    place_id: UUID,
    payload: PlaceReviewCreate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(require_verified_email),
    db: Session = Depends(get_db),
    moderator: TextModerationClient = Depends(get_text_moderation_client),
) -> PlaceReviewRead:
    _moderate(payload.body, moderator)

    review = repo.create_review(
        db,
        place_id=place_id,
        author_user_id=user.id,
        rating=payload.rating,
        body=payload.body,
        visited_on=payload.visited_on,
    )

    log_place_event(
        db,
        place_id=place_id,
        event_type=PlaceEventType.REVIEW_POSTED,
        actor_user_id=user.id,
        message=f"{payload.rating}-star review posted.",
    )
    db.commit()
    db.refresh(review)

    track(
        "review_posted",
        distinct_id=user.id,
        properties={"place_id": str(place_id), "rating": payload.rating},
    )
    notify_review_posted(background, db, review=review)

    return _review_read(db, review, viewer_id=user.id)


# ---------------------------------------------------------------------------
# Author's own reviews
# ---------------------------------------------------------------------------


@me_reviews_router.get(
    "",
    response_model=list[PlaceReviewRead],
    summary="Reviews you've written",
    description=(
        "Includes hidden and removed reviews along with the moderation "
        "reason — removal is never silent to its author."
    ),
)
def list_my_reviews(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PlaceReviewRead]:
    rows, _total = repo.list_my_reviews(db, author_user_id=user.id)
    return [
        _review_read(db, r, viewer_id=user.id, include_moderation_note=True)
        for r in rows
    ]


@me_reviews_router.patch(
    "/{review_id}",
    response_model=PlaceReviewRead,
    summary="Edit your review",
    description=(
        "Author only; another user's id returns 404 rather than 403. Any "
        "changed body is re-screened. Sets an `edited` marker, because a "
        "review that changes after an owner replied would otherwise make the "
        "reply look like a response to something never said. "
        "Rate-limited at 30/hour."
    ),
)
@limiter.limit("30/hour", key_func=user_or_ip_key)
def update_my_review(
    request: Request,
    background: BackgroundTasks,
    review_id: UUID,
    payload: PlaceReviewUpdate,
    user: CurrentUser = Depends(require_verified_email),
    db: Session = Depends(get_db),
    moderator: TextModerationClient = Depends(get_text_moderation_client),
) -> PlaceReviewRead:
    review = repo.get_review_for_author(
        db, review_id=review_id, author_user_id=user.id
    )

    if payload.body is not None:
        _moderate(payload.body, moderator)

    # Whether there was already a reply has to be read *before* the update, so
    # the notify decision isn't affected by anything the edit does.
    had_reply = review.reply is not None

    fields = payload.model_dump(exclude_unset=True)
    edit = repo.update_review(
        db,
        review=review,
        rating=payload.rating,
        body=payload.body,
        visited_on=payload.visited_on,
        visited_on_provided="visited_on" in fields,
    )
    db.commit()
    db.refresh(review)

    # A reply is a public statement about specific words. When those words
    # change materially the owner's reply may now be answering something that
    # isn't there, and they're the only one who can fix it — so they have to
    # be told. Cosmetic edits stay silent on purpose; see update_review.
    if had_reply and edit.material:
        notify_review_edited_after_reply(
            background, db, review=review, previous_rating=edit.previous_rating
        )

    return _review_read(db, review, viewer_id=user.id, include_moderation_note=True)


@me_reviews_router.delete(
    "/{review_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete your review",
    description=(
        "Hard delete — these are your own words and you can withdraw them. "
        "The owner's reply and any attached photos go with it. Admin "
        "moderation uses status instead, so takedowns keep an audit trail."
    ),
)
def delete_my_review(
    review_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    review = repo.get_review_for_author(
        db, review_id=review_id, author_user_id=user.id
    )
    repo.delete_review(db, review=review)
    db.commit()


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


@place_reviews_router.post(
    "/reviews/{review_id}/report",
    response_model=ReviewReportRead,
    status_code=status.HTTP_201_CREATED,
    summary="Report a review or an owner reply",
    description=(
        "Set `reply_id` to report the owner's response instead of the "
        "review. One report per person per review (409 on a repeat), so the "
        "report count stays a meaningful triage signal. Rate-limited at "
        "20/hour."
    ),
)
@limiter.limit("20/hour", key_func=user_or_ip_key)
def report_review(
    request: Request,
    review_id: UUID,
    payload: ReviewReportCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    moderator: TextModerationClient = Depends(get_text_moderation_client),
) -> ReviewReportRead:
    review = repo.get_review(db, review_id)
    if review is None:
        raise NotFoundError("REVIEW_NOT_FOUND", "That review doesn't exist.")

    if payload.detail:
        # Reports land in front of a human, so the free text here gets the
        # same screening as anything public.
        _moderate(payload.detail, moderator)

    row = repo.create_report(
        db,
        review=review,
        reporter_user_id=user.id,
        reason=payload.reason.value,
        detail=payload.detail,
        reply_id=payload.reply_id,
    )
    db.commit()
    db.refresh(row)

    track(
        "review_reported",
        distinct_id=user.id,
        properties={"review_id": str(review_id), "reason": payload.reason.value},
    )
    return ReviewReportRead.model_validate(row)


# ---------------------------------------------------------------------------
# Owner inbox + replies
# ---------------------------------------------------------------------------


@owner_reviews_router.get(
    "/me/place-reviews",
    response_model=OwnerReviewListResponse,
    summary="Reviews across the places you manage",
    description=(
        "The owner inbox. Two actionable buckets:\n\n"
        "* `needs_reply=true` — reviews nobody has answered.\n"
        "* `edited_after_reply=true` — reviews that changed *after* the "
        "owner replied, so the published reply may no longer match what "
        "it sits under. These are ordered by when they were edited, not "
        "when they were posted: a review written months ago and rewritten "
        "today is today's problem.\n\n"
        "Both counts are always returned across every managed place, "
        "because they drive the nav badges — a count that changes when you "
        "click a filter isn't a badge, it's a search result."
    ),
)
def owner_review_inbox(
    place_id: Optional[UUID] = Query(default=None),
    needs_reply: bool = Query(default=False),
    edited_after_reply: bool = Query(default=False),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OwnerReviewListResponse:
    # Every place this user manages through an active org membership.
    managed = db.execute(
        select(PlaceOwner.place_id)
        .join(
            OrganizationMember,
            OrganizationMember.organization_id == PlaceOwner.organization_id,
        )
        .where(
            PlaceOwner.status.in_(("ACTIVE", "VERIFIED")),
            OrganizationMember.user_id == user.id,
            OrganizationMember.status == "ACTIVE",
            OrganizationMember.role.in_(("OWNER_ADMIN", "MANAGER")),
        )
    ).scalars().all()
    managed_ids = list(set(managed))

    if not managed_ids:
        return OwnerReviewListResponse(
            items=[],
            total=0,
            needs_reply_count=0,
            edited_after_reply_count=0,
            next_offset=None,
        )

    scope = [place_id] if place_id and place_id in managed_ids else managed_ids

    base = select(PlaceReview).where(
        PlaceReview.place_id.in_(scope),
        PlaceReview.status == PlaceReviewStatus.PUBLISHED.value,
    )

    rows = (
        db.execute(base.order_by(PlaceReview.created_at.desc()))
        .scalars()
        .unique()
        .all()
    )

    unanswered = [r for r in rows if r.reply is None]
    # Sorted by when they were edited rather than when they were posted. The
    # default created_at ordering is what made this bucket necessary: a review
    # from three months ago that was rewritten this morning sits three months
    # down the list, so even an owner who went looking wouldn't find it.
    stale_replies = sorted(
        [r for r in rows if repo.was_edited_after_reply(r)],
        key=lambda r: r.edited_at,
        reverse=True,
    )

    # The badge counts across everything they manage, not the current filter
    # — a count that changes when you click a filter isn't a badge, it's a
    # search result.
    needs_reply_count = len(
        [r for r in rows if r.reply is None and r.place_id in managed_ids]
    )
    edited_after_reply_count = len(
        [r for r in stale_replies if r.place_id in managed_ids]
    )

    if edited_after_reply:
        selected = stale_replies
    elif needs_reply:
        selected = unanswered
    else:
        selected = rows
    total = len(selected)
    page = selected[offset : offset + limit]

    counts = repo.open_report_counts(db, [r.id for r in page])
    places = {
        p.id: p
        for p in db.execute(
            select(Place).where(Place.id.in_([r.place_id for r in page] or [None]))
        ).scalars().all()
    }

    items: list[OwnerReviewRead] = []
    for r in page:
        base_read = _review_read(db, r, viewer_id=user.id)
        place = places.get(r.place_id)
        items.append(
            OwnerReviewRead(
                **base_read.model_dump(),
                place=OwnerReviewPlace(
                    id=place.id,
                    name=place.name,
                    city=place.city,
                    region=place.region,
                )
                if place
                else None,
                open_report_count=counts.get(r.id, 0),
            )
        )

    return OwnerReviewListResponse(
        items=items,
        total=total,
        needs_reply_count=needs_reply_count,
        edited_after_reply_count=edited_after_reply_count,
        next_offset=(offset + limit) if (offset + limit) < total else None,
    )


@owner_reviews_router.post(
    "/places/reviews/{review_id}/reply",
    response_model=PlaceReviewReplyRead,
    status_code=status.HTTP_201_CREATED,
    summary="Reply publicly to a review",
    description=(
        "Requires an active OWNER_ADMIN/MANAGER membership on the "
        "organization that owns the place. One reply per review (409 on a "
        "second). Reply text is screened exactly like a diner's — owners are "
        "not exempt. Rate-limited at 30/hour."
    ),
)
@limiter.limit("30/hour", key_func=user_or_ip_key)
def create_reply(
    request: Request,
    review_id: UUID,
    payload: PlaceReviewReplyCreate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(require_verified_email),
    db: Session = Depends(get_db),
    moderator: TextModerationClient = Depends(get_text_moderation_client),
) -> PlaceReviewReplyRead:
    review = repo.get_review(db, review_id)
    if review is None:
        raise NotFoundError("REVIEW_NOT_FOUND", "That review doesn't exist.")

    org_id = repo.owning_organization_for_place(
        db, place_id=review.place_id, user_id=user.id
    )
    if org_id is None:
        raise ForbiddenError(
            "NOT_PLACE_MANAGER",
            "Only the verified owner of this restaurant can reply to its reviews.",
        )

    _moderate(payload.body, moderator)

    reply = repo.create_reply(
        db,
        review=review,
        author_user_id=user.id,
        organization_id=org_id,
        body=payload.body,
    )
    log_place_event(
        db,
        place_id=review.place_id,
        event_type=PlaceEventType.REVIEW_REPLIED,
        actor_user_id=user.id,
        message="Owner replied to a review.",
    )
    db.commit()
    db.refresh(reply)

    track(
        "review_replied",
        distinct_id=user.id,
        properties={"place_id": str(review.place_id)},
    )
    notify_review_replied(background, db, review=review, reply=reply)

    return _reply_read(db, reply)


@owner_reviews_router.patch(
    "/places/reviews/{review_id}/reply",
    response_model=PlaceReviewReplyRead,
    summary="Edit your reply",
)
@limiter.limit("30/hour", key_func=user_or_ip_key)
def update_reply(
    request: Request,
    review_id: UUID,
    payload: PlaceReviewReplyCreate,
    user: CurrentUser = Depends(require_verified_email),
    db: Session = Depends(get_db),
    moderator: TextModerationClient = Depends(get_text_moderation_client),
) -> PlaceReviewReplyRead:
    review = repo.get_review(db, review_id)
    if review is None or review.reply is None:
        raise NotFoundError("REPLY_NOT_FOUND", "There's no reply to edit.")

    if repo.owning_organization_for_place(
        db, place_id=review.place_id, user_id=user.id
    ) is None:
        raise ForbiddenError(
            "NOT_PLACE_MANAGER",
            "Only the verified owner of this restaurant can edit this reply.",
        )

    _moderate(payload.body, moderator)
    reply = repo.update_reply(db, reply=review.reply, body=payload.body)
    db.commit()
    db.refresh(reply)
    return _reply_read(db, reply)


@owner_reviews_router.delete(
    "/places/reviews/{review_id}/reply",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete your reply",
)
def delete_reply(
    review_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    review = repo.get_review(db, review_id)
    if review is None or review.reply is None:
        raise NotFoundError("REPLY_NOT_FOUND", "There's no reply to delete.")

    if repo.owning_organization_for_place(
        db, place_id=review.place_id, user_id=user.id
    ) is None:
        raise ForbiddenError(
            "NOT_PLACE_MANAGER",
            "Only the verified owner of this restaurant can delete this reply.",
        )

    repo.delete_reply(db, reply=review.reply)
    db.commit()
