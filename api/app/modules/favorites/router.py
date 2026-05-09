"""Consumer favorites endpoints.

Three routes, all rooted at ``/me/favorites``:

  * ``GET    /me/favorites``           — list the caller's favorites,
                                         newest-first.
  * ``POST   /me/favorites/{place_id}`` — favorite a place. Idempotent;
                                         200 if already favorited, 201
                                         on first save.
  * ``DELETE /me/favorites/{place_id}`` — unfavorite. 204 on success,
                                         404 if not currently
                                         favorited.

Auth: signed-in CONSUMER only — owners / admins / verifiers don't
have a personal "places I want to come back to" surface; their
relationship to places is through ownership / moderation, which has
its own admin / owner-portal surfaces. The 403 keeps the data
contract honest.

The list response embeds the same ``PlaceSearchResult`` shape the
public search list uses so the consumer site can reuse
``PlaceResultCard`` directly — same hero photo, same trust pill,
same cuisine chips. Soft-deleted places are filtered out at the
repo so the list never shows tombstones.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from sqlalchemy import select

from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import NotFoundError
from app.core.storage import StorageClient, get_photos_storage_client
from app.db.deps import get_db
from app.modules.favorites.repo import (
    add_favorite,
    list_favorites_for_user,
    remove_favorite,
)
from app.modules.favorites.schemas import FavoriteRead
from app.modules.halal_profiles.models import HalalProfile
from app.modules.places.models import Place, PlacePhoto
from app.modules.places.schemas import HalalProfileEmbed, PlaceSearchResult
from app.modules.users.enums import UserRole


router = APIRouter(prefix="/me/favorites", tags=["consumer-favorites"])


@router.get(
    "",
    response_model=list[FavoriteRead],
    summary="List the caller's saved places",
    description=(
        "Newest-first list of places the consumer has favorited. "
        "Each row carries the full ``PlaceSearchResult`` shape so "
        "the frontend can reuse the same card component the search "
        "page renders. Soft-deleted places are filtered out — the "
        "favorite row stays in the DB so an admin restore brings "
        "the place back to the list transparently."
    ),
)
def list_my_favorites(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.CONSUMER)),
    photos_storage: StorageClient = Depends(get_photos_storage_client),
) -> list[FavoriteRead]:
    rows = list_favorites_for_user(db, user_id=user.id)
    return [
        FavoriteRead.model_validate(
            {
                "saved_at": favorite.created_at,
                "place": _place_to_search_result(
                    place, profile, photos_storage
                ),
            }
        )
        for place, profile, favorite in rows
    ]


@router.post(
    "/{place_id}",
    response_model=FavoriteRead,
    summary="Save a place to the caller's favorites",
    description=(
        "Idempotent. Returns 201 with the new row on first save, 200 "
        "with the existing row when the place was already favorited. "
        "404 when the place doesn't exist or has been hard-deleted."
    ),
    responses={
        200: {"description": "Place was already favorited."},
        201: {"description": "Place newly added to favorites."},
        404: {"description": "Place not found."},
    },
)
def add_my_favorite(
    place_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.CONSUMER)),
    photos_storage: StorageClient = Depends(get_photos_storage_client),
) -> FavoriteRead:
    # Place existence check up front. Soft-deleted places are still
    # "real" enough to favorite — the delete might be reverted, and
    # an owner restore brings the favorite list entry back into view.
    # Hard-deleted (no Place row at all) → 404.
    place = db.get(Place, place_id)
    if place is None:
        raise NotFoundError(
            "PLACE_NOT_FOUND",
            "No place with that id.",
        )

    favorite, was_created = add_favorite(
        db, user_id=user.id, place_id=place_id
    )
    response.status_code = (
        status.HTTP_201_CREATED if was_created else status.HTTP_200_OK
    )

    # Resolve the embedded place + halal profile in the same shape the
    # listing endpoint produces so the frontend can drop the response
    # straight into its TanStack Query cache without two transforms.
    profile = _profile_for_place(db, place_id)
    return FavoriteRead.model_validate(
        {
            "saved_at": favorite.created_at,
            "place": _place_to_search_result(
                place, profile, photos_storage
            ),
        }
    )


@router.delete(
    "/{place_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a place from the caller's favorites",
    description=(
        "Idempotent on the wire posture but 404s when the place "
        "wasn't favorited so the frontend can distinguish a real "
        "remove from a stale double-tap."
    ),
    responses={
        204: {"description": "Place removed from favorites."},
        404: {"description": "Place wasn't favorited."},
    },
)
def remove_my_favorite(
    place_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.CONSUMER)),
) -> Response:
    removed = remove_favorite(db, user_id=user.id, place_id=place_id)
    if not removed:
        raise NotFoundError(
            "FAVORITE_NOT_FOUND",
            "This place wasn't on your favorites list.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hero_url_for(
    place: Place, photos_storage: StorageClient
) -> str | None:
    """Same shape as the helper inside the search router: walk the
    eagerly-loaded photos list and return the first non-deleted hero's
    public URL. No DB hit beyond the one the relationship already
    resolved.
    """
    photos: list[PlacePhoto] = list(place.photos or [])
    for p in photos:
        if p.deleted_at is None and p.is_hero:
            return photos_storage.public_url(p.storage_path)
    return None


def _profile_for_place(
    db: Session, place_id: UUID
) -> HalalProfile | None:
    """Look up the place's current (non-revoked) halal profile.

    Used by the POST handler — the listing path gets the profile
    pre-joined from the repo, but POST takes a single place id and
    needs to query directly. The model graph treats place →
    halal_profile as 1:1 with a UNIQUE constraint on place_id, so
    this is at most one row.
    """
    return db.execute(
        select(HalalProfile).where(
            HalalProfile.place_id == place_id,
            HalalProfile.revoked_at.is_(None),
        )
    ).scalar_one_or_none()


def _place_to_search_result(
    place: Place,
    profile,
    photos_storage: StorageClient,
) -> dict:
    """Mirror of the inline ``PlaceSearchResult.model_validate({...})``
    block used by the public search router. Returned as a dict so
    Pydantic's ``FavoriteRead.model_validate`` can coerce it inside
    the embedded place field.
    """
    return {
        "id": place.id,
        "name": place.name,
        "address": place.address,
        "lat": place.lat,
        "lng": place.lng,
        "city": place.city,
        "region": place.region,
        "country_code": place.country_code,
        "cuisine_types": list(place.cuisine_types or []),
        "hero_photo_url": _hero_url_for(place, photos_storage),
        "halal_profile": (
            HalalProfileEmbed.model_validate(profile)
            if profile is not None
            else None
        ),
    }


# Keep ``PlaceSearchResult`` referenced to silence the lint about an
# import that's used only for a forward-typed return shape.
_ = PlaceSearchResult
