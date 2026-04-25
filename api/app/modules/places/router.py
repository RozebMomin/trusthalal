from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.deps import get_db
from app.core.auth import CurrentUser, require_roles
from app.modules.users.enums import UserRole
from app.modules.places.schemas import PlaceCreate, PlaceDetail, PlaceRead, PlaceSearchResult
from app.modules.places.repo import create_place, get_place, search_nearby

router = APIRouter(prefix="/places", tags=["Places"])


@router.post("", response_model=PlaceRead, status_code=status.HTTP_201_CREATED)
def post_place(
    payload: PlaceCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> PlaceRead:
    place = create_place(
        db,
        name=payload.name,
        address=payload.address,
        lat=payload.lat,
        lng=payload.lng,
    )
    return place


@router.get("/{place_id}", response_model=PlaceDetail)
def get_place_by_id(
    place_id: UUID,
    db: Session = Depends(get_db),
) -> PlaceDetail:
    # Ensure place exists
    place = get_place(db, place_id)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")
    from app.modules.claims.repo import get_claims_for_place
    claims = get_claims_for_place(db, place_id=place_id)

    # Build response. Passing through the ORM object via model_validate picks up
    # the canonical address fields (city/region/country_code/postal_code/timezone)
    # without us having to enumerate them here.
    return PlaceDetail.model_validate(
        {
            "id": place.id,
            "name": place.name,
            "address": place.address,
            "lat": place.lat,
            "lng": place.lng,
            "is_deleted": place.is_deleted,
            "city": place.city,
            "region": place.region,
            "country_code": place.country_code,
            "postal_code": place.postal_code,
            "timezone": place.timezone,
            "updated_at": place.updated_at,
            "claims": claims,
        }
    )


@router.get("/{place_id}/claims", response_model=list[dict])
def get_place_claims(
    place_id: UUID,
    db: Session = Depends(get_db),
) -> list[dict]:
    # Ensure place exists
    place = get_place(db, place_id)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    # Local import to avoid circular imports while the claims module evolves
    from app.modules.claims.repo import get_claims_for_place  # noqa: WPS433

    return get_claims_for_place(db, place_id=place_id)


@router.get("", response_model=list[PlaceSearchResult])
def search_places(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius: int = Query(..., gt=0, le=100_000),  # meters, cap at 100km for sanity
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> list[PlaceSearchResult]:
    return search_nearby(db, lat=lat, lng=lng, radius_m=radius, limit=limit, offset=offset)