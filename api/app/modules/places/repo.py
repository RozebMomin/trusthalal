from __future__ import annotations

from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import or_, select, text
from geoalchemy2.elements import WKTElement

from app.modules.places.enums import PlaceEventType
from app.modules.places.models import Place, PlaceEvent


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
) -> list[Place]:
    """ILIKE substring search on name + address + city for the public
    catalog.

    Used by the owner portal's claim flow ("type the name of your
    restaurant"). Excludes deleted places — they shouldn't show up
    when an owner is trying to find their own listing.

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
        .order_by(Place.name.asc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.execute(stmt).scalars().all())


def search_nearby(db: Session, *, lat: float, lng: float, radius_m: int, limit: int, offset: int) -> list[Place]:
    """
    Uses ST_DWithin on geography to leverage GiST index for radius search in meters.
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
        .limit(limit)
        .offset(offset)
    )
    return list(db.execute(stmt).scalars().all())