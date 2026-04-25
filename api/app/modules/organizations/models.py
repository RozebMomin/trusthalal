from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)

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