"""SQLAlchemy models for the certifier registry.

Three tables:
  * ``certifiers`` — one canonical row per certifying body. ``legal_entity`` is
    distinct from ``name`` on purpose: HMS and Crescent's "Shar'i Zabihah
    Committee" are two program names of ONE legal entity (Rahmat-e-Alam
    Foundation). Any independence/corroboration logic must group on
    ``legal_entity``, never ``name``.
  * ``certifier_aliases`` — trading names, program names, and common
    misspellings → one certifier. This is how a restaurant's free-text
    "IFANCA" / "ISA / ISNA" / "Shariah Board of America" resolves to a canonical
    entry, and how "IFANCA" (US) stops colliding with "IFANCC" (Canada).
  * ``certifier_adverse_events`` — convictions / sanctions / de-listings.
    Admin-only context; gives ISA's federal conviction a home.

House idioms: UUID PKs with ``gen_random_uuid()`` server default,
``schema="app"``, ``sa.Enum(..., native_enum=False, length=N)`` (VARCHAR +
CHECK), ``server_default=func.now()`` / ``onupdate=func.now()`` on timestamps.
Purely additive — nothing reads these yet.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

import sqlalchemy as sa
from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.certifiers.enums import CertifierAdverseEventType


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


class Certifier(Base):
    """A canonical certifying body (e.g. IFANCA, HFSAA). Admin-curated."""

    __tablename__ = "certifiers"
    __table_args__ = ({"schema": "app"},)

    id: Mapped[uuid.UUID] = _uuid_pk()
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Group independence/corroboration on this, NEVER on name. See module docstring.
    legal_entity: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    country_code: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    aliases: Mapped[list["CertifierAlias"]] = relationship(
        back_populates="certifier",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    adverse_events: Mapped[list["CertifierAdverseEvent"]] = relationship(
        back_populates="certifier",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class CertifierAlias(Base):
    """Trading/program names + misspellings → one certifier. Unique so the same
    string can't map to two bodies."""

    __tablename__ = "certifier_aliases"
    __table_args__ = (
        UniqueConstraint("alias", name="uq_certifier_alias"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    certifier_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.certifiers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    alias: Mapped[str] = mapped_column(String(255), nullable=False)

    certifier: Mapped["Certifier"] = relationship(back_populates="aliases")


class CertifierAdverseEvent(Base):
    """Convictions / sanctions / de-listings. Admin-only context."""

    __tablename__ = "certifier_adverse_events"
    __table_args__ = ({"schema": "app"},)

    id: Mapped[uuid.UUID] = _uuid_pk()
    certifier_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.certifiers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(
        sa.Enum(
            CertifierAdverseEventType,
            name="certifier_adverse_event_type",
            native_enum=False,
            length=30,
        ),
        nullable=False,
    )
    occurred_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    certifier: Mapped["Certifier"] = relationship(back_populates="adverse_events")
