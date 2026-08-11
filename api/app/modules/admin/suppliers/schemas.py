"""Admin schemas for the supplier registry.

The registry is admin-curated: create suppliers + product lines, edit them,
revoke, and read the audit trail. Method lives on the product line, so most of
the interesting shape is ``SupplierProduct*``.
"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.halal_profiles.enums import MeatType
from app.modules.suppliers.enums import (
    SlaughterMethod,
    Stunning,
    SupplierEventType,
    SupplierTier,
)


# --- reads -----------------------------------------------------------------
class SupplierProductAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    meat_type: MeatType
    product_name: str
    slaughter_method: SlaughterMethod
    line_tier: SupplierTier
    stunning: Stunning | None = None
    certifying_body_name: str | None = None
    certificate_number: str | None = None
    certificate_url: str | None = None
    certificate_expires_at: datetime | None = None
    source_url: str | None = None
    notes: str | None = None
    last_verified_at: datetime
    evidence_expires_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SupplierAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    aliases: list[str] = Field(default_factory=list)
    website_url: str | None = None
    country_code: str | None = None
    region: str | None = None
    city: str | None = None
    verification_tier: SupplierTier
    certifying_body_name: str | None = None
    notes: str | None = None
    last_verified_at: datetime
    revoked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    # Populated by the list/detail endpoints (not a column).
    product_count: int = 0


class SupplierDetailRead(SupplierAdminRead):
    products: list[SupplierProductAdminRead] = Field(default_factory=list)


class SupplierEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_type: SupplierEventType
    actor_user_id: UUID | None = None
    description: str | None = None
    created_at: datetime


# --- writes ----------------------------------------------------------------
class SupplierProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    meat_type: MeatType
    product_name: str = Field(..., min_length=1, max_length=255)
    slaughter_method: SlaughterMethod = SlaughterMethod.NOT_DISCLOSED
    line_tier: SupplierTier = SupplierTier.LISTED
    stunning: Stunning | None = None
    certifying_body_name: str | None = Field(default=None, max_length=255)
    certificate_number: str | None = Field(default=None, max_length=255)
    certificate_url: str | None = None
    certificate_expires_at: datetime | None = None
    source_url: str | None = None
    notes: str | None = None


class SupplierProductPatch(BaseModel):
    """All optional — ``meat_type`` is intentionally immutable (a link
    denormalises it; changing it would silently mis-scope existing links)."""

    model_config = ConfigDict(extra="forbid")

    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    slaughter_method: SlaughterMethod | None = None
    line_tier: SupplierTier | None = None
    stunning: Stunning | None = None
    certifying_body_name: str | None = Field(default=None, max_length=255)
    certificate_number: str | None = Field(default=None, max_length=255)
    certificate_url: str | None = None
    certificate_expires_at: datetime | None = None
    source_url: str | None = None
    notes: str | None = None


class SupplierCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=120, pattern=r"^[a-z0-9][a-z0-9.-]*$")
    aliases: list[str] = Field(default_factory=list)
    website_url: str | None = None
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    region: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    verification_tier: SupplierTier = SupplierTier.LISTED
    certifying_body_name: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    products: list[SupplierProductCreate] = Field(default_factory=list)


class SupplierPatch(BaseModel):
    """Slug is immutable (it's the idempotency key for the seed loader)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    aliases: list[str] | None = None
    website_url: str | None = None
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    region: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    verification_tier: SupplierTier | None = None
    certifying_body_name: str | None = Field(default=None, max_length=255)
    notes: str | None = None


class SupplierRevokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, min_length=3, max_length=500)
