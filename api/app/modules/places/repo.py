from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Sequence
from uuid import UUID

from geoalchemy2.elements import WKTElement
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from app.core.analytics import track
from app.modules.halal_profiles.enums import (
    MenuPosture,
    SlaughterMethod,
    ValidationTier,
)
from app.modules.halal_profiles.models import HalalProfile
from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.places.enums import Cuisine, PlaceEventType
from app.modules.places.models import Place, PlaceEvent

# Backslash is the escape character passed to ``.ilike(..., escape="\\")``.
LIKE_ESCAPE = "\\"


def escape_like(term: str) -> str:
    """Neutralize LIKE/ILIKE metacharacters in user-supplied search text.

    Escapes ``\\``, ``%`` and ``_`` so a caller can't inject wildcards
    (a lone ``%`` would otherwise match every row / force a full scan).
    Use with ``.ilike(f"%{escape_like(q)}%", escape=LIKE_ESCAPE)``.
    """
    return (
        term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    )


# ---------------------------------------------------------------------------
# Halal search filters
# ---------------------------------------------------------------------------
# When any of these are populated, place search inner-joins
# halal_profiles and applies the corresponding WHERE clauses. With
# none of them populated, the search behaves exactly as before
# (no JOIN, no filtering, all places returned).
#
# Threshold semantics for the ordered enums (validation tier, menu
# posture): "min_X" means "X or higher" — passing
# ``min_validation_tier=CERTIFICATE_ON_FILE`` returns places that
# are CERTIFICATE_ON_FILE or TRUST_HALAL_VERIFIED, but not
# SELF_ATTESTED.
#
# Per-meat slaughter filters are sequence-typed so consumer
# preferences like "ZABIHAH or NOT_SERVED is acceptable for
# chicken" can pass both values. An empty list and None are
# equivalent (no filter).


# Order matters: index 0 is the strictest tier, last is the
# loosest. ``_tiers_ge(tier)`` returns the slice from `tier` up to
# the strictest end.
_VALIDATION_TIER_ORDER: tuple[ValidationTier, ...] = (
    ValidationTier.TRUST_HALAL_VERIFIED,
    ValidationTier.CERTIFICATE_ON_FILE,
    ValidationTier.SELF_ATTESTED,
)


def _tiers_ge(min_tier: ValidationTier) -> list[str]:
    """Return tier values >= min_tier (i.e. at least as strict)."""
    idx = _VALIDATION_TIER_ORDER.index(min_tier)
    return [t.value for t in _VALIDATION_TIER_ORDER[: idx + 1]]


# Same idea, but for menu posture. FULLY_HALAL is the strictest;
# MIXED_SHARED_KITCHEN is the loosest.
_MENU_POSTURE_ORDER: tuple[MenuPosture, ...] = (
    MenuPosture.FULLY_HALAL,
    MenuPosture.MIXED_SEPARATE_KITCHENS,
    MenuPosture.HALAL_OPTIONS_ADVERTISED,
    MenuPosture.HALAL_UPON_REQUEST,
    MenuPosture.MIXED_SHARED_KITCHEN,
)


def _postures_ge(min_posture: MenuPosture) -> list[str]:
    """Return menu_posture values >= min_posture in strictness."""
    idx = _MENU_POSTURE_ORDER.index(min_posture)
    return [p.value for p in _MENU_POSTURE_ORDER[: idx + 1]]


@dataclass(frozen=True)
class HalalSearchFilters:
    """Subset of consumer halal preferences applicable as SQL filters.

    All fields default to None / empty — passing an instance with
    everything default is equivalent to "no halal filtering" and
    the search functions skip the join.
    """

    min_validation_tier: ValidationTier | None = None
    min_menu_posture: MenuPosture | None = None
    chicken_slaughter: Sequence[SlaughterMethod] = ()
    beef_slaughter: Sequence[SlaughterMethod] = ()
    lamb_slaughter: Sequence[SlaughterMethod] = ()
    goat_slaughter: Sequence[SlaughterMethod] = ()
    has_certification: bool | None = None
    no_pork: bool | None = None
    no_alcohol_served: bool | None = None

    def is_empty(self) -> bool:
        """True when no filter is set — search functions short-circuit
        the join in that case."""
        return (
            self.min_validation_tier is None
            and self.min_menu_posture is None
            and not self.chicken_slaughter
            and not self.beef_slaughter
            and not self.lamb_slaughter
            and not self.goat_slaughter
            and self.has_certification is None
            and self.no_pork is None
            and self.no_alcohol_served is None
        )


