from __future__ import annotations

from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import select, text
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