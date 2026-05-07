"""SQLAlchemy models for halal claims.

A ``HalalClaim`` represents the workflow shell — the thing that goes
through DRAFT → PENDING_REVIEW → APPROVED. The actual halal answers
(menu posture, slaughter methods, etc.) live in ``structured_response``
as JSONB. We keep them as JSON rather than as discrete columns for
two reasons:

1. The questionnaire will evolve; adding a column for every new
   question is a migration treadmill we'd rather not run on a
   live product.
2. The shape is well-typed at the Pydantic layer (see
   ``halal_claims/schemas.py:HalalQuestionnaireResponse``), so reads
   downstream get type safety even without column-level constraints.

The TYPED snapshot — what consumers actually see — is derived into
``halal_profile`` (a separate table) when a claim is approved. That
gives us flat columns for fast filtering ("show me places that are
zabihah-only") without paying a JSONB query tax on every search.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

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
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.halal_claims.enums import (
    HalalClaimAttachmentType,
    HalalClaimEventType,
    HalalClaimStatus,
    HalalClaimType,
)


class HalalClaim(Base):
    """A halal-claim submission.

    Owner submits → admin reviews → on approval, profile flips. Many
    claims per place over time; only one is "current" (APPROVED and
    not SUPERSEDED). Audit trail survives forever.
    """

    __tablename__ = "halal_claims"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # --- relationships ----------------------------------------------------
    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The owner who submitted the claim. SET NULL on user delete so
    # the claim history survives even if the user account is gone —
    # we still want the audit trail showing what was claimed when.
    submitted_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # The sponsoring organization at submission time. Owners must
    # claim through a verified org (same gate as ownership_requests).
    organization_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # When this is a RECONCILIATION claim, points at the dispute
    # that triggered it so admin review can correlate them.
    triggered_by_dispute_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        # Forward reference — the consumer_disputes table is created
        # in the same migration so this FK works at table-creation
        # time. ondelete=SET NULL because deleting a dispute (rare,
        # admin-only) shouldn't cascade-kill the claim that resulted.
        ForeignKey("app.consumer_disputes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # --- workflow ---------------------------------------------------------
    claim_type: Mapped[str] = mapped_column(
        sa.Enum(
            HalalClaimType,
            name="halal_claim_type",
            native_enum=False,
            length=50,
        ),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        sa.Enum(
            HalalClaimStatus,
            name="halal_claim_status",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{HalalClaimStatus.DRAFT.value}'"),
    )

    # The questionnaire answers. Validated as
    # ``HalalQuestionnaireResponse`` at the Pydantic layer; stored as
    # JSONB so we can evolve the questionnaire shape without
    # migrations. Required at PENDING_REVIEW; can be partial in
    # DRAFT.
    structured_response: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )

    # --- timestamps + decision audit -------------------------------------
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Admin's reason for the decision. Required on REJECT and
    # NEEDS_MORE_INFO; optional on APPROVE.
    decision_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Admin-only context — never shipped to the owner.
    internal_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # When the resulting profile should expire if no renewal lands.
    # Set on approval. Defaults to 90 days (Trust Halal company
    # policy); admin can pull the date in for shorter cert
    # lifetimes but the derivation service clamps anything past
    # the 90-day cap.
    expires_at: Mapped[Optional[datetime]] = mapped_column(
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

    # --- relationships ---------------------------------------------------
    attachments: Mapped[list["HalalClaimAttachment"]] = relationship(
        back_populates="claim",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="HalalClaimAttachment.uploaded_at",
    )

    # Audit timeline. Loaded only when explicitly requested (default
    # ``select`` lazy strategy) — list-page reads of MyHalalClaimRead
    # don't carry events; the per-claim detail surface fetches them
    # via a dedicated /events endpoint instead.
    events: Mapped[list["HalalClaimEvent"]] = relationship(
        back_populates="claim",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="HalalClaimEvent.created_at",
    )

    # Read-side relationships for embedding place + org summaries in
    # the response shape. ``lazy="joined"`` means the LEFT JOIN runs
    # alongside the claim fetch — one query per list view rather than
    # N+1.
    place = relationship(
        "Place",
        lazy="joined",
        viewonly=True,
    )
    organization = relationship(
        "Organization",
        lazy="joined",
        viewonly=True,
    )


class HalalClaimAttachment(Base):
    """Owner-uploaded evidence supporting a halal claim.

    Bytes live in Supabase Storage at
    ``halal-claims/<claim_id>/<uuid>.<ext>``. This row holds the
    metadata + a typed pointer (HALAL_CERTIFICATE vs INVOICE vs ...)
    so admin review can group documents in the UI.

    Halal certificates carry extra fields (issuing_authority,
    certificate_number, valid_until) that admin staff actually verify
    against. Other document types leave those NULL.
    """

    __tablename__ = "halal_claim_attachments"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.halal_claims.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    document_type: Mapped[str] = mapped_column(
        sa.Enum(
            HalalClaimAttachmentType,
            name="halal_claim_attachment_type",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{HalalClaimAttachmentType.OTHER.value}'"),
    )

    # Free-form text — nullable for non-certificate documents.
    issuing_authority: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    certificate_number: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    valid_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Storage metadata — same shape as OwnershipRequestAttachment.
    storage_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    claim: Mapped["HalalClaim"] = relationship(back_populates="attachments")


class HalalClaimEvent(Base):
    """One row per meaningful state transition on a halal claim.

    The audit pattern lives across the codebase (place_events,
    halal_profile_events, etc.) — same shape: claim FK, event-type
    enum mirrored as a CHECK in the migration, nullable
    actor_user_id (system events have no actor), free-text
    description for the human-readable bit.

    For decision events (approve / reject / request-info / revoke),
    the description carries the owner-visible decision_note verbatim
    so the timeline stays meaningful even after a later transition
    overwrites the claim's ``decision_note`` column.
    """

    __tablename__ = "halal_claim_events"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.halal_claims.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    event_type: Mapped[str] = mapped_column(
        sa.Enum(
            HalalClaimEventType,
            name="halal_claim_event_type",
            native_enum=False,
            length=50,
        ),
        nullable=False,
    )

    actor_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    claim: Mapped["HalalClaim"] = relationship(back_populates="events")
