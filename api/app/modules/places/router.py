from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, NotFoundError
from app.core.rate_limit import ip_key, limiter
from app.db.deps import get_db
from app.core.auth import CurrentUser, require_roles
from app.modules.users.enums import UserRole
from app.modules.places.integrations.google_client import (
    GoogleAPIError,
    fetch_place_autocomplete_google,
)
from app.modules.places.schemas import (
    GoogleAutocompletePrediction,
    PlaceCreate,
    PlaceDetail,
    PlaceRead,
    PlaceSearchResult,
)
from app.modules.places.repo import create_place, get_place, search_by_text, search_nearby

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


@router.get(
    "/google/autocomplete",
    response_model=list[GoogleAutocompletePrediction],
)
@limiter.limit("30/minute", key_func=ip_key)
@limiter.limit("300/hour", key_func=ip_key)
def google_autocomplete(
    request: Request,
    q: str = Query(..., min_length=1, max_length=255),
    db: Session = Depends(get_db),
) -> list[GoogleAutocompletePrediction]:
    """Server-side proxy to Google Places Autocomplete.

    Powers the owner portal's "Can't find your restaurant? Search
    Google" fallback in the claim flow. Routing the call through our
    backend keeps the Google API key off the owner origin (the existing
    browser key is restricted to the admin domain, by design) — the
    server uses ``GOOGLE_MAPS_API_KEY`` server-side and only ships
    predictions back.

    Public on purpose: anyone considering signing up + claiming should
    be able to type their restaurant's name and see whether Google
    knows it. We rely on the downstream claim creation step (which
    requires auth) for the access gate.

    Empty query is handled at the validator layer (min_length=1) so we
    never burn a billed Google call on a no-op input.

    Errors translate to a stable code so the client can render
    "Search unavailable, try again" without parsing Google's status
    strings.
    """
    # ``db`` is unused by the proxy itself, but kept in the signature
    # to match the rest of the router and to allow future caching of
    # popular queries to a `place_search_cache` table without a
    # signature change.
    del db

    try:
        raw_predictions = fetch_place_autocomplete_google(q)
    except GoogleAPIError as exc:
        # Surface a clean code; admins can investigate via logs.
        # Detail is hidden from the client to avoid leaking quota /
        # config info, but we keep the message on the exception side
        # so it lands in the request log.
        raise BadRequestError(
            "GOOGLE_AUTOCOMPLETE_UNAVAILABLE",
            f"Google Places Autocomplete is currently unavailable: {exc}",
        )

    return [
        GoogleAutocompletePrediction(
            google_place_id=p.get("place_id", ""),
            description=p.get("description", ""),
            primary_text=(p.get("structured_formatting") or {}).get("main_text"),
            secondary_text=(p.get("structured_formatting") or {}).get(
                "secondary_text"
            ),
        )
        for p in raw_predictions
        # Defensive: predictions without a place_id can't be acted on
        # (the claim endpoint needs one to ingest), so drop them
        # rather than rendering a row that 404s on submit.
        if p.get("place_id")
    ]


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
    q: str | None = Query(default=None, max_length=255),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius: int | None = Query(default=None, gt=0, le=100_000),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> list[PlaceSearchResult]:
    """Browse the public places catalog.

    Two search modes, mutually exclusive — pick one based on what the
    caller has on hand:

    * **Text** — pass ``q`` (case-insensitive substring on name +
      address + city). Used by the owner portal's claim flow when the
      restaurant owner types the name of their place.
    * **Geo** — pass ``lat`` + ``lng`` + ``radius`` (meters). Used by
      the consumer site to render "halal places near me".

    If ``q`` is set, geo params are ignored. If neither path is
    populated, we 400 — there's no meaningful "list everything"
    response on a public catalog of this size.
    """
    has_text = q is not None and q.strip() != ""
    has_geo = lat is not None and lng is not None and radius is not None

    if has_text:
        return search_by_text(db, q=q.strip(), limit=limit, offset=offset)

    if has_geo:
        return search_nearby(
            db, lat=lat, lng=lng, radius_m=radius, limit=limit, offset=offset
        )

    raise BadRequestError(
        "PLACES_SEARCH_PARAMS_REQUIRED",
        "Provide either 'q' for text search or 'lat'+'lng'+'radius' for geo search.",
    )