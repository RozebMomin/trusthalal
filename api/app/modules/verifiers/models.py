"""SQLAlchemy models for the verifier (community moderator) system.

Three tables:

* ``verifier_applications`` — apply form rows. Public POST endpoint.
* ``verifier_profiles`` — sidecar to ``users`` for verifiers. Carries
  bio, social links, public-handle, status. Created when admin
  approves an application or directly invites a verifier.
* ``verification_visits`` — site-visit records. Each visit captures
  the verifier's findings + disclosure. Reviewed by admin; on
  ACCEPTED, may promote the place's validation_tier.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
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
from app.modules.verifiers.enums import (
    VerificationVisitStatus,
    VerifierApplicationStatus,
    VerifierProfileStatus,
    VisitDisclosure,
)


class VerifierApplication(Base):
    """Public application to become a verifier.

    Anyone can submit (hence ``applicant_user_id`` is nullable — an
    application can come from someone without an account, who'll be
    invited if approved). When a logged-in user applies, their id is
    captured for context.
    """

    __tablename__ = "verifier_applications"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    applicant_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Required even when applicant_user_id is set, since applicants
    # may be applying with a different "verifier identity" email
    # than their consumer account email.
    applicant_email: Mapped[str] = mapped_column(String(320), nullable=False)
    applicant_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Free-form fields. Admin reads these to vet.
    motivation: Mapped[str] = mapped_column(Text, nullable=False)
    background: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Social handles as a flexible blob — Instagram, TikTok, YouTube,
    # personal website, etc. Shape:
    #   {"instagram": "@halalfoodfinder", "tiktok": "@...", ...}
    social_links: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )

    # --- workflow + decision ---------------------------------------------
    status: Mapped[str] = mapped_column(
        sa.Enum(
            VerifierApplicationStatus,
            name="verifier_application_status",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{VerifierApplicationStatus.PENDING.value}'"),
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
    decision_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # When admin approves and converts to a verifier, the resulting
    # verifier_profile.id is captured here so we have provenance.
    resulting_verifier_profile_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.verifier_profiles.user_id", ondelete="SET NULL"),
        nullable=True,
    )

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


class VerifierProfile(Base):
    """A user's verifier identity.

    Sidecar to ``users``: a verifier IS a user (with role=VERIFIER),
    and this table extends the User row with verifier-specific
    fields. Primary key = user_id keeps the 1:1 relationship explicit
    at the DB level.

    ``is_public`` controls whether the verifier's identity is shown
    on consumer-facing surfaces. Default false so a new verifier can
    opt in deliberately.
    """

    __tablename__ = "verifier_profiles"
    __table_args__ = {"schema": "app"}

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # URL slug for the public profile (when is_public=true). Unique
    # across the verifier population so /verifier/<handle> is
    # addressable.
    public_handle: Mapped[Optional[str]] = mapped_column(
        String(80), nullable=True, unique=True
    )

    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    social_links: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )

    is_public: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    status: Mapped[str] = mapped_column(
        sa.Enum(
            VerifierProfileStatus,
            name="verifier_profile_status",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{VerifierProfileStatus.ACTIVE.value}'"),
    )

    joined_as_verifier_at: Mapped[datetime] = mapped_column(
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

    visits: Mapped[list["VerificationVisit"]] = relationship(
        back_populates="verifier",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class VerificationVisit(Base):
    """Site-visit record submitted by a verifier.

    Findings shape mirrors the owner's questionnaire so admin review
    can compare them side-by-side. Disclosure field captures
    compensation context (self-funded / comped / paid partnership).
    """

    __tablename__ = "verification_visits"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    verifier_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.verifier_profiles.user_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # --- visit content --------------------------------------------------
    visited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # Same questionnaire shape as the owner submits (validated as
    # HalalQuestionnaireResponse at the Pydantic layer). Enables
    # side-by-side comparison in admin review.
    structured_findings: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )

    notes_for_admin: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Optional public link to the verifier's published review
    # (Instagram post, blog post, video). Surfaces alongside the
    # verification on consumer pages when verifier.is_public.
    public_review_url: Mapped[Optional[str]] = mapped_column(
        String(2048), nullable=True
    )

    # --- disclosure -----------------------------------------------------
    disclosure: Mapped[str] = mapped_column(
        sa.Enum(
            VisitDisclosure,
            name="verification_visit_disclosure",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{VisitDisclosure.SELF_FUNDED.value}'"),
    )
    disclosure_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- workflow + decision -------------------------------------------
    status: Mapped[str] = mapped_column(
        sa.Enum(
            VerificationVisitStatus,
            name="verification_visit_status",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{VerificationVisitStatus.SUBMITTED.value}'"),
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
    decision_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

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
    verifier: Mapped["VerifierProfile"] = relationship(back_populates="visits")
    attachments: Mapped[list["VerificationVisitAttachment"]] = relationship(
        back_populates="visit",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="VerificationVisitAttachment.uploaded_at",
    )


class VerificationVisitAttachment(Base):
    """Photos a verifier attaches to a site visit (menu, certificate
    on the wall, kitchen if visible)."""

    __tablename__ = "verification_visit_attachments"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    visit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.verification_visits.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    storage_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    caption: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    visit: Mapped["VerificationVisit"] = relationship(
        back_populates="attachments"
    )
