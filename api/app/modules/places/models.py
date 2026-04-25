import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, String, Text, UniqueConstraint, func, Boolean, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from geoalchemy2 import Geometry

from app.db.base import Base
from app.modules.places.enums import ExternalIdProvider


class Place(Base):
    __table_args__ = {"schema": "app"}
    __tablename__ = "places"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    address: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Canonical address fields — populated from the `canonical_source` provider
    # on ingest (see app/modules/places/ingest.py). Hand-entered places may have
    # all of these NULL until a provider is linked.
    city: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True, index=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Which external provider's data is authoritative for the canonical fields
    # above. NULL = hand-entered, no sync source. Enforced by CHECK constraint
    # ck_places_canonical_source_allowed (mirrors ExternalIdProvider enum).
    canonical_source: Mapped["ExternalIdProvider | None"] = mapped_column(
        Enum(
            ExternalIdProvider,
            name="canonical_source",
            native_enum=False,
            create_constraint=False,  # CHECK is managed by the migration
            validate_strings=True,
        ),
        nullable=True,
    )

    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)

    # SRID 4326 = WGS84 (standard GPS coordinates)
    geom: Mapped[object] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
        nullable=False,
    )

    # Link to External IDs Table
    external_ids = relationship(
        "PlaceExternalId",
        back_populates="place",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )

    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    deleted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Bumped automatically by SQLAlchemy on every UPDATE. We skip a matching
    # ``created_at`` because the CREATED audit row on ``place_events`` already
    # records ingest time with actor attribution — a column would duplicate
    # that without earning its keep. ``updated_at`` pulls its weight as the
    # default sort key on the admin places list ("most-recently touched
    # first") and as context on the detail page header.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        index=True,
    )

    events = relationship(
        "PlaceEvent",
        back_populates="place",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )


class PlaceExternalId(Base):
    __tablename__ = "place_external_ids"
    __table_args__ = (
        # One external id per provider across the whole system (e.g., GOOGLE place_id must be globally unique)
        UniqueConstraint("provider", "external_id", name="uq_place_external_provider_external"),
        # A place can have at most one id per provider
        UniqueConstraint("place_id", "provider", name="uq_place_external_place_provider"),
        # Helpful lookup indexes
        Index("ix_place_external_provider", "provider"),
        Index("ix_place_external_external_id", "external_id"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Use varchar for flexibility. You can add a check constraint later if you want strict providers.
    provider: Mapped[ExternalIdProvider] = mapped_column(
        Enum(
            ExternalIdProvider,
            name="external_id_provider",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        ),
        nullable=False
    )
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)

    # Full payload from the provider (e.g. Google Place Details response).
    # Updated on every re-sync — latest snapshot only. If we ever need history,
    # we can split this into a separate place_external_snapshots table.
    raw_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    @validates("provider")
    def _normalize_provider(self, key: str, value):
        """Normalize provider to canonical uppercase string/enum value."""
        if value is None:
            return value
        # Accept enum or string
        if isinstance(value, ExternalIdProvider):
            value = value.value
        return str(value).strip().upper()

    @validates("external_id")
    def _normalize_external_id(self, key: str, value):
        """Trim external id; keep exact casing for provider-specific IDs."""
        if value is None:
            return value
        return str(value).strip()

    place = relationship("Place", back_populates="external_ids")


class PlaceEvent(Base):
    __tablename__ = "place_events"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    place = relationship("Place", back_populates="events")