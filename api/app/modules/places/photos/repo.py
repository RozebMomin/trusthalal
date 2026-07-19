"""DB queries for the place_photos table.

All queries filter out soft-deleted rows by default (``deleted_at
IS NULL``). The only callers that should ever see deleted rows are
admin moderation surfaces, and those go through dedicated repo
functions with ``include_deleted=True``.

Per-place cap is enforced here rather than at the router so the
business rule lives next to the query that counts. Test harnesses
can monkey-patch ``MAX_PHOTOS_PER_PLACE`` to exercise the cap path
without uploading 50 fixture files.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Sequence
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.storage import StorageClient
from app.modules.places.enums import attribution_for
from app.modules.places.models import Place, PlacePhoto
from app.modules.users.models import User


# Cap from the planning doc. Lives here as a module constant so
# tests can monkey-patch it (and a future admin-controlled cap
# would be a settings lookup).
# Raised from 50 when review photos landed: every review can now attach up to
# three, so a busy place reaches the old ceiling on review volume alone rather
# than on owner uploads. 75 is a holding number — if places start hitting it,
# the better fix is counting review photos separately from the gallery rather
# than raising this again.
MAX_PHOTOS_PER_PLACE = 75


def list_active_photos_for_place(
    db: Session, *, place_id: UUID
) -> list[PlacePhoto]:
    """Return non-deleted photos for a place, hero-first, then
    newest-first.

    Uses the ``ix_place_photos_listing`` index for the order +
    where clause. Selects the full row because callers (the public
    GET) need every column to build the response shape.
    """
    stmt = (
        select(PlacePhoto)
        .where(PlacePhoto.place_id == place_id)
        .where(PlacePhoto.deleted_at.is_(None))
        .order_by(PlacePhoto.is_hero.desc(), PlacePhoto.created_at.desc())
    )
    return list(db.execute(stmt).scalars().all())


def get_photo(
    db: Session, *, photo_id: UUID, include_deleted: bool = False
) -> PlacePhoto | None:
    """Fetch one photo by id. Defaults to live rows only — admin
    moderation passes ``include_deleted=True`` to inspect or
    restore.
    """
    stmt = select(PlacePhoto).where(PlacePhoto.id == photo_id)
    if not include_deleted:
        stmt = stmt.where(PlacePhoto.deleted_at.is_(None))
    return db.execute(stmt).scalar_one_or_none()


def count_active_photos_for_place(db: Session, *, place_id: UUID) -> int:
    """Count non-deleted photos for cap enforcement. Returns 0 for
    a place with no rows."""
    stmt = (
        select(func.count())
        .select_from(PlacePhoto)
        .where(PlacePhoto.place_id == place_id)
        .where(PlacePhoto.deleted_at.is_(None))
    )
    return int(db.execute(stmt).scalar_one() or 0)


def has_active_hero_for_place(db: Session, *, place_id: UUID) -> bool:
    """Cheap existence check for the auto-hero promotion path.

    Used by the upload endpoint to decide whether the freshly-
    uploaded photo should be auto-marked as hero. Checks for ANY
    non-deleted photo on this place with ``is_hero = true``. The
    partial unique index ``ix_place_photos_one_hero_per_place``
    backs the query, so it's an index-only lookup even at scale.
    """
    stmt = (
        select(PlacePhoto.id)
        .where(PlacePhoto.place_id == place_id)
        .where(PlacePhoto.deleted_at.is_(None))
        .where(PlacePhoto.is_hero.is_(True))
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none() is not None


def clear_hero_for_place(db: Session, *, place_id: UUID) -> None:
    """Atomically unmark the current hero (if any) for a place.

    Used by ``set_hero`` before assigning a new hero — the partial
    unique index on ``is_hero`` would otherwise reject the update.
    No-op when no hero exists.

    Applies to the live row only. A soft-deleted hero row keeps
    ``is_hero = true`` for audit purposes, but the partial unique
    index ignores deleted rows so this query doesn't have to.
    """
    stmt = (
        update(PlacePhoto)
        .where(PlacePhoto.place_id == place_id)
        .where(PlacePhoto.deleted_at.is_(None))
        .where(PlacePhoto.is_hero.is_(True))
        .values(is_hero=False)
    )
    db.execute(stmt)


def serialize_photos_for_place(
    db: Session,
    *,
    place: Place,
    storage: StorageClient,
) -> tuple[list[dict], str | None]:
    """Build the (photos_array, hero_photo_url) pair for a place's
    PlaceDetail / PlaceSearchResult response.

    Lives here (rather than the photo router) because the place
    routes already load Place via the ``selectin`` relationship
    on ``Place.photos``, and constructing the response shape is a
    pure transform on already-loaded data plus the storage URL
    template.

    Returns a tuple so callers can pick which slice they need:
    PlaceDetail uses both, PlaceSearchResult uses only the URL.
    The dict shape matches PlacePhotoRead's fields exactly so
    the calling Pydantic ``model_validate`` doesn't have to do
    secondary mapping.
    """
    # Filter soft-deleted in Python rather than at the DB layer —
    # the relationship is already loaded eagerly via selectin and
    # in alpha volume the per-place row count is small (cap 50).
    live_photos = [p for p in (place.photos or []) if p.deleted_at is None]
    if not live_photos:
        return ([], None)

    # Order: hero first (already enforced by the relationship's
    # order_by clause), but defensive in case the relationship
    # order ever changes.
    live_photos.sort(
        key=lambda p: (not p.is_hero, -(p.created_at.timestamp())),
    )

    # Batch-resolve uploader display names. Avoids an N+1 across
    # a 50-photo gallery on the public detail endpoint.
    user_ids = {p.uploaded_by_user_id for p in live_photos if p.uploaded_by_user_id}
    display_name_by_id: dict = {}
    if user_ids:
        rows = db.execute(
            select(User.id, User.display_name).where(User.id.in_(user_ids))
        ).all()
        display_name_by_id = {row[0]: row[1] for row in rows}

    # Batch-resolve ratings for any review-attached photos, same reasoning as
    # the display names above: one query for the gallery, not one per photo.
    review_ids = {p.review_id for p in live_photos if p.review_id}
    rating_by_review: dict = {}
    if review_ids:
        from app.modules.reviews.models import PlaceReview  # local: cycle

        rows = db.execute(
            select(PlaceReview.id, PlaceReview.rating).where(
                PlaceReview.id.in_(review_ids)
            )
        ).all()
        rating_by_review = {row[0]: row[1] for row in rows}

    photos_payload = [
        {
            "id": p.id,
            "place_id": p.place_id,
            "url": storage.public_url(p.storage_path),
            "source": p.source,
            "attribution": attribution_for(source=p.source, review_id=p.review_id),
            "review_id": p.review_id,
            "review_rating": rating_by_review.get(p.review_id),
            "width_px": p.width_px,
            "height_px": p.height_px,
            "caption": p.caption,
            "is_hero": p.is_hero,
            "uploaded_by_display_name": display_name_by_id.get(
                p.uploaded_by_user_id
            ),
            "created_at": p.created_at,
        }
        for p in live_photos
    ]

    hero_url: str | None = None
    for p in live_photos:
        if p.is_hero:
            hero_url = storage.public_url(p.storage_path)
            break

    return (photos_payload, hero_url)


def soft_delete_photo(
    db: Session, *, photo: PlacePhoto, now: datetime | None = None
) -> None:
    """Mark a photo deleted in place. The bytes stay in the bucket
    (no immediate hard delete) so admin restore is just unsetting
    ``deleted_at``. The ``purge_storage_orphans`` data-ops job collects
    them once they're past its retention window — which is the point at
    which restore stops being possible, so that window is the real
    undo horizon, not this flag.

    Also clears ``is_hero`` so the partial unique index doesn't
    interfere with a future replacement upload that wants to be the
    hero. Keeps the historical "this was the hero" record on the
    photo's ``deleted_at`` audit context if anyone really needs it.
    """
    photo.deleted_at = now or datetime.now(timezone.utc)
    photo.is_hero = False
    db.add(photo)
