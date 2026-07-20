from __future__ import annotations

from functools import lru_cache as _lru_cache
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.core.config import settings
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.rate_limit import ip_key, limiter
from app.db.deps import get_db
from app.modules.halal_profiles.enums import (
    HalalProfileEventType,
    MenuPosture,
    SlaughterMethod,
    ValidationTier,
)
from app.modules.halal_claims.enums import HalalClaimEventType
from app.modules.halal_claims.models import HalalClaimEvent
from app.modules.verifiers.models import VerifierProfile
from app.modules.users.models import User
from app.modules.places.enums import Cuisine
from app.modules.halal_profiles.repo import get_public_halal_profile
from app.modules.halal_profiles.schemas import HalalProfileRead
from app.modules.places.integrations.google import (
    extract_locality_from_geocode,
)
from app.modules.places.integrations.google_client import (
    GoogleAPIError,
    fetch_forward_geocode_google,
    fetch_place_autocomplete_google,
    fetch_reverse_geocode_google,
)
from app.modules.places.integrations.mapbox import (
    MapboxAPIError,
    fetch_forward_geocode_mapbox,
    fetch_reverse_geocode_mapbox,
)
from app.modules.places.repo import (
    diagnose_empty_search,
    HalalSearchFilters,
    create_place,
    get_place,
    list_owned_places_for_user,
    search_by_text,
    search_nearby,
)
from app.modules.places.schemas import (
    GoogleAutocompletePrediction,
    HalalHistoryEventRead,
    HalalProfileEmbed,
    OwnedPlaceRead,
    OwnedPlaceUpdate,
    ForwardGeocodeMatch,
    ForwardGeocodeResults,
    PlaceCreate,
    PlaceDetail,
    PlaceRead,
    PlaceSearchResult,
    SearchDiagnosticsResponse,
    ReverseGeocodeResult,
)
from app.modules.places.models import Place, PlaceEvent
from app.modules.places.enums import PlaceEventType
from app.modules.places.hours import is_open_now
from app.modules.places.photos.repo import serialize_photos_for_place
from app.modules.organizations.deps import assert_can_manage_place
from app.core.auth import CurrentUser, get_current_user
from app.core.storage import StorageClient, get_photos_storage_client
from app.modules.users.enums import UserRole
from sqlalchemy import select

router = APIRouter(prefix="/places", tags=["places"])


