from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.organizations.enums import OrganizationStatus


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)

    # Verification workflow status. New owner-self-service rows start
    # at DRAFT; admin-created rows start at VERIFIED. Migration
    # ``f1a3b8d6c2e9`` backfilled existing rows to VERIFIED.
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        server_default=text(f"'{OrganizationStatus.DRAFT.value}'"),
    )

    # Set when DRAFT → UNDER_REVIEW. Useful for admin queue triage
    # ("longest-waiting at the top").
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Who started this org. Null for legacy admin-created rows. ON
    # DELETE SET NULL so a user delete doesn't take their orgs with
    # them — orgs are business entities, not personal possessions.
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Inline decision-audit fields for the verify/reject workflow.
    # See migration b5c8e2a9d4f7 for the rationale (vs. a full
    # events table). decided_* are set on UNDER_REVIEW → VERIFIED/
    # REJECTED transitions; null otherwise. decision_note is
    # required by the server on REJECTED, optional on VERIFIED.
    decided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    decision_note: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
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

    # Convenience relationships
    place_links: Mapped[list["PlaceOwner"]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    members: Mapped[list["OrganizationMember"]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    attachments: Mapped[list["OrganizationAttachment"]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="OrganizationAttachment.uploaded_at",
    )


class PlaceOwner(Base):
    """
    Join table: which organization owns which place.
    Keep this here (org domain) — it doesn't need its own module yet.
    """
    __tablename__ = "place_owners"
    __table_args__ = (
        UniqueConstraint("place_id", "organization_id", name="uq_place_owner_place_org"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Keep as strings for now (fast, flexible). Defaults should match DB constraints and indexes.
    role: Mapped[str] = mapped_column(String(50), nullable=False, server_default=text("'PRIMARY'"))
    status: Mapped[str] = mapped_column(String(50), nullable=False, server_default=text("'PENDING'"))

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

    organization: Mapped["Organization"] = relationship(back_populates="place_links")


class OrganizationMember(Base):
    __tablename__ = "organization_members"
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_org_member_org_user"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    role: Mapped[str] = mapped_column(String(50), nullable=False, server_default=text("'OWNER_ADMIN'"))
    status: Mapped[str] = mapped_column(String(50), nullable=False, server_default=text("'ACTIVE'"))

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

    organization: Mapped["Organization"] = relationship(back_populates="members")
    # User relationship back-population can be added later if needed
    user: Mapped["User"] = relationship("User", lazy="selectin")


class OrganizationAttachment(Base):
    """Owner-uploaded supporting document attached to an Organization.

    Mirror of OwnershipRequestAttachment: bytes live in object storage
    (Supabase for v1, see ``app/core/storage.py``), this row holds the
    metadata. Powers the org review queue admin staff uses to verify
    legitimacy — articles of organization, business filings, EIN
    letters, etc.

    Write-once: re-uploading is "add a new row" rather than "edit an
    existing one." Keeps the audit trail honest.
    """

    __tablename__ = "organization_attachments"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.organizations.id", ondelete="CASCADE"),
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

    organization: Mapped["Organization"] = relationship(
        back_populates="attachments"
    )