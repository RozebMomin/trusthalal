from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence
from uuid import UUID

from geoalchemy2.elements import WKTElement
from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

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
from app.modules.places.enums import PlaceEventType
from app.modules.places.models import Place, PlaceEvent


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
    

def search_by_text(
    db: Session,
    *,
    q: str,
    limit: int,
    offset: int,
    halal_filters: HalalSearchFilters | None = None,
) -> list[Place]:
    """ILIKE substring search on name + address + city for the public
    catalog.

    Used by the owner portal's claim flow ("type the name of your
    restaurant"). Excludes deleted places — they shouldn't show up
    when an owner is trying to find their own listing.

    When ``halal_filters`` is populated, results are restricted to
    places with a non-revoked HalalProfile that matches every
    populated filter. Empty filters (or None) skip the join.

    Sort: name ASC. Predictable order beats relevance scoring at this
    scale (low thousands of rows). If/when the catalog grows past
    10k+, we can layer trigram (pg_trgm) or full-text (tsvector) on
    top without changing the wire shape.
    """
    needle = f"%{q.strip()}%"
    if needle == "%%":
        return []

    stmt = (
        select(Place)
        .where(Place.is_deleted.is_(False))
        .where(
            or_(
                Place.name.ilike(needle),
                Place.address.ilike(needle),
                Place.city.ilike(needle),
            )
        )
    )
    if halal_filters is not None and not halal_filters.is_empty():
        stmt = _apply_halal_filters(stmt, halal_filters)
    stmt = stmt.order_by(Place.name.asc()).limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


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
) -> list[Place]:
    """Geo-radius search via PostGIS ST_DWithin, with optional halal
    filters layered on the same INNER JOIN pattern as text search.
    """
    stmt = (
        select(Place)
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
    stmt = stmt.limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())