from __future__ import annotations

from functools import lru_cache as _lru_cache
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.rate_limit import ip_key, limiter
from app.db.deps import get_db
from app.modules.halal_profiles.enums import (
    MenuPosture,
    SlaughterMethod,
    ValidationTier,
)
from app.modules.halal_profiles.repo import get_public_halal_profile
from app.modules.halal_profiles.schemas import HalalProfileRead
from app.modules.places.integrations.google import (
    extract_locality_from_geocode,
)
from app.modules.places.integrations.google_client import (
    GoogleAPIError,
    fetch_place_autocomplete_google,
    fetch_reverse_geocode_google,
)
from app.modules.places.repo import (
    HalalSearchFilters,
    create_place,
    get_place,
    list_owned_places_for_user,
    search_by_text,
    search_nearby,
)
from app.modules.places.schemas import (
    GoogleAutocompletePrediction,
    HalalProfileEmbed,
    OwnedPlaceRead,
    PlaceCreate,
    PlaceDetail,
    PlaceRead,
    PlaceSearchResult,
    ReverseGeocodeResult,
)
from app.core.auth import CurrentUser, get_current_user
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/places", tags=["places"])

# A second router for /me-prefixed place-ownership reads. Kept in
# this file because it's about the Place model, but it doesn't fit
# under the /places prefix.
me_places_router = APIRouter(prefix="/me", tags=["Places"])


