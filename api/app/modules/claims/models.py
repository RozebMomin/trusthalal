from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.claims.enums import ClaimEventType, ClaimScope, ClaimStatus, ClaimType


class HalalClaim(Base):
    __tablename__ = "halal_claims"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Canonical enums stored as VARCHAR + CHECK (native_enum=False) so we can evolve safely via migrations.
    claim_type: Mapped[ClaimType] = mapped_column(
        sa.Enum(ClaimType, name="claim_type", native_enum=False, length=50),
        nullable=False,
    )
    scope: Mapped[ClaimScope] = mapped_column(
        sa.Enum(ClaimScope, name="claim_scope", native_enum=False, length=50),
        nullable=False,
        server_default=sa.text("'ALL_MENU'"),
    )
    status: Mapped[ClaimStatus] = mapped_column(
        sa.Enum(ClaimStatus, name="claim_status", native_enum=False, length=50),
        nullable=False,
        server_default=sa.text("'PENDING'"),
    )

    # ✅ expiry field (ticket requirement)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # relationships (optional)
    evidence_items: Mapped[list["Evidence"]] = relationship(
        back_populates="claim", cascade="all, delete-orphan", passive_deletes=True
    )
    events: Mapped[list["ClaimEvent"]] = relationship(
        back_populates="claim", cascade="all, delete-orphan", passive_deletes=True
    )


class Evidence(Base):
    __tablename__ = "evidence"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.halal_claims.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    evidence_type: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. certificate, menu_photo, supplier_letter
    uri: Mapped[str] = mapped_column(String(1024), nullable=False)          # storage key / URL (bucket later)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    claim: Mapped["HalalClaim"] = relationship(back_populates="evidence_items")


class ClaimEvent(Base):
    __tablename__ = "claim_events"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.halal_claims.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Same VARCHAR + CHECK pattern as HalalClaim.{claim_type,scope,status} —
    # lets us evolve the enum by editing a CHECK constraint instead of
    # running ALTER TYPE migrations on a native Postgres enum.
    event_type: Mapped[ClaimEventType] = mapped_column(
        sa.Enum(ClaimEventType, name="claim_event_type", native_enum=False, length=50),
        nullable=False,
    )
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

    claim: Mapped["HalalClaim"] = relationship(back_populates="events")