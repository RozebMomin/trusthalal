"""Public read schemas for the supplier registry.

Minimal, safe-to-expose fields for the owner claim editor's supplier picker and
(later) consumer surfaces. Confidence tiers and evidence live on the internal
admin schemas; the public view is just "who and what method," which is public
information anyway.
"""
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.modules.halal_profiles.enums import MeatType
from app.modules.suppliers.enums import SlaughterMethod


class SupplierProductPublicRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    meat_type: MeatType
    product_name: str
    slaughter_method: SlaughterMethod


class SupplierPublicRead(BaseModel):
    model_config = ConfigDict(from_attributes=False)

    id: UUID
    name: str
    slug: str
    city: str | None = None
    region: str | None = None
    country_code: str | None = None
    certifying_body_name: str | None = None
    products: list[SupplierProductPublicRead] = []