def _place_is_claimed(db: Session, place_id) -> bool:
    """Whether an ownership claim exists that could produce a replying owner.

    Module scope on purpose: the search listing computes the same answer in
    bulk for a page via a local helper, but the place-detail route needs it
    for one place and lives elsewhere in this file.

    Same states the listing counts as claimed — anything short of a rejection
    means someone is on the way to being able to answer reviews, and inviting
    them to claim a place they've already claimed reads as broken.
    """
    # Both imported locally: OwnershipRequestStatus is imported inside the
    # search handler rather than at module level, and the models import is
    # deferred to avoid a cycle.
    from app.modules.ownership_requests.enums import OwnershipRequestStatus
    from app.modules.ownership_requests.models import PlaceOwnershipRequest

    states = (
        OwnershipRequestStatus.SUBMITTED.value,
        OwnershipRequestStatus.NEEDS_EVIDENCE.value,
        OwnershipRequestStatus.UNDER_REVIEW.value,
        OwnershipRequestStatus.APPROVED.value,
    )
    return (
        db.execute(
            select(PlaceOwnershipRequest.place_id)
            .where(PlaceOwnershipRequest.place_id == place_id)
            .where(PlaceOwnershipRequest.status.in_(states))
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )



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


@me_places_router.patch(
    "/places/{place_id}",
    response_model=PlaceDetail,
    summary="Owner edit of place metadata (cuisine tags)",
    description=(
        "Owner-scoped place update. Currently accepts only "
        "``cuisine_types`` — the curated cuisine tags surfaced on "
        "consumer search rows. Authorization mirrors the halal-claim "
        "submission rule: the caller must be an active "
        "OWNER_ADMIN/MANAGER on an organization that has an active "
        "PlaceOwner row for this place. Admins are also allowed via "
        "the same dependency.\n\n"
        "Identity columns (name, address, lat/lng, city, country) "
        "deliberately stay admin-only — those are the canonical "
        "source-of-truth fields populated by Google ingest, and "
        "owners shouldn't be able to drift them. Cuisine tags are "
        "purely descriptive metadata, so it's safe to let the "
        "operator who knows the venue best edit them."
    ),
)
def patch_owned_place(
    place_id: UUID,
    body: OwnedPlaceUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    photos_storage: StorageClient = Depends(get_photos_storage_client),
) -> PlaceDetail:
    # Ownership gate first — assert_can_manage_place 403s on miss.
    # Admins fall through this check for parity with the halal-claim
    # write paths.
    assert_can_manage_place(db, user, place_id)

    place = db.execute(
        select(Place).where(Place.id == place_id)
    ).scalar_one_or_none()
    if place is None or place.is_deleted:
        # Surfacing 404 (not 403) when the place is gone is the same
        # contract the public GET /places/{id} uses for soft-deleted
        # rows; keeps the owner UI's error handling simple.
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    # Today the only patchable field is cuisine_types. Pydantic has
    # already validated each entry against the Cuisine enum; we only
    # have to dedupe + serialize to the StrEnum's string value (the
    # column is TEXT[]).
    seen: set[Cuisine] = set()
    deduped: list[Cuisine] = []
    for c in body.cuisine_types:
        if c in seen:
            continue
        seen.add(c)
        deduped.append(c)
    place.cuisine_types = [c.value for c in deduped]

    # EDITED audit row — keeps cuisine changes visible in the place
    # event timeline alongside admin edits and Google resyncs. Message
    # text mirrors the convention used by link/resync ("Set cuisines:
    # ..." vs "Cleared cuisine tags") so the timeline reads cleanly.
    if deduped:
        message = "Owner set cuisines: " + ", ".join(c.value for c in deduped)
    else:
        message = "Owner cleared cuisine tags"
    db.add(
        PlaceEvent(
            place_id=place.id,
            event_type=PlaceEventType.EDITED.value,
            actor_user_id=user.id,
            message=message,
        )
    )

    db.add(place)
    db.commit()
    db.refresh(place)

    # Build the same PlaceDetail shape GET /places/{id} emits so the
    # owner-portal mutation hook can invalidate the public cache and
    # get back a consistent snapshot. The embedded halal_profile read
    # is the same single fetch the public endpoint uses.
    profile = get_public_halal_profile(db, place_id=place.id)
    halal_embed = (
        HalalProfileEmbed.model_validate(profile, from_attributes=True)
        if profile is not None
        else None
    )
    photos_payload, hero_url = serialize_photos_for_place(
        db, place=place, storage=photos_storage
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
            "phone": place.phone,
            "cuisine_types": list(place.cuisine_types or []),
            "updated_at": place.updated_at,
            "halal_profile": halal_embed,
            "photos": photos_payload,
            "hero_photo_url": hero_url,
            "review_rating_avg": (
                float(place.review_rating_avg)
                if place.review_rating_avg is not None
                else None
            ),
            "review_count": place.review_count or 0,
            "is_claimed": _place_is_claimed(db, place.id),
        }
    )


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
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
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
    — a transient outage shouldn't poison the cache.

    Provider preference mirrors the forward-geocode path: Mapbox
    when its token is configured, Google otherwise.
    """
    if settings.MAPBOX_ACCESS_TOKEN:
        try:
            locality = fetch_reverse_geocode_mapbox(lat_3dp, lng_3dp)
        except MapboxAPIError as exc:
            # Same translation as the forward path so the route's
            # exception handler can stay provider-agnostic.
            raise GoogleAPIError(str(exc)) from exc
        return (locality.city, locality.region, locality.country_code)

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


# ---------------------------------------------------------------------------
# Forward-geocode proxy — backs the consumer "Pick a city" dialog
# that fires when geolocation is denied / unsupported / unavailable.
# ---------------------------------------------------------------------------

# Cache key is the lowercased trimmed query so "Atlanta", "atlanta",
# and "  Atlanta  " collapse to one billed call. Same in-memory
# pattern as reverse-geocode — restarts drop the cache, traffic
# patterns reseed it within minutes for popular cities.
#
# Provider preference: Mapbox if its access token is configured
# (better free tier, doesn't share quota with Places), Google
# otherwise so existing deployments keep working unchanged. Both
# providers normalize down to the same ``(label, lat, lng, city,
# region, country_code)`` row shape so callers don't branch.
@_lru_cache(maxsize=10_000)
def _cached_forward_geocode_payload(query_norm: str) -> tuple:
    """Cached wrapper. Returns a tuple of ``(label, lat, lng, city,
    region, country_code)`` rows so the cache value is hashable.
    """
    if settings.MAPBOX_ACCESS_TOKEN:
        # Mapbox path returns the cache rows directly — already
        # normalized to the tuple shape we cache. Translate Mapbox
        # errors into the same ``GoogleAPIError`` the router catches
        # so the response code path doesn't have to branch on
        # provider.
        try:
            rows = fetch_forward_geocode_mapbox(query_norm)
        except MapboxAPIError as exc:
            raise GoogleAPIError(str(exc)) from exc
        return tuple(rows[:5])

    payload = fetch_forward_geocode_google(query_norm)
    results = payload.get("results") or []
    out: list[tuple[str, float, float, str | None, str | None, str | None]] = []
    for r in results:
        loc = (r.get("geometry") or {}).get("location") or {}
        lat = loc.get("lat")
        lng = loc.get("lng")
        if lat is None or lng is None:
            continue
        # Reuse the existing locality extractor — we want the same
        # structured (city, region, country_code) the reverse-geocode
        # path produces, so the consumer search URL stays consistent
        # whether the user came in via near-me or pick-a-city.
        locality = extract_locality_from_geocode({"results": [r]})
        label = (
            r.get("formatted_address")
            or _compose_label(locality.city, locality.region, locality.country_code)
            or "Unnamed location"
        )
        out.append(
            (
                label,
                float(lat),
                float(lng),
                locality.city,
                locality.region,
                locality.country_code,
            )
        )
    # Cap at 5 — the consumer dialog renders a small list, not a
    # results page, and 5 candidates are almost always the right
    # shape for a city query.
    return tuple(out[:5])


def _compose_label(
    city: str | None, region: str | None, country_code: str | None
) -> str | None:
    """Fallback label builder when Google didn't ship a
    formatted_address. Returns "City, REGION" when both are present,
    "City" alone when region's missing, etc."""
    parts = [p for p in (city, region, country_code) if p]
    return ", ".join(parts) if parts else None


