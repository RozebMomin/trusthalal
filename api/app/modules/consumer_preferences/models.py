"""SQLAlchemy model for consumer preferences.

One row per signed-in consumer; PK is the user_id. The row is
upserted on PUT — there's no separate INSERT vs UPDATE distinction
on the API surface because consumers don't need that nuance ("save
my prefs" should always work whether or not they exist yet).

All columns are nullable. Null encodes "no preference" — the search
endpoint treats null the same as a missing query param. Boolean
columns are tri-state (NULL = don't care, TRUE = require, FALSE =
explicitly opt out) so the round-trip from the wire stays
losslessly representable.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID as PyUUID

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ConsumerPreferences(Base):
    __tablename__ = "consumer_preferences"
    __table_args__ = {"schema": "app"}

    user_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    min_validation_tier: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )
    min_menu_posture: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )

    no_pork: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    no_alcohol_served: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True
    )
    has_certification: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True
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
