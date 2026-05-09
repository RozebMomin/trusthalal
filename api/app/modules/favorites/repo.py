"""Repo for consumer favorites.

Three operations:
  * ``list_favorites_for_user`` — newest-first list of (place,
    halal_profile, saved_at) triples, ready for the router to pack
    into the same ``PlaceSearchResult`` shape the public search list
    uses.
  * ``add_favorite`` — idempotent insert. Returns whether the row was
    newly created so the router can decide between 200 (no-op) and
    201 (created).
  * ``remove_favorite`` — idempotent delete. Returns whether a row
    was actually removed so the router can decide between 200 (was
    favorited) and 404 (never was).

Soft-deleted places are filtered OUT of the listing — a consumer
shouldn't see ghost favorites for a restaurant that's been pulled
from the directory. The favorite row itself stays so an admin
"restore" of the place brings it back transparently. Revoked halal
profiles still surface (with ``halal_profile=None`` on the embed) so
the favorite is still findable; the trust pill just falls back to
"No halal info yet".
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.modules.favorites.models import ConsumerFavorite
from app.modules.halal_profiles.models import HalalProfile
from app.modules.places.models import Place


def list_favorites_for_user(
    db: Session, *, user_id: UUID
) -> list[tuple[Place, HalalProfile | None, ConsumerFavorite]]:
    """Newest-first list of the caller's favorites.

    Returns ``(Place, HalalProfile | None, ConsumerFavorite)`` triples
    so the router has everything it needs to assemble the response in
    one pass:

      * ``Place`` carries cuisine_types, lat/lng, etc., AND has its
        ``photos`` relationship eager-loaded so ``hero_photo_url`` can
        be derived without an N+1.
      * ``HalalProfile`` is None when the place has no approved claim
        OR the latest profile was revoked — same posture as
        ``search_by_text``.
      * ``ConsumerFavorite`` carries ``created_at`` for the
        ``saved_at`` field on the response.

    Soft-deleted places (``Place.is_deleted = True``) are filtered out
    so the consumer doesn't see tombstones in their own list.
    """
    stmt = (
        select(ConsumerFavorite, Place, HalalProfile)
        .join(Place, Place.id == ConsumerFavorite.place_id)
        .outerjoin(
            HalalProfile,
            (HalalProfile.place_id == Place.id)
            & (HalalProfile.revoked_at.is_(None)),
        )
        .where(ConsumerFavorite.user_id == user_id)
        .where(Place.is_deleted.is_(False))
        # Eager-load photos so the router's ``_hero_url_for`` helper
        # doesn't fire a per-row query. ``Place.photos`` is the same
        # relationship the search router already relies on.
        .options(selectinload(Place.photos))
        .order_by(ConsumerFavorite.created_at.desc())
    )
    return [
        (place, profile, favorite)
        for favorite, place, profile in db.execute(stmt).all()
    ]


def add_favorite(
    db: Session, *, user_id: UUID, place_id: UUID
) -> tuple[ConsumerFavorite, bool]:
    """Insert a favorite row, idempotent. Returns
    ``(favorite, was_created)``.

    The composite PK guarantees no duplicates at the DB layer; we
    catch the IntegrityError on the rare race where two concurrent
    requests try to insert the same (user, place) pair, refetch, and
    return the existing row with ``was_created=False``.
    """
    existing = db.execute(
        select(ConsumerFavorite).where(
            ConsumerFavorite.user_id == user_id,
            ConsumerFavorite.place_id == place_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    favorite = ConsumerFavorite(user_id=user_id, place_id=place_id)
    db.add(favorite)
    try:
        db.flush()
    except IntegrityError:
        # Lost the race against a concurrent insert. Roll back the
        # failed flush, refetch, and return the winning row.
        db.rollback()
        existing = db.execute(
            select(ConsumerFavorite).where(
                ConsumerFavorite.user_id == user_id,
                ConsumerFavorite.place_id == place_id,
            )
        ).scalar_one()
        return existing, False
    db.commit()
    db.refresh(favorite)
    return favorite, True


def remove_favorite(
    db: Session, *, user_id: UUID, place_id: UUID
) -> bool:
    """Delete a favorite row, idempotent. Returns ``True`` when a
    row was actually removed, ``False`` when the user hadn't
    favorited this place to begin with.
    """
    result = db.execute(
        delete(ConsumerFavorite).where(
            ConsumerFavorite.user_id == user_id,
            ConsumerFavorite.place_id == place_id,
        )
    )
    db.commit()
    return (result.rowcount or 0) > 0
