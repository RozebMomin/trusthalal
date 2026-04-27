from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func, text
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

    # The organization on whose behalf the claim is being made. New
    # owner-portal claims require this; legacy / admin-created rows
    # may carry NULL until admin approval reassigns. SET NULL on
    # org delete preserves the claim as audit context.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
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
    organization = relationship("Organization", lazy="selectin")
    attachments = relationship(
        "OwnershipRequestAttachment",
        back_populates="request",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="OwnershipRequestAttachment.uploaded_at",
    )


class OwnershipRequestAttachment(Base):
    """File metadata for owner-uploaded evidence on an ownership claim.

    The bytes live in object storage (Supabase Storage in v1, see
    ``app/core/storage.py``). This row is the index — it points at a
    blob by ``storage_path`` and remembers what the owner originally
    called the file so admin staff has context when reviewing.

    Write-once on purpose: if an owner uploads the wrong file, the
    fix is to upload a new one and let admin see both. Editing in
    place would muddy the audit trail.
    """

    __tablename__ = "ownership_request_attachments"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "app.place_ownership_requests.id", ondelete="CASCADE"
        ),
        nullable=False,
        index=True,
    )

    storage_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(
        String(512), nullable=False
    )
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    request = relationship(
        "PlaceOwnershipRequest", back_populates="attachments"
    )