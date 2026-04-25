from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base
from app.modules.ownership_requests.enums import OwnershipRequestStatus  # adjust import path


class PlaceOwnershipRequest(Base):
    __tablename__ = "place_ownership_requests"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    requester_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,  # optional but useful
    )

    contact_name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        server_default=text(f"'{OwnershipRequestStatus.SUBMITTED}'"),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        index=True,  # optional index (ticket says optional—keeping it because it helps admin queues)
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=func.now(),
    )

    # Optional relationships (safe to add now or later)
    place = relationship("Place", lazy="selectin")
    requester_user = relationship("User", lazy="selectin")