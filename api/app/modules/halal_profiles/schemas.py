"""Pydantic schemas for halal profiles.

The public-read shape (``HalalProfileRead``) is what consumer
frontends embed in place detail pages. It collapses validation tier +
menu posture + per-meat data into one structured response that the UI
can render as trust labels + expandable details.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.halal_profiles.enums import (
    AlcoholPolicy,
    HalalProfileDisputeState,
    HalalProfileEventType,
    MenuPosture,
    SlaughterMethod,
    ValidationTier,
)


class HalalProfileRead(BaseModel):
    """Public read shape — what consumer frontends render.

    Every field is the current truth. The ``last_verified_at`` and
    ``expires_at`` give the consumer a sense of freshness. The
    ``dispute_state`` lets the UI surface a "conflicting reports"
    badge when relevant.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    place_id: UUID

    # --- validation + menu structure -----------------------------------
    validation_tier: ValidationTier
    menu_posture: MenuPosture
    has_pork: bool
    alcohol_policy: AlcoholPolicy
    alcohol_in_cooking: bool

    # --- per-meat ------------------------------------------------------
    chicken_slaughter: SlaughterMethod
    beef_slaughter: SlaughterMethod
    lamb_slaughter: SlaughterMethod
    goat_slaughter: SlaughterMethod
    seafood_only: bool

    # --- certification ------------------------------------------------
    has_certification: bool
    certifying_body_name: Optional[str]
    certificate_expires_at: Optional[datetime]

    # --- caveats + freshness ------------------------------------------
    caveats: Optional[str]
    dispute_state: HalalProfileDisputeState

    last_verified_at: datetime
    expires_at: Optional[datetime]
    revoked_at: Optional[datetime]

    updated_at: datetime


class HalalProfileEventRead(BaseModel):
    """Audit-event read shape. Admin-side only for now."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    profile_id: UUID
    event_type: HalalProfileEventType
    actor_user_id: Optional[UUID]
    related_claim_id: Optional[UUID]
    related_dispute_id: Optional[UUID]
    description: Optional[str]
    created_at: datetime