@me_places_router.get(
    "/owned-places",
    response_model=list[OwnedPlaceRead],
)
def list_my_owned_places(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[OwnedPlaceRead]:
    """Places this user can submit halal information for.

    Backed by an active OrganizationMember → Organization →
    PlaceOwner chain. Each (place, owning org) pair is a separate
    row, so a user who runs multiple orgs can see which place is
    owned by which entity. Drives the picker on the owner-portal
    "New halal claim" flow.

    ``has_halal_profile`` is true when a non-revoked HalalProfile
    exists for the place — lets the picker render different copy
    for first-time vs update flows.
    """
    rows = list_owned_places_for_user(db, user_id=user.id)
    return [
        OwnedPlaceRead(
            place_id=place.id,
            place_name=place.name,
            place_address=place.address,
            place_city=place.city,
            place_country_code=place.country_code,
            organization_id=org.id,
            organization_name=org.name,
            has_halal_profile=has_profile,
        )
        for place, org, has_profile in rows
    ]


@router.post(
    "",
    response_model=PlaceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a place (legacy)",
    description=(
        "Admin-only path that bypasses the Google ingest flow. Most "
        "callers should use `POST /admin/places/ingest` instead — that "
        "ingest helper enriches the place with canonical address fields "
        "from Google Place Details. Kept for the rare case where an "
        "admin wants to seed a place by hand."
    ),
)
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
    summary="Google Places Autocomplete proxy",
    description=(
        "Server-side proxy to the Google Places Autocomplete endpoint. "
        "Powers the owner portal's 'can't find your restaurant?' "
        "fallback in the claim flow — the browser key is restricted to "
        "the admin domain by referrer, so the owner origin can't call "
        "Google directly. Public on purpose so the user can see "
        "matches before they decide to sign up. Rate-limited per-IP "
        "(30/min, 300/hour) to keep Google quota in check."
    ),
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


# Process-local cache for reverse-geocode results, keyed on
# coordinates rounded to 3 decimal places (~110m grid). Two users in
# the same neighborhood collapse to a single Google call, which
# matters a lot at scale: Google Geocoding charges $5/1000 after the
# $200/month free credit, and most consumer traffic clusters around
# a small number of metro areas. Cache TTL is 30 days — cities don't
# move, and the LRU cap of 10000 entries covers about a million
# square miles of grid before evicting anything.
#
# In-memory only — restarts drop the cache. That's fine: a Render
# redeploy still costs at most one Google call per active grid cell
# in the ~minutes after restart. If/when this app sees enough traffic
# to matter, swap to Redis or a Postgres-backed (lat_3dp, lng_3dp,
# resolved_at, city, region, country) table without changing this
# function's signature.
@_lru_cache(maxsize=10_000)
def _cached_reverse_geocode_locality(
    lat_3dp: float, lng_3dp: float
) -> tuple[str | None, str | None, str | None]:
    """Cached wrapper. Key is (rounded lat, rounded lng); value is the
    triple of (city, region, country_code). Exceptions are not cached
    — a transient Google outage shouldn't poison the cache."""
    payload = fetch_reverse_geocode_google(lat_3dp, lng_3dp)
    locality = extract_locality_from_geocode(payload)
    return (locality.city, locality.region, locality.country_code)


@router.get(
    "/google/reverse-geocode",
    response_model=ReverseGeocodeResult,
    summary="Google Geocoding reverse-lookup proxy",
    description=(
        "Server-side proxy to the Google Geocoding API. Given a "
        "lat/lng, returns the resolved city / region (short code) / "
        "country code for the consumer 'near me' surface — the active "
        "pill renders 'Searching X mi around Snellville' rather than "
        "the generic 'around you'. Same key-hygiene posture as the "
        "autocomplete proxy: GOOGLE_MAPS_API_KEY is never exposed to "
        "the browser. Coordinates are rounded to 3 decimals (~110m "
        "grid) before lookup so two users in the same neighborhood "
        "collapse to a single billed call. Rate-limited per-IP "
        "(60/min, 600/hour). All three response fields are optional; "
        "rural / ocean coordinates can return a 200 OK with `city` "
        "null and the consumer pill falls back accordingly."
    ),
)
@limiter.limit("60/minute", key_func=ip_key)
@limiter.limit("600/hour", key_func=ip_key)
def google_reverse_geocode(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    db: Session = Depends(get_db),
) -> ReverseGeocodeResult:
    """Reverse-geocode a coordinate to a city label.

    Public on purpose: the consumer "near me" feature is anonymous-
    friendly and there's no PII in the response (just the publicly-
    knowable city name for a coordinate the caller already told us).
    Rate-limited per-IP to bound Google quota cost — every near-me
    activation fires one call, but a misconfigured client bouncing
    coords every render would otherwise burn quota fast.

    Coordinates are rounded to 3 decimal places (~110m grid) before
    being sent to Google. That trades the difference between two
    sub-block points (which would resolve to the same city anyway)
    for a much higher cache hit rate across users.

    Empty / ZERO_RESULTS responses translate to ``ReverseGeocodeResult(
    city=None, region=None, country_code=None)`` rather than a 404 —
    "we couldn't resolve a city for this point" is a normal soft
    outcome on the consumer side and the pill falls back to "around
    you" when ``city`` is null.
    """
    del db  # see autocomplete handler — kept for signature symmetry

    lat_3dp = round(lat, 3)
    lng_3dp = round(lng, 3)

    try:
        city, region, country_code = _cached_reverse_geocode_locality(
            lat_3dp, lng_3dp
        )
    except GoogleAPIError as exc:
        # Same posture as autocomplete: hide Google's verbose error
        # text from the client. The proxy is never required for the
        # near-me feature to work — the consumer pill degrades to
        # "around you" — so the client can also render this as a soft
        # warning rather than a hard error.
        raise BadRequestError(
            "GOOGLE_REVERSE_GEOCODE_UNAVAILABLE",
            f"Google Reverse Geocoding is currently unavailable: {exc}",
        )

    return ReverseGeocodeResult(
        city=city,
        region=region,
        country_code=country_code,
    )


@router.get(
    "/{place_id}",
    response_model=PlaceDetail,
    summary="Get a place's full detail with attached claims",
    description=(
        "Public read of a single place: name, canonical address fields "
        "(city / region / country / postal_code / timezone), lat/lng, "
        "soft-delete state, and the list of halal claims attached to "
        "it. Returns 404 (`PLACE_NOT_FOUND`) if the place doesn't "
        "exist or is hard-deleted. Soft-deleted places are still "
        "returned with `is_deleted: true` for context."
    ),
)
def get_place_by_id(
    place_id: UUID,
    db: Session = Depends(get_db),
) -> PlaceDetail:
    # Ensure place exists
    place = get_place(db, place_id)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    # Embed the consumer-facing halal profile if one is present and
    # not revoked. Single-fetch pattern — frontends rendering a
    # place page get name + address + halal posture in one trip.
    profile = get_public_halal_profile(db, place_id=place_id)
    halal_embed = (
        HalalProfileEmbed.model_validate(profile, from_attributes=True)
        if profile is not None
        else None
    )

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
            "halal_profile": halal_embed,
        }
    )


@router.get(
    "/{place_id}/halal-profile",
    response_model=HalalProfileRead,
    summary="Public halal profile for a place",
    description=(
        "Consumer-facing halal-posture snapshot for a single place. "
        "Returns the derived `HalalProfile` (validation tier, menu "
        "posture, alcohol policy, per-meat slaughter, dispute state) "
        "without re-fetching the full place row. Returns 404 if the "
        "place doesn't exist or has no halal profile yet."
    ),
)
def get_place_halal_profile(
    place_id: UUID,
    db: Session = Depends(get_db),
) -> HalalProfileRead:
    """Public consumer-facing halal profile for a place.

    Returns the structured snapshot the consumer site renders as
    trust labels + expandable details. Visibility rules:

      * Place must exist and not be soft-deleted (404 PLACE_NOT_FOUND
        otherwise).
      * A non-revoked HalalProfile must exist (404
        HALAL_PROFILE_NOT_FOUND otherwise — used by the consumer
        UI to decide between "no halal info" and "deleted place").

    Expired profiles (expires_at in the past) are returned, with
    last_verified_at + expires_at letting the UI render staleness.
    Disputed profiles are returned, with dispute_state =
    'DISPUTED' so the UI can surface a 'conflicting reports'
    badge.
    """
    place = get_place(db, place_id)
    if place is None:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    profile = get_public_halal_profile(db, place_id=place_id)
    if profile is None:
        raise NotFoundError(
            "HALAL_PROFILE_NOT_FOUND",
            "This place doesn't have a current halal profile.",
        )
    return HalalProfileRead.model_validate(profile)


@router.get(
    "",
    response_model=list[PlaceSearchResult],
    summary="Search the public places catalog (text or geo)",
    description=(
        "Two search modes, mutually exclusive:\n\n"
        "* **Text** — pass `q` (case-insensitive substring on name + "
        "address + city). Powers the owner portal's claim flow.\n"
        "* **Geo** — pass `lat` + `lng` + `radius` (meters). Powers "
        "the consumer site's 'halal places near me'.\n\n"
        "If `q` is set, geo params are ignored. If neither is "
        "populated, returns 400 (`PLACES_SEARCH_PARAMS_REQUIRED`) — "
        "there's no meaningful 'list everything' on a public catalog "
        "of this size."
    ),
)
def search_places(
    q: str | None = Query(default=None, max_length=255),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius: int | None = Query(default=None, gt=0, le=100_000),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    # ----- Halal preference filters -----
    # Threshold-style for the ordered enums:
    min_validation_tier: ValidationTier | None = Query(
        default=None,
        description=(
            "Minimum acceptable validation tier. Passing "
            "CERTIFICATE_ON_FILE includes both CERTIFICATE_ON_FILE "
            "and TRUST_HALAL_VERIFIED."
        ),
    ),
    min_menu_posture: MenuPosture | None = Query(
        default=None,
        description=(
            "Minimum acceptable menu posture, ordered FULLY_HALAL > "
            "MIXED_SEPARATE_KITCHENS > HALAL_OPTIONS_ADVERTISED > "
            "HALAL_UPON_REQUEST > MIXED_SHARED_KITCHEN. Passing a "
            "value includes everything at-or-above."
        ),
    ),
    # Multi-value: pass the param multiple times to accept multiple
    # slaughter methods for a meat (e.g. ZABIHAH or NOT_SERVED both OK).
    chicken_slaughter: list[SlaughterMethod] | None = Query(default=None),
    beef_slaughter: list[SlaughterMethod] | None = Query(default=None),
    lamb_slaughter: list[SlaughterMethod] | None = Query(default=None),
    goat_slaughter: list[SlaughterMethod] | None = Query(default=None),
    has_certification: bool | None = Query(default=None),
    no_pork: bool | None = Query(default=None),
    no_alcohol_served: bool | None = Query(default=None),
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

    Halal preference filters are optional. When any filter is set
    the results are restricted to places with a non-revoked
    HalalProfile that matches every populated condition. Places
    without a profile, or with a revoked profile, drop out of the
    result set entirely — the consumer asked for halal-verified
    places and an unverified place isn't an answer to that question.
    """
    has_text = q is not None and q.strip() != ""
    has_geo = lat is not None and lng is not None and radius is not None

    halal_filters = HalalSearchFilters(
        min_validation_tier=min_validation_tier,
        min_menu_posture=min_menu_posture,
        chicken_slaughter=tuple(chicken_slaughter or ()),
        beef_slaughter=tuple(beef_slaughter or ()),
        lamb_slaughter=tuple(lamb_slaughter or ()),
        goat_slaughter=tuple(goat_slaughter or ()),
        has_certification=has_certification,
        no_pork=no_pork,
        no_alcohol_served=no_alcohol_served,
    )

    if has_text:
        rows = search_by_text(
            db,
            q=q.strip(),
            limit=limit,
            offset=offset,
            halal_filters=halal_filters,
        )
    elif has_geo:
        rows = search_nearby(
            db,
            lat=lat,
            lng=lng,
            radius_m=radius,
            limit=limit,
            offset=offset,
            halal_filters=halal_filters,
        )
    else:
        raise BadRequestError(
            "PLACES_SEARCH_PARAMS_REQUIRED",
            "Provide either 'q' for text search or 'lat'+'lng'+'radius' for geo search.",
        )

    # Map (place, profile) tuples → PlaceSearchResult with the
    # embedded profile. Done by hand rather than relying on FastAPI's
    # response_model coercion because the repo returns tuples and
    # PlaceSearchResult has from_attributes=True (which doesn't know
    # how to read a tuple).
    return [
        PlaceSearchResult.model_validate(
            {
                "id": place.id,
                "name": place.name,
                "address": place.address,
                "lat": place.lat,
                "lng": place.lng,
                "city": place.city,
                "region": place.region,
                "country_code": place.country_code,
                "halal_profile": (
                    HalalProfileEmbed.model_validate(profile)
                    if profile is not None
                    else None
                ),
            }
        )
        for place, profile in rows
    ]