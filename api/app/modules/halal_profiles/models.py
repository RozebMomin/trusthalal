"""SQLAlchemy models for halal profiles.

A ``HalalProfile`` is the consumer-facing snapshot of a place's halal
posture. Exactly one row per place (when one exists at all). Updated
by the profile-derivation service when a halal_claim is approved.

Why a denormalized snapshot instead of joining through claims at
read-time?

  * Consumer search is hot — filtering by menu_posture / slaughter /
    validation_tier needs to hit indexed columns, not JSONB.
  * Consumers don't care about the workflow (DRAFT, PENDING_REVIEW);
    they want the current truth. The profile is that truth.
  * The audit trail lives in halal_profile_event so we don't lose
    history when the profile is rewritten by a new approved claim.

The profile carries a ``source_claim_id`` foreign key so the
provenance of every field is one join away when admin or consumer
needs it.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
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
from app.modules.halal_profiles.enums import (
    AlcoholPolicy,
    HalalProfileDisputeState,
    HalalProfileEventType,
    MenuPosture,
    SlaughterMethod,
    ValidationTier,
)


class HalalProfile(Base):
    """The current halal-truth snapshot for a place.

    1:1 with Place when one exists. Created on first APPROVED claim,
    updated on subsequent approvals, marked DISPUTED on confirmed
    disputes, soft-deleted on REVOKED.
    """

    __tablename__ = "halal_profiles"
    __table_args__ = (
        UniqueConstraint("place_id", name="uq_halal_profile_place"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Provenance. Points at the APPROVED claim that produced this
    # snapshot. Updated whenever the profile is rewritten.
    source_claim_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.halal_claims.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # --- validation tier (admin-assigned at approval time) ---------------
    validation_tier: Mapped[str] = mapped_column(
        sa.Enum(
            ValidationTier,
            name="halal_validation_tier",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{ValidationTier.SELF_ATTESTED.value}'"),
    )

    # --- menu structure & alcohol ----------------------------------------
    menu_posture: Mapped[str] = mapped_column(
        sa.Enum(
            MenuPosture,
            name="halal_menu_posture",
            native_enum=False,
            length=50,
        ),
        nullable=False,
    )
    has_pork: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    alcohol_policy: Mapped[str] = mapped_column(
        sa.Enum(
            AlcoholPolicy,
            name="halal_alcohol_policy",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{AlcoholPolicy.NONE.value}'"),
    )
    alcohol_in_cooking: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    # --- per-meat slaughter ---------------------------------------------
    # Stored as columns rather than JSONB because consumer search
    # filters on these. NOT_SERVED is a valid value (means the
    # restaurant doesn't carry this protein).
    chicken_slaughter: Mapped[str] = mapped_column(
        sa.Enum(
            SlaughterMethod,
            name="halal_slaughter_method",
            native_enum=False,
            length=50,
            # Reuse same enum type for all meat columns.
            create_constraint=True,
        ),
        nullable=False,
        server_default=text(f"'{SlaughterMethod.NOT_SERVED.value}'"),
    )
    beef_slaughter: Mapped[str] = mapped_column(
        sa.Enum(
            SlaughterMethod,
            name="halal_slaughter_method",
            native_enum=False,
            length=50,
            create_constraint=False,  # type already created above
        ),
        nullable=False,
        server_default=text(f"'{SlaughterMethod.NOT_SERVED.value}'"),
    )
    lamb_slaughter: Mapped[str] = mapped_column(
        sa.Enum(
            SlaughterMethod,
            name="halal_slaughter_method",
            native_enum=False,
            length=50,
            create_constraint=False,
        ),
        nullable=False,
        server_default=text(f"'{SlaughterMethod.NOT_SERVED.value}'"),
    )
    goat_slaughter: Mapped[str] = mapped_column(
        sa.Enum(
            SlaughterMethod,
            name="halal_slaughter_method",
            native_enum=False,
            length=50,
            create_constraint=False,
        ),
        nullable=False,
        server_default=text(f"'{SlaughterMethod.NOT_SERVED.value}'"),
    )
    seafood_only: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    # --- certification context ------------------------------------------
    has_certification: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    certifying_body_name: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    certificate_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --- caveats + dispute state ----------------------------------------
    caveats: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    dispute_state: Mapped[str] = mapped_column(
        sa.Enum(
            HalalProfileDisputeState,
            name="halal_profile_dispute_state",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{HalalProfileDisputeState.NONE.value}'"),
    )

    # --- timestamps -----------------------------------------------------
    last_verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
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

    # --- relationships --------------------------------------------------
    events: Mapped[list["HalalProfileEvent"]] = relationship(
        back_populates="profile",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="HalalProfileEvent.created_at.desc()",
    )


class HalalProfileEvent(Base):
    """Audit trail for a place's halal profile.

    Every state change (creation, update, dispute, revoke, expire)
    writes a row here. Captures the actor, the event type, and a
    free-form ``description`` that summarizes what changed.

    The ``before`` / ``after`` JSONB columns are intentionally simple
    — they hold the changed fields' old + new values so admin can
    answer "what flipped?" without diffing two snapshots.
    """

    __tablename__ = "halal_profile_events"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.halal_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    event_type: Mapped[str] = mapped_column(
        sa.Enum(
            HalalProfileEventType,
            name="halal_profile_event_type",
            native_enum=False,
            length=50,
        ),
        nullable=False,
    )

    # Who triggered it. Null for system-driven events (expiry job).
    actor_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Pointer to the claim or dispute that caused this event, when
    # applicable. Both nullable — system events don't have either.
    related_claim_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.halal_claims.id", ondelete="SET NULL"),
        nullable=True,
    )
    related_dispute_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.consumer_disputes.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Human-readable summary. e.g. "alcohol_policy: NONE → BEER_AND_WINE_ONLY".
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    profile: Mapped["HalalProfile"] = relationship(back_populates="events")
