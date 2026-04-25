from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict


class PlaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    address: Optional[str] = Field(None, max_length=500)

    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class PlaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: Optional[str]
    lat: float
    lng: float
    # Canonical address fields — populated by external provider ingest.
    # All nullable because hand-entered places and pre-ingest rows may lack them.
    city: str | None = None
    region: str | None = None
    country_code: str | None = None
    postal_code: str | None = None

class PlaceNearby(BaseModel):
    distance_m: float


class PlaceSearchResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: str | None
    lat: float
    lng: float
    city: str | None = None
    region: str | None = None
    country_code: str | None = None


class PlaceDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: str | None
    lat: float
    lng: float
    is_deleted: bool  # consumer will never see deleted b/c 404, but ok to include or omit
    city: str | None = None
    region: str | None = None
    country_code: str | None = None
    postal_code: str | None = None
    timezone: str | None = None
    # We intentionally skip a ``created_at`` field: the CREATED row on
    # ``place_events`` carries ingest time + actor, so a top-level
    # created_at would duplicate that with strictly less information.
    updated_at: datetime | None = None

    # Optional: include claims here (recommended)
    claims: list[dict] = []  # replace with ClaimRead later if you want strong typing