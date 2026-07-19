"""Deleting an account, and everything that has to go with it.

## Why this exists

App Store Review Guideline 5.1.1(v): an app that lets you create an account
must let you delete it *from inside the app*. Apple is explicit that pointing
people at a support email doesn't count, and equally explicit that deletion
has to take the user's content with it — "photos, video, text posts, and
reviews" is their wording.

## What the schema already does

Most of this is handled by the foreign keys, which were built with the right
instincts long before anyone thought about Apple:

  * **CASCADE** on anything personal — sessions, refresh tokens, favorites,
    device tokens, notification preferences, consumer preferences, verifier
    profile, org memberships, and reviews.
  * **SET NULL** on business and audit records that outlive the person —
    disputes (the record stays, the reporter goes anonymous), halal claim
    decisions, organizations they created, and owner replies (a reply speaks
    for the restaurant, not the individual, so a manager leaving shouldn't
    silently retract the business's public statement).

So ``db.delete(user)`` gets most of the way. This module exists for the parts
it *doesn't* get.

## The parts the database can't do

**Bucket objects.** Two paths lose photos here and neither runs application
code: the user's reviews cascade away and take ``place_photos`` rows with
them, and the photos the user uploaded directly are deleted below. In both
cases the storage path disappears with the row, so the bytes have to be
queued for the sweeper *before* anything is deleted. Reordering the steps in
``delete_account`` silently starts leaking storage.

**Owner-side photos stay.** A photo uploaded with ``source = OWNER`` is the
restaurant's content, published on behalf of a business that still exists —
deleting someone's personal account shouldn't strip a restaurant's gallery
and harm diners who had nothing to do with it. Those rows keep their
SET NULL, so they survive unattributed. Consumer photos are personal content
and go. The deletion screen says which is which, because a rule the user
can't predict is worse than a rule they don't like.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.organizations.models import OrganizationMember
from app.modules.places.enums import PlacePhotoSource
from app.modules.places.models import PlacePhoto
from app.modules.places.photos.storage_cleanup import enqueue_orphans
from app.modules.reviews.models import PlaceReview
from app.modules.reviews.repo import recompute_place_review_stats
from app.modules.users.models import User

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DeletionSummary:
    """What was removed. Surfaced to the client so the confirmation screen
    can tell the truth about what just happened rather than a generic
    'account deleted'."""

    reviews_deleted: int
    photos_deleted: int
    storage_objects_queued: int
    orphaned_organizations: list[UUID]


def preview_deletion(db: Session, *, user_id: UUID) -> DeletionSummary:
    """What ``delete_account`` would remove, without removing it.

    Powers the confirmation screen. Someone about to make an irreversible
    decision should see its actual scope — "this will delete 4 reviews and
    7 photos" is a different decision from "delete account".
    """
    reviews = int(
        db.execute(
            select(func.count(PlaceReview.id)).where(
                PlaceReview.author_user_id == user_id
            )
        ).scalar_one()
    )
    photos = int(
        db.execute(
            select(func.count(PlacePhoto.id)).where(
                PlacePhoto.uploaded_by_user_id == user_id,
                PlacePhoto.source == PlacePhotoSource.CONSUMER.value,
            )
        ).scalar_one()
    )
    return DeletionSummary(
        reviews_deleted=reviews,
        photos_deleted=photos,
        storage_objects_queued=0,
        orphaned_organizations=[],
    )


def delete_account(db: Session, *, user_id: UUID) -> DeletionSummary:
    """Remove the account and its personal content. Caller owns the commit.

    Step order is load-bearing — see the module docstring. Every read of a
    storage path happens before the delete that makes it unrecoverable.
    """
    user = db.get(User, user_id)
    if user is None:  # already gone; deleting twice is not an error
        return DeletionSummary(0, 0, 0, [])

    # ---- 1. Which places need their rating recomputed afterwards? --------
    # Read now: after the cascade there's no way to find them.
    affected_place_ids = list(
        db.execute(
            select(PlaceReview.place_id)
            .where(PlaceReview.author_user_id == user_id)
            .distinct()
        )
        .scalars()
        .all()
    )

    # ---- 2. Collect every storage path that's about to disappear --------
    # (a) photos attached to this user's reviews. These vanish via a
    #     DB-level cascade (place_photos.review_id -> place_reviews), so no
    #     application code will ever see them again.
    review_photo_paths = list(
        db.execute(
            select(PlacePhoto.storage_path)
            .join(PlaceReview, PlaceReview.id == PlacePhoto.review_id)
            .where(PlaceReview.author_user_id == user_id)
        )
        .scalars()
        .all()
    )

    # (b) standalone photos the user uploaded as a diner. Not attached to a
    #     review, so nothing cascades them — deleted explicitly below.
    own_photos = list(
        db.execute(
            select(PlacePhoto).where(
                PlacePhoto.uploaded_by_user_id == user_id,
                PlacePhoto.source == PlacePhotoSource.CONSUMER.value,
                PlacePhoto.review_id.is_(None),
            )
        )
        .scalars()
        .all()
    )

    queued = enqueue_orphans(
        db,
        bucket=settings.SUPABASE_PHOTOS_BUCKET,
        storage_paths=review_photo_paths + [p.storage_path for p in own_photos],
        reason="account_deleted",
    )

    # ---- 3. Note orgs this user was the last member of -------------------
    # Not a blocker: Apple is clear that apps making deletion "unnecessarily
    # difficult" fail review, and refusing to delete a sole owner-admin would
    # be exactly that. The org and its places survive — a restaurant's halal
    # profile is public record and doesn't belong to one person's login — but
    # it's left without a manager, so staff need to know to reassign it.
    orphaned = _organizations_left_without_members(db, user_id=user_id)

    # ---- 4. Delete ------------------------------------------------------
    review_count = len(
        db.execute(
            select(PlaceReview.id).where(PlaceReview.author_user_id == user_id)
        )
        .scalars()
        .all()
    )

    for photo in own_photos:
        db.delete(photo)

    # Everything else rides the foreign keys.
    db.delete(user)
    db.flush()

    # ---- 5. Repair the denormalized aggregates --------------------------
    # The reviews are gone but places.review_rating_avg / review_count still
    # count them. Same rule as every other review mutation: recompute in the
    # same transaction, or the number the product asserts stops matching the
    # reviews behind it.
    for place_id in affected_place_ids:
        recompute_place_review_stats(db, place_id=place_id)

    if orphaned:
        logger.warning(
            "Account deletion left %d organization(s) with no members: %s",
            len(orphaned),
            ", ".join(str(o) for o in orphaned),
        )

    return DeletionSummary(
        reviews_deleted=review_count,
        photos_deleted=len(own_photos),
        storage_objects_queued=queued,
        orphaned_organizations=orphaned,
    )


def _organizations_left_without_members(
    db: Session, *, user_id: UUID
) -> list[UUID]:
    """Orgs where this user is the only remaining active member."""
    mine = list(
        db.execute(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.status == "ACTIVE",
            )
        )
        .scalars()
        .all()
    )
    if not mine:
        return []

    others = set(
        db.execute(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.organization_id.in_(mine),
                OrganizationMember.user_id != user_id,
                OrganizationMember.status == "ACTIVE",
            )
        )
        .scalars()
        .all()
    )
    return [org_id for org_id in mine if org_id not in others]
