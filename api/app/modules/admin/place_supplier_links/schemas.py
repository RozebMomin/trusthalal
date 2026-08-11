"""Admin schemas for restaurant → supplier-product sourcing links."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.halal_profiles.enums import MeatType
from app.modules.suppliers.enums import (
    LinkSource,
    SlaughterMethod,
    SourcingEvidence,
    SupplierTier,
)


class PlaceSupplierLinkAdminRead(BaseModel):
    """A sourcing link with its supplier/product context flattened in."""

    model_config = ConfigDict(from_attributes=False)

    id: UUID
    place_id: UUID
    supplier_product_id: UUID
    meat_type: MeatType
    evidence_tier: SourcingEvidence
    source: LinkSource
    note: str | None = None
    last_confirmed_at: datetime
    expires_at: datetime | None = None
    ended_at: datetime | None = None
    created_at: datetime

    # Flattened supplier/product context (so the admin UI needn't re-fetch).
    supplier_id: UUID
    supplier_name: str
    supplier_revoked: bool
    product_name: str
    slaughter_method: SlaughterMethod
    line_tier: SupplierTier


class PlaceSupplierLinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supplier_product_id: UUID
    evidence_tier: SourcingEvidence = SourcingEvidence.OWNER_STATED
    note: str | None = Field(default=None, max_length=500)


class PlaceSupplierLinkPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_tier: SourcingEvidence | None = None
    note: str | None = Field(default=None, max_length=500)