def _apply_halal_filters(stmt: Select, filters: HalalSearchFilters) -> Select:
    """Inner-join halal_profiles and apply the consumer filters.

    The join is INNER — places without a (non-revoked) profile drop
    out of the result entirely. That's the right semantic when the
    caller is filtering by halal posture: "show me places that are
    fully halal" inherently excludes "places with no halal info."

    Revoked profiles are excluded too (revoked_at must be NULL).
    Expired profiles ARE included — staleness is conveyed via
    ``last_verified_at`` / ``expires_at`` in the response, but
    the place is still surfaced.
    """
    stmt = stmt.join(
        HalalProfile, HalalProfile.place_id == Place.id
    ).where(HalalProfile.revoked_at.is_(None))

    if filters.min_validation_tier is not None:
        stmt = stmt.where(
            HalalProfile.validation_tier.in_(
                _tiers_ge(filters.min_validation_tier)
            )
        )
    if filters.min_menu_posture is not None:
        stmt = stmt.where(
            HalalProfile.menu_posture.in_(
                _postures_ge(filters.min_menu_posture)
            )
        )
    if filters.chicken_slaughter:
        stmt = stmt.where(
            HalalProfile.chicken_slaughter.in_(
                [s.value for s in filters.chicken_slaughter]
            )
        )
    if filters.beef_slaughter:
        stmt = stmt.where(
            HalalProfile.beef_slaughter.in_(
                [s.value for s in filters.beef_slaughter]
            )
        )
    if filters.lamb_slaughter:
        stmt = stmt.where(
            HalalProfile.lamb_slaughter.in_(
                [s.value for s in filters.lamb_slaughter]
            )
        )
    if filters.goat_slaughter:
        stmt = stmt.where(
            HalalProfile.goat_slaughter.in_(
                [s.value for s in filters.goat_slaughter]
            )
        )
    if filters.has_certification is True:
        stmt = stmt.where(HalalProfile.has_certification.is_(True))
    if filters.no_pork is True:
        stmt = stmt.where(HalalProfile.has_pork.is_(False))
    if filters.no_alcohol_served is True:
        # "No alcohol served" maps to alcohol_policy = NONE — the
        # other two values (BEER_AND_WINE_ONLY, FULL_BAR) both
        # involve alcohol on premises.
        stmt = stmt.where(HalalProfile.alcohol_policy == "NONE")
    return stmt


def create_place(db: Session, *, name: str, address: str | None, lat: float, lng: float) -> Place:
    # Build a POINT(lng lat) WKT and tag SRID=4326
    geom = WKTElement(f"POINT({lng} {lat})", srid=4326)

    place = Place(
        name=name,
        address=address,
        lat=lat,
        lng=lng,
        geom=geom,
    )
    db.add(place)
    db.commit()
    db.refresh(place)
    return place


def get_place(db: Session, place_id: UUID, include_deleted: bool = False) -> Place | None:
    conds = [Place.id == place_id]
    if not include_deleted:
        conds.append(Place.is_deleted.is_(False))

    stmt = select(Place).where(*conds)
    return db.execute(stmt).scalar_one_or_none()


def log_place_event(
    db: Session,
    *,
    place_id,
    event_type: PlaceEventType,
    actor_user_id=None,
    message: str | None = None,
) -> None:
    db.add(
        PlaceEvent(
            place_id=place_id,
            event_type=event_type.value,
            actor_user_id=actor_user_id,
            message=message,
        )
    )
    _name = _PLACE_EVENT_TRACK.get(event_type)
    if _name:
        track(_name, distinct_id=actor_user_id, properties={"place_id": str(place_id)})


# Place lifecycle milestones surfaced to product analytics.
_PLACE_EVENT_TRACK: dict[PlaceEventType, str] = {
    PlaceEventType.CREATED: "place_added",
    PlaceEventType.OWNERSHIP_GRANTED: "place_claimed",
}



def _apply_cuisine_filter(
    stmt: Select, cuisines: Sequence[Cuisine]
) -> Select:
    """Restrict the result to places tagged with ANY of the requested
    cuisines (overlap, not subset).

    Uses Postgres array overlap (``&&``) — index-friendly via the GIN
    on ``places.cuisine_types``. Empty input returns ``stmt``
    unchanged: callers shouldn't have to short-circuit themselves.
    Cuisine values are coerced to plain strings so the resulting SQL
    array literal is ``ARRAY['PAKISTANI', 'INDIAN']::text[]`` —
    matching the column type ``TEXT[]``.
    """
    if not cuisines:
        return stmt
    values = [c.value for c in cuisines]
    return stmt.where(Place.cuisine_types.op("&&")(values))


def search_by_text(
    db: Session,
    *,
    q: str,
    limit: int,
    offset: int,
    halal_filters: HalalSearchFilters | None = None,
    cuisines: Sequence[Cuisine] = (),
    lat: float | None = None,
    lng: float | None = None,
    radius_m: int | None = None,
) -> list[tuple[Place, HalalProfile | None]]:
    """ILIKE substring search on name + address + city for the public
    catalog.

    Used by the owner portal's claim flow ("type the name of your
    restaurant") and by the consumer site's search surface. Excludes
    deleted places — they shouldn't show up when an owner is trying
    to find their own listing or when a consumer is browsing.

    When ``lat`` + ``lng`` + ``radius_m`` are all provided, the text
    match is additionally constrained to that geo radius (PostGIS
    ST_DWithin — same predicate as ``search_nearby``). This powers
    the consumer surface's "search by name within my area" flow so
    typing a name doesn't silently blow away the user's location
    context. All three must be present; partial geo is ignored.

    When ``halal_filters`` is populated, results are restricted to
    places with a non-revoked HalalProfile that matches every
    populated filter (INNER JOIN on halal_profiles). Empty filters
    use a LEFT OUTER JOIN so places without a profile still appear
    in results, just without an embedded profile.

    Returns ``(Place, HalalProfile | None)`` tuples so the router can
    embed the profile on each ``PlaceSearchResult`` row without an
    N+1 lookup. The ``HalalProfile`` is None when the place has no
    approved claim or the most recent profile was revoked.

    Sort: name ASC. Predictable order beats relevance scoring at this
    scale (low thousands of rows). If/when the catalog grows past
    10k+, we can layer trigram (pg_trgm) or full-text (tsvector) on
    top without changing the wire shape.
    """
    term = q.strip()
    if not term:
        return []
    needle = f"%{escape_like(term)}%"

    stmt = (
        select(Place, HalalProfile)
        .where(Place.is_deleted.is_(False))
        .where(
            or_(
                Place.name.ilike(needle, escape=LIKE_ESCAPE),
                Place.address.ilike(needle, escape=LIKE_ESCAPE),
                Place.city.ilike(needle, escape=LIKE_ESCAPE),
            )
        )
    )
    if lat is not None and lng is not None and radius_m is not None:
        stmt = stmt.where(
            text(
                "ST_DWithin("
                "app.places.geom::geography, "
                "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, "
                ":radius_m"
                ")"
            )
        ).params(lat=lat, lng=lng, radius_m=radius_m)
    if halal_filters is not None and not halal_filters.is_empty():
        # Filtered → INNER JOIN inside _apply_halal_filters; places
        # without a matching profile drop out entirely.
        stmt = _apply_halal_filters(stmt, halal_filters)
    else:
        # Unfiltered → LEFT OUTER JOIN so places without a profile
        # still appear (with halal_profile=None on the response).
        stmt = stmt.outerjoin(
            HalalProfile,
            (HalalProfile.place_id == Place.id)
            & (HalalProfile.revoked_at.is_(None)),
        )
    stmt = _apply_cuisine_filter(stmt, cuisines)
    stmt = stmt.order_by(Place.name.asc()).limit(limit).offset(offset)
    return [(p, hp) for p, hp in db.execute(stmt).all()]


def list_owned_places_for_user(
    db: Session, *, user_id: UUID
) -> list[tuple[Place, Organization, bool]]:
    """List places the user can submit halal info for.

    Joins:
      organization_members (active for this user)
        → organizations
        → place_owners (active)
        → places (not soft-deleted)
        ⟕ halal_profiles (left join — to surface "already has a
                          profile" so the picker can show a different
                          CTA for first-time vs update flows)

    Returns triples of (place, organization, has_profile) so the
    router can build the OwnedPlaceRead response shape without a
    second query per row.
    """
    has_profile_subquery = (
        select(HalalProfile.id)
        .where(
            HalalProfile.place_id == Place.id,
            HalalProfile.revoked_at.is_(None),
        )
        .exists()
        .label("has_profile")
    )

    rows = db.execute(
        select(Place, Organization, has_profile_subquery)
        .join(PlaceOwner, PlaceOwner.place_id == Place.id)
        .join(
            Organization, Organization.id == PlaceOwner.organization_id
        )
        .join(
            OrganizationMember,
            OrganizationMember.organization_id == Organization.id,
        )
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.status == "ACTIVE",
            PlaceOwner.status == "ACTIVE",
            Place.is_deleted.is_(False),
        )
        .order_by(Organization.name.asc(), Place.name.asc())
    ).all()

    return [(place, org, bool(has_profile)) for place, org, has_profile in rows]


def search_nearby(
    db: Session,
    *,
    lat: float,
    lng: float,
    radius_m: int,
    limit: int,
    offset: int,
    halal_filters: HalalSearchFilters | None = None,
    cuisines: Sequence[Cuisine] = (),
) -> list[tuple[Place, HalalProfile | None]]:
    """Geo-radius search via PostGIS ST_DWithin, with optional halal
    filters layered on the same INNER JOIN pattern as text search.

    Returns ``(Place, HalalProfile | None)`` tuples — same shape as
    ``search_by_text`` so the router maps both into the embedded
    ``PlaceSearchResult.halal_profile`` field.
    """
    stmt = (
        select(Place, HalalProfile)
        .where(Place.is_deleted.is_(False))
        .where(
            text(
                "ST_DWithin("
                "app.places.geom::geography, "
                "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, "
                ":radius_m"
                ")"
            )
        )
        .params(lat=lat, lng=lng, radius_m=radius_m)
    )
    if halal_filters is not None and not halal_filters.is_empty():
        stmt = _apply_halal_filters(stmt, halal_filters)
    else:
        stmt = stmt.outerjoin(
            HalalProfile,
            (HalalProfile.place_id == Place.id)
            & (HalalProfile.revoked_at.is_(None)),
        )
    stmt = _apply_cuisine_filter(stmt, cuisines)
    # Nearest first, then id as a stable tie-break.
    #
    # This used to be a bare LIMIT/OFFSET with no ORDER BY, which leaves the
    # row order up to the planner: the same request could return a different
    # 50 places twice in a row, and paging could show a place on two pages or
    # none. It only looked fine because the catalog was smaller than one page.
    #
    # Distance is also the ordering clients actually want — the consumer site
    # re-sorts the page it receives, so an unordered page meant "top rated"
    # ranked an arbitrary subset of what's nearby rather than the nearest N.
    #
    # ST_Distance rather than the `<->` KNN operator: the candidate set is
    # already bounded by ST_DWithin above, so there's no index-scan win to
    # chase, and this is unambiguous about units (meters, on geography).
    stmt = stmt.order_by(
        text(
            "ST_Distance("
            "app.places.geom::geography, "
            "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography"
            ")"
        ),
        Place.id.asc(),
    )
    # Re-bind after adding a second text() clause that references the same
    # names — the earlier .params() call only bound the parameters that
    # existed on the statement at that point.
    stmt = stmt.params(lat=lat, lng=lng, radius_m=radius_m)
    stmt = stmt.limit(limit).offset(offset)
    return [(p, hp) for p, hp in db.execute(stmt).all()]

# ---------------------------------------------------------------------------
# Empty-search diagnostics
# ---------------------------------------------------------------------------
# A zero-result search on a catalogue this size is nearly always one filter
# away from something. "Nothing matched, try removing a filter" makes the
# person guess which one; naming it with a count doesn't.
#
# Every count below runs through the SAME query builders as the real search.
# Re-implementing the predicates in Python would be faster to write and would
# eventually drift, and the failure mode of drift here is telling someone
# "remove this and you'll see 4 places" and then showing them zero — which is
# worse than saying nothing.

#: Field name on ``HalalSearchFilters`` → the query param a client would clear.
#: Keys are returned to the client; the label is deliberately NOT, because the
#: API stays neutral about how each surface words its own filter chips.
RELAXABLE_FILTERS: tuple[str, ...] = (
    "min_validation_tier",
    "min_menu_posture",
    "has_certification",
    "no_pork",
    "no_alcohol_served",
    "chicken_slaughter",
    "beef_slaughter",
    "lamb_slaughter",
    "goat_slaughter",
)


def _active_filter_fields(filters: HalalSearchFilters) -> list[str]:
    """Which relaxable filters the caller actually set."""
    active: list[str] = []
    for field in RELAXABLE_FILTERS:
        value = getattr(filters, field)
        if value is None:
            continue
        # Sequence fields are "set" only when non-empty; booleans only when
        # True (has_certification=False means "don't care", not "must lack").
        if isinstance(value, (list, tuple)) and not value:
            continue
        if value is False:
            continue
        active.append(field)
    return active


def _without(filters: HalalSearchFilters, field: str) -> HalalSearchFilters:
    """A copy with one filter cleared, using that field's own empty value."""
    current = getattr(filters, field)
    empty = () if isinstance(current, (list, tuple)) else None
    return replace(filters, **{field: empty})


def count_matches(
    db: Session,
    *,
    q: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_m: int | None = None,
    halal_filters: HalalSearchFilters | None = None,
    cuisines: Sequence[Cuisine] = (),
) -> int:
    """How many places a search WOULD return, ignoring paging.

    Shares ``_apply_halal_filters`` / ``_apply_cuisine_filter`` with the real
    search functions so a count can never disagree with the list it describes.
    """
    stmt = select(func.count(func.distinct(Place.id))).select_from(Place).where(
        Place.is_deleted.is_(False)
    )

    if q and q.strip():
        # Escaped exactly as ``search_by_text`` does. An unescaped ``%`` here
        # would match everything while the real search matched nothing, so
        # the count would contradict the list it's supposed to explain —
        # precisely the drift this function exists to avoid.
        needle = f"%{escape_like(q.strip())}%"
        stmt = stmt.where(
            or_(
                Place.name.ilike(needle, escape=LIKE_ESCAPE),
                Place.address.ilike(needle, escape=LIKE_ESCAPE),
                Place.city.ilike(needle, escape=LIKE_ESCAPE),
            )
        )

    if lat is not None and lng is not None and radius_m is not None:
        stmt = stmt.where(
            text(
                "ST_DWithin("
                "app.places.geom::geography, "
                "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, "
                ":radius_m"
                ")"
            )
        ).params(lat=lat, lng=lng, radius_m=radius_m)

    if halal_filters is not None and not halal_filters.is_empty():
        stmt = _apply_halal_filters(stmt, halal_filters)

    stmt = _apply_cuisine_filter(stmt, cuisines)
    return int(db.execute(stmt).scalar_one())


@dataclass(frozen=True)
class SearchRelaxation:
    """One change the caller could make, and what it would get them."""

    field: str
    count_if_removed: int


@dataclass(frozen=True)
class SearchDiagnostics:
    total_in_area: int
    """Places in range at all, before any halal or cuisine filtering. Zero
    means the catalogue simply doesn't cover here yet — a different problem
    from a filter being too strict, and it needs different words."""

    single_filter_relaxations: list[SearchRelaxation]
    """Filters that are individually responsible: clear any one and you get
    results. Empty when several filters overlap, in which case no single
    change helps and the honest advice is ``without_halal_filters``."""

    without_halal_filters: int
    without_cuisines: int
    wider_radius_m: int | None
    wider_radius_count: int | None


def diagnose_empty_search(
    db: Session,
    *,
    q: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_m: int | None = None,
    halal_filters: HalalSearchFilters | None = None,
    cuisines: Sequence[Cuisine] = (),
    wider_radius_m: int | None = None,
) -> SearchDiagnostics:
    """Work out why a search came back empty and what would fix it.

    Costs one COUNT per active filter plus a few extras — all indexed, and
    only ever run when a search already returned nothing, so the expensive
    case is the one where the user is otherwise stuck staring at a dead end.
    """
    filters = halal_filters or HalalSearchFilters()

    geo = {"lat": lat, "lng": lng, "radius_m": radius_m}

    total_in_area = count_matches(db, q=q, **geo)

    relaxations: list[SearchRelaxation] = []
    # Only meaningful if there's anything in range to un-filter. When the area
    # is empty, every "remove this filter" count is zero and suggesting one
    # would send the person round in a circle.
    if total_in_area > 0:
        for field in _active_filter_fields(filters):
            count = count_matches(
                db,
                q=q,
                **geo,
                halal_filters=_without(filters, field),
                cuisines=cuisines,
            )
            if count > 0:
                relaxations.append(SearchRelaxation(field=field, count_if_removed=count))
        # Most productive change first — if one relaxation opens up six places
        # and another opens one, lead with the six.
        relaxations.sort(key=lambda r: r.count_if_removed, reverse=True)

    without_halal = (
        count_matches(db, q=q, **geo, cuisines=cuisines) if total_in_area > 0 else 0
    )
    without_cuisines = (
        count_matches(db, q=q, **geo, halal_filters=filters)
        if (cuisines and total_in_area > 0)
        else 0
    )

    wider_count: int | None = None
    if (
        wider_radius_m is not None
        and radius_m is not None
        and wider_radius_m > radius_m
        and lat is not None
    ):
        wider_count = count_matches(
            db,
            q=q,
            lat=lat,
            lng=lng,
            radius_m=wider_radius_m,
            halal_filters=filters,
            cuisines=cuisines,
        )

    return SearchDiagnostics(
        total_in_area=total_in_area,
        single_filter_relaxations=relaxations,
        without_halal_filters=without_halal,
        without_cuisines=without_cuisines,
        wider_radius_m=wider_radius_m if wider_count is not None else None,
        wider_radius_count=wider_count,
    )
