"""SQLAlchemy models for consumer disputes.

A ``ConsumerDispute`` is a signed-in consumer's report that a place's
halal profile is wrong. Required to be authenticated (no anonymous
disputes — keeps reporters accountable). Owner sees a redacted
summary; admin sees full reporter identity.

Workflow lives on the ``status`` column. A successful dispute can
trigger an audit event on the affected ``halal_profile`` and may
prompt a RECONCILIATION halal_claim from the owner.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

import sqlalchemy as sa
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.disputes.enums import DisputeStatus, DisputedAttribute


class ConsumerDispute(Base):
    """A consumer's report that a place's halal profile is wrong."""

    __tablename__ = "consumer_disputes"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The consumer who filed it. CASCADE on user delete is debatable
    # — we picked SET NULL so deleted accounts don't take their
    # disputes with them. The dispute record stays for audit; the
    # reporter just becomes anonymous.
    reporter_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # --- workflow ---------------------------------------------------------
    status: Mapped[str] = mapped_column(
        sa.Enum(
            DisputeStatus,
            name="consumer_dispute_status",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{DisputeStatus.OPEN.value}'"),
    )

    disputed_attribute: Mapped[str] = mapped_column(
        sa.Enum(
            DisputedAttribute,
            name="consumer_disputed_attribute",
            native_enum=False,
            length=50,
        ),
        nullable=False,
    )

    # Consumer's words explaining what they observed. Capped at a
    # generous length to discourage abuse but allow real context.
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # --- linkage to the halal_profile being contested -------------------
    # When the dispute is filed, this captures which profile snapshot
    # the consumer was disputing. If the profile is later updated,
    # we still know which version they were complaining about.
    contested_profile_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.halal_profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # --- decision audit -------------------------------------------------
    decided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    admin_decision_note: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )

    # --- timestamps -----------------------------------------------------
    submitted_at: Mapped[datetime] = mapped_column(
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

    # --- relationships --------------------------------------------------
    attachments: Mapped[list["ConsumerDisputeAttachment"]] = relationship(
        back_populates="dispute",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="ConsumerDisputeAttachment.uploaded_at",
    )


class ConsumerDisputeAttachment(Base):
    """Photo/receipt evidence the consumer attaches to a dispute.

    Same storage pattern as the other attachment tables. Limited to
    photos + PDFs (receipts) — no general document allow-list,
    since the consumer is uploading evidence of a specific incident.
    """

    __tablename__ = "consumer_dispute_attachments"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    dispute_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.consumer_disputes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    storage_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    dispute: Mapped["ConsumerDispute"] = relationship(
        back_populates="attachments"
    )
