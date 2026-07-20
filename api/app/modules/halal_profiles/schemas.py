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


class MeatProductRead(BaseModel):
    """One product the restaurant serves, with where it came from.

    ## Why this exists

    The per-meat columns on the profile (``chicken_slaughter`` and friends)
    are a rollup, and the rollup is deliberately least-conservative-wins: a
    kitchen with zabihah chicken breast and machine-slaughtered nuggets
    reports MACHINE for all chicken. That's the safe direction to round, but
    it leaves a diner unable to see which product is which — and in the other
    direction, a bare "Chicken · Zabihah" asks to be taken on faith, which is
    the opposite of what this platform is for.

    This is the same data the owner already filled in on the claim, projected
    for public reading.

    ## What is deliberately NOT here

    ``certificate_number`` from the owner's questionnaire. A cert or batch
    number is traceability detail for staff resolving a dispute, not
    something a diner needs, and publishing it hands anyone the string needed
    to impersonate the restaurant's paperwork to a certifier.

    ## What the client must not do with this

    Every field here is the OWNER'S account of their own supply chain. It is
    not verified unless a Trust Halal verifier visited, and visits record
    observations as free text — so there is no structured link saying "we
    confirmed this supplier". Rendering ``supplier_name`` as a bare fact
    turns the restaurant's claim into something that looks like our finding.
    Attribute it on its face.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    meat_type: str
    product_name: str
    slaughter_method: SlaughterMethod
    supplier_name: Optional[str] = None
    supplier_city: Optional[str] = None
    supplier_state: Optional[str] = None
    certifying_authority: Optional[str] = None


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
    # Public URL of the halal certificate document (None when no cert
    # is on file or the copy step failed). Stable per source claim:
    # path is keyed by the profile id so a renewal approval rewrites
    # the same path with the new cert.
    certificate_url: Optional[str] = None
    # MIME type drives the consumer-side viewer choice (img / iframe /
    # download link). None when ``certificate_url`` is None.
    certificate_content_type: Optional[str] = None

    # --- caveats + freshness ------------------------------------------
    caveats: Optional[str]
    dispute_state: HalalProfileDisputeState

    last_verified_at: datetime
    expires_at: Optional[datetime]
    revoked_at: Optional[datetime]

    updated_at: datetime

    # --- per-product sourcing ------------------------------------------
    # Three-state on purpose:
    #   None — this surface didn't load it. Search results don't, because
    #          resolving products means a join per place and the card only
    #          renders the rollup anyway.
    #   []   — loaded, and the restaurant genuinely listed no products.
    #   [..] — loaded.
    # A plain default of ``[]`` would make those first two cases identical,
    # and a client would render "no products listed" on every search card.
    meat_products: Optional[list[MeatProductRead]] = None


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