@router.get(
    "/google/forward-geocode",
    response_model=ForwardGeocodeResults,
    summary="Google Geocoding forward-lookup proxy",
    description=(
        "Server-side proxy to the Google Geocoding API for free-text "
        "place queries. Backs the consumer 'Pick a city' dialog that "
        "fires when the browser denies / can't fulfill geolocation. "
        "Returns up to 5 candidate matches with resolved lat/lng + a "
        "human-readable label so the dialog can render a one-tap "
        "disambiguation list. Same key-hygiene posture as "
        "reverse-geocode and autocomplete: GOOGLE_MAPS_API_KEY is "
        "never exposed to the browser. Empty / no-result queries "
        "return an empty matches array (200 OK, not 404). Rate-"
        "limited per-IP to bound Google quota cost."
    ),
)
@limiter.limit("60/minute", key_func=ip_key)
@limiter.limit("600/hour", key_func=ip_key)
def google_forward_geocode(
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    db: Session = Depends(get_db),
) -> ForwardGeocodeResults:
    """Forward-geocode a free-text city / place query.

    Public on purpose: Pick-a-city is anonymous-friendly and the
    response only contains publicly-knowable map metadata. Cache key
    is the lowercased trimmed query so "Atlanta", "atlanta", and
    "Atlanta GA" each get their own (cheap) cache slot but two
    identical queries collapse.
    """
    del db  # kept for signature symmetry; see autocomplete handler

    query_norm = q.strip().lower()
    if not query_norm:
        return ForwardGeocodeResults(matches=[])

    try:
        rows = _cached_forward_geocode_payload(query_norm)
    except GoogleAPIError as exc:
        # Same posture as reverse-geocode: hide Google's verbose error
        # text and let the client render a soft empty state. The
        # dialog's UX should be "we couldn't find that, try again",
        # not "the system is down".
        raise BadRequestError(
            "GOOGLE_FORWARD_GEOCODE_UNAVAILABLE",
            f"Google Forward Geocoding is currently unavailable: {exc}",
        )

    return ForwardGeocodeResults(
        matches=[
            ForwardGeocodeMatch(
                label=label,
                lat=lat,
                lng=lng,
                city=city,
                region=region,
                country_code=country_code,
            )
            for (label, lat, lng, city, region, country_code) in rows
        ]
    )


# NOTE ON ORDERING: this static path MUST stay above "/{place_id}" below.
# FastAPI matches routes in registration order, so with the dynamic route
# first, a request for /places/search-diagnostics is matched against
# /places/{place_id} and 422s trying to parse "search-diagnostics" as a UUID.
# That's how this shipped and why the endpoint was unreachable — the tests
# caught it, nothing about the code looked wrong.
@router.get(
    "/search-diagnostics",
    response_model=SearchDiagnosticsResponse,
    summary="Why a search returned nothing, and what would fix it",
    description=(
        "Takes the same parameters as `GET /places` and reports which single "
        "filter is responsible for an empty result set.\n\n"
        "Exists because 'nothing matched, try removing a filter' makes the "
        "person guess which one. On a catalogue this size most empty searches "
        "are one filter away from something, and naming it with a count is "
        "the difference between a dead end and a next step.\n\n"
        "Deliberately returns counts and machine field names only — it never "
        "returns places. A diner who filtered out alcohol or non-zabihah meat "
        "is not looking for near-misses; those aren't 'close enough', they're "
        "food they can't eat. The answer to an empty search here is better "
        "information about the filters, not a consolation list.\n\n"
        "Every count runs through the same query builders as the real search, "
        "so it can't promise results the search won't deliver."
    ),
)
def search_diagnostics(
    q: str | None = Query(default=None, max_length=255),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius: int | None = Query(default=None, gt=0, le=100_000),
    wider_radius: int | None = Query(
        default=None,
        gt=0,
        le=100_000,
        description=(
            "Optional larger radius to price up, so the client can offer a "
            "'widen to X' action with a real number attached."
        ),
    ),
    min_validation_tier: ValidationTier | None = Query(default=None),
    min_menu_posture: MenuPosture | None = Query(default=None),
    chicken_slaughter: list[SlaughterMethod] | None = Query(default=None),
    beef_slaughter: list[SlaughterMethod] | None = Query(default=None),
    lamb_slaughter: list[SlaughterMethod] | None = Query(default=None),
    goat_slaughter: list[SlaughterMethod] | None = Query(default=None),
    has_certification: bool | None = Query(default=None),
    no_pork: bool | None = Query(default=None),
    no_alcohol_served: bool | None = Query(default=None),
    cuisine: list[Cuisine] | None = Query(default=None),
    db: Session = Depends(get_db),
) -> SearchDiagnosticsResponse:
    has_text = q is not None and q.strip() != ""
    has_geo = lat is not None and lng is not None and radius is not None
    if not (has_text or has_geo):
        raise BadRequestError(
            "PLACES_SEARCH_PARAMS_REQUIRED",
            "Provide either 'q' for text search or 'lat'+'lng'+'radius' for geo search.",
        )

    diagnostics = diagnose_empty_search(
        db,
        q=q if has_text else None,
        lat=lat if has_geo else None,
        lng=lng if has_geo else None,
        radius_m=radius if has_geo else None,
        halal_filters=HalalSearchFilters(
            min_validation_tier=min_validation_tier,
            min_menu_posture=min_menu_posture,
            chicken_slaughter=tuple(chicken_slaughter or ()),
            beef_slaughter=tuple(beef_slaughter or ()),
            lamb_slaughter=tuple(lamb_slaughter or ()),
            goat_slaughter=tuple(goat_slaughter or ()),
            has_certification=has_certification,
            no_pork=no_pork,
            no_alcohol_served=no_alcohol_served,
        ),
        cuisines=tuple(cuisine or ()),
        wider_radius_m=wider_radius if has_geo else None,
    )
    return SearchDiagnosticsResponse.model_validate(diagnostics)


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
    photos_storage: StorageClient = Depends(get_photos_storage_client),
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

    # Photos are loaded eagerly via the Place.photos relationship
    # (selectin), so this is a pure transform — no extra DB hit
    # beyond the uploader-display-name batch lookup inside the
    # helper.
    photos_payload, hero_url = serialize_photos_for_place(
        db, place=place, storage=photos_storage
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
            "phone": place.phone,
            "website_url": place.website_url,
            "google_rating": (
                float(place.google_rating)
                if place.google_rating is not None
                else None
            ),
            "google_rating_count": place.google_rating_count,
            "google_synced_at": place.google_synced_at,
            "opening_hours_weekday_text": place.opening_hours_weekday_text,
            "open_now": is_open_now(place.opening_hours, place.timezone),
            # Curated cuisine tags. Cast through list() because the
            # column may come back as a tuple/array depending on the
            # SQLAlchemy dialect on the connection.
            "cuisine_types": list(place.cuisine_types or []),
            "updated_at": place.updated_at,
            "halal_profile": halal_embed,
            "photos": photos_payload,
            "hero_photo_url": hero_url,
            "review_rating_avg": (
                float(place.review_rating_avg)
                if place.review_rating_avg is not None
                else None
            ),
            "review_count": place.review_count or 0,
            "is_claimed": _place_is_claimed(db, place.id),
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


# Profile-lifecycle events surfaced verbatim on the consumer timeline (their
# public event_type equals the enum value). CREATED/UPDATED and
# VERIFIER_VISIT_ACCEPTED are handled specially; everything not listed here or
# there is internal noise and dropped.
_PUBLIC_PROFILE_EVENTS = frozenset(
    {
        HalalProfileEventType.EXPIRED,
        HalalProfileEventType.DISPUTE_OPENED,
        HalalProfileEventType.DISPUTE_RESOLVED,
        HalalProfileEventType.REVOKED,
        HalalProfileEventType.RESTORED,
    }
)


@router.get(
    "/{place_id}/halal-history",
    response_model=list[HalalHistoryEventRead],
    summary="Verification history for a place's halal profile",
    description=(
        "Chronological (newest-first) audit trail of the place's halal "
        "profile — creation, updates, disputes, revocations, accepted "
        "verifier visits. Powers the 'verification history' section on "
        "the expanded trust profile. Returns an empty list when the "
        "place has no profile yet; 404 only if the place doesn't exist."
    ),
)
def get_place_halal_history(
    place_id: UUID,
    db: Session = Depends(get_db),
) -> list[HalalHistoryEventRead]:
    place = get_place(db, place_id)
    if place is None:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    profile = get_public_halal_profile(db, place_id=place_id)
    if profile is None:
        return []

    # ``HalalProfile.events`` is ordered created_at DESC on the relationship.
    events = list(profile.events)

    # The claim(s) behind this profile: CREATED/UPDATED point at the approved
    # claim that produced the state. We surface those claims' submitted/approved
    # milestones instead of the profile CREATED/UPDATED mirror rows.
    claim_ids = {
        e.related_claim_id
        for e in events
        if e.event_type
        in (HalalProfileEventType.CREATED, HalalProfileEventType.UPDATED)
        and e.related_claim_id is not None
    }

    # Verifier actors (display name + public handle) for visit rows — the only
    # events that carry a person on the consumer timeline.
    visit_actor_ids = {
        e.actor_user_id
        for e in events
        if e.event_type == HalalProfileEventType.VERIFIER_VISIT_ACCEPTED
        and e.actor_user_id is not None
    }
    actor_map: dict[UUID, tuple[str | None, str | None]] = {}
    if visit_actor_ids:
        rows = (
            db.query(User.id, User.display_name, VerifierProfile.public_handle)
            .outerjoin(VerifierProfile, VerifierProfile.user_id == User.id)
            .filter(User.id.in_(visit_actor_ids))
            .all()
        )
        actor_map = {r[0]: (r[1], r[2]) for r in rows}

    timeline: list[HalalHistoryEventRead] = []

    for e in events:
        et = e.event_type
        if et in (HalalProfileEventType.CREATED, HalalProfileEventType.UPDATED):
            # Claim-backed creations are represented by the claim milestones
            # below; only surface a bare "profile created/updated" when there's
            # no claim (e.g. an admin-ingested profile).
            if e.related_claim_id is not None:
                continue
            timeline.append(
                HalalHistoryEventRead(
                    event_type="PROFILE_CREATED"
                    if et == HalalProfileEventType.CREATED
                    else "PROFILE_UPDATED",
                    created_at=e.created_at,
                )
            )
        elif et == HalalProfileEventType.VERIFIER_VISIT_ACCEPTED:
            name, handle = actor_map.get(e.actor_user_id, (None, None))
            timeline.append(
                HalalHistoryEventRead(
                    event_type="VERIFIER_VISIT",
                    created_at=e.created_at,
                    actor_display_name=name,
                    actor_handle=handle,
                )
            )
        elif et in _PUBLIC_PROFILE_EVENTS:
            timeline.append(
                HalalHistoryEventRead(event_type=str(et), created_at=e.created_at)
            )
        # Everything else (internal noise) is intentionally dropped.

    if claim_ids:
        claim_events = (
            db.query(HalalClaimEvent)
            .filter(
                HalalClaimEvent.claim_id.in_(claim_ids),
                HalalClaimEvent.event_type.in_(
                    [HalalClaimEventType.SUBMITTED, HalalClaimEventType.APPROVED]
                ),
            )
            .all()
        )
        for ce in claim_events:
            timeline.append(
                HalalHistoryEventRead(
                    event_type="CLAIM_SUBMITTED"
                    if ce.event_type == HalalClaimEventType.SUBMITTED
                    else "CLAIM_APPROVED",
                    created_at=ce.created_at,
                )
            )

    timeline.sort(key=lambda x: x.created_at, reverse=True)
    return timeline


@router.get(
    "",
    response_model=list[PlaceSearchResult],
    summary="Search the public places catalog (text and/or geo)",
    description=(
        "Two search modes, combinable:\n\n"
        "* **Text** — pass `q` (case-insensitive substring on name + "
        "address + city). Powers the owner portal's claim flow.\n"
        "* **Geo** — pass `lat` + `lng` + `radius` (meters). Powers "
        "the consumer site's 'halal places near me'.\n\n"
        "If both `q` and the geo trio are set, the text match is "
        "constrained to the radius ('search by name near me'). If "
        "neither is populated, returns 400 "
        "(`PLACES_SEARCH_PARAMS_REQUIRED`) — there's no meaningful "
        "'list everything' on a public catalog of this size."
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
    open_now: bool = Query(
        default=False,
        description=(
            "When true, exclude places we can confirm are CLOSED right now "
            "(computed from stored Google hours + place timezone). Places with "
            "unknown hours are kept (open_now=null) so a young catalog still "
            "surfaces them — the client badges them 'No hours available'. "
            "Applied after the DB query over a capped scan of matches, so "
            "pagination is honored within that cap."
        ),
    ),
    # Multi-value: ?cuisine=PAKISTANI&cuisine=INDIAN. Result is the
    # union — places matching ANY of the requested cuisines (overlap),
    # not the intersection. That matches how users think about cuisine
    # filters ("show me Pakistani OR Indian, not Pakistani-AND-Indian
    # fusion places").
    cuisine: list[Cuisine] | None = Query(
        default=None,
        description=(
            "Multi-value cuisine filter. Results match any of the "
            "passed cuisines (overlap). Pass the param multiple times "
            "to broaden the match. Empty / missing = no cuisine filter."
        ),
    ),
    db: Session = Depends(get_db),
    photos_storage: StorageClient = Depends(get_photos_storage_client),
) -> list[PlaceSearchResult]:
    """Browse the public places catalog.

    Two search modes, combinable:

    * **Text** — pass ``q`` (case-insensitive substring on name +
      address + city). Used by the owner portal's claim flow when the
      restaurant owner types the name of their place.
    * **Geo** — pass ``lat`` + ``lng`` + ``radius`` (meters). Used by
      the consumer site to render "halal places near me".

    When both ``q`` and the full geo trio are provided, the text
    match is constrained to the radius — "search by name near me".
    If neither path is populated, we 400 — there's no meaningful
    "list everything" response on a public catalog of this size.

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

    cuisines = tuple(cuisine or ())

    # "Open now" is computed in Python from stored hours (there's no clean
    # SQL expression for a JSONB weekly schedule across midnight + timezone).
    # To keep pagination correct we over-fetch a capped, unoffset scan when
    # the filter is on, then filter + slice below.
    _OPEN_NOW_SCAN_CAP = 200
    scan_limit = _OPEN_NOW_SCAN_CAP if open_now else limit
    scan_offset = 0 if open_now else offset

    if has_text:
        rows = search_by_text(
            db,
            q=q.strip(),
            limit=scan_limit,
            offset=scan_offset,
            halal_filters=halal_filters,
            cuisines=cuisines,
            # When the caller also has geo context, constrain the
            # text match to the radius. All-or-nothing: partial geo
            # is ignored the same way the geo-only path requires the
            # full trio.
            lat=lat if has_geo else None,
            lng=lng if has_geo else None,
            radius_m=radius if has_geo else None,
        )
    elif has_geo:
        rows = search_nearby(
            db,
            lat=lat,
            lng=lng,
            radius_m=radius,
            limit=scan_limit,
            offset=scan_offset,
            halal_filters=halal_filters,
            cuisines=cuisines,
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
    #
    # ``hero_photo_url`` is derived inline from the eagerly-loaded
    # ``place.photos`` relationship — search results don't carry
    # the full gallery (the result card only renders the cover) so
    # we skip the full ``serialize_photos_for_place`` call that does
    # the uploader-display-name batch lookup. One Python iteration
    # per place; no extra DB hit.
    def _hero_url_for(place: Place) -> str | None:
        for p in place.photos or []:
            if p.deleted_at is None and p.is_hero:
                return photos_storage.public_url(p.storage_path)
        return None

    # Which of these places already have a claim in flight or granted, so the
    # owner claim flow can grey them out. One query for the whole page. Lazy
    # import to sidestep the places <-> ownership_requests cycle.
    from app.modules.ownership_requests.enums import OwnershipRequestStatus
    from app.modules.ownership_requests.models import PlaceOwnershipRequest

    _CLAIMED_STATES = (
        OwnershipRequestStatus.SUBMITTED.value,
        OwnershipRequestStatus.NEEDS_EVIDENCE.value,
        OwnershipRequestStatus.UNDER_REVIEW.value,
        OwnershipRequestStatus.APPROVED.value,
    )
    page_place_ids = [place.id for place, _ in rows]
    claimed_place_ids: set = set()
    if page_place_ids:
        claimed_place_ids = set(
            db.execute(
                select(PlaceOwnershipRequest.place_id)
                .where(PlaceOwnershipRequest.place_id.in_(page_place_ids))
                .where(PlaceOwnershipRequest.status.in_(_CLAIMED_STATES))
            ).scalars().all()
        )

    results = [
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
                "cuisine_types": list(place.cuisine_types or []),
                "is_claimed": place.id in claimed_place_ids,
                "hero_photo_url": _hero_url_for(place),
                "review_rating_avg": (
                    float(place.review_rating_avg)
                    if place.review_rating_avg is not None
                    else None
                ),
                "review_count": place.review_count or 0,
                "google_rating": (
                    float(place.google_rating)
                    if place.google_rating is not None
                    else None
                ),
                "google_rating_count": place.google_rating_count,
                "open_now": is_open_now(place.opening_hours, place.timezone),
                "halal_profile": (
                    HalalProfileEmbed.model_validate(profile)
                    if profile is not None
                    else None
                ),
            }
        )
        for place, profile in rows
    ]

    if open_now:
        # Drop only places we can confirm are CLOSED right now. Confirmed-
        # open (True) and unknown-hours (None) both stay — the latter get a
        # "No hours available" badge client-side so a diner can tell them
        # apart. Then apply the caller's page window over the filtered set.
        results = [r for r in results if r.open_now is not False]
        results = results[offset : offset + limit]

    return results