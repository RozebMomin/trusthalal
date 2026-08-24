"""SQLAlchemy models for the supplier registry + sourcing links.

See docs/2026-08-11-supplier-provenance-plan.md. Additive: these tables are
new and touch nothing in the existing halal-claim / profile / tier stack. The
slaughter fact lives on ``SupplierProduct`` (per line), a restaurant attaches
to a line via ``PlaceSupplierLink`` (with its own evidence tier), and a later
composition step surfaces the *weaker* of the two, dated.

Columns follow the house idioms: ``sa.Enum(..., native_enum=False, length=50)``
(the migration realises these as ``VARCHAR(50)`` + a CHECK), UUID PKs with a
``gen_random_uuid()`` server default, ``schema="app"``.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

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
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.halal_profiles.enums import MeatType
from app.modules.suppliers.enums import (
    LinkSource,
    SlaughterMethod,
    SourcingEvidence,
    Stunning,
    SupplierAttachmentType,
    SupplierEventType,
    SupplierTier,
    ZabihahStatus,
)


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


class Supplier(Base):
    """A producer / slaughterhouse (e.g. Crescent Foods). Admin-curated.

    Identity + a *company-level* confidence ceiling. The method itself is on
    the product lines — one company's chicken and beef can differ.
    """

    __tablename__ = "suppliers"
    __table_args__ = ({"schema": "app"},)

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    aliases: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("ARRAY[]::text[]")
    )
    website_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    country_code: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    region: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    # Company-level vetting ceiling — a product line can never compose above it.
    verification_tier: Mapped[str] = mapped_column(
        sa.Enum(
            SupplierTier,
            name="supplier_verification_tier",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{SupplierTier.LISTED.value}'"),
    )
    certifying_body_name: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    last_verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    products: Mapped[list["SupplierProduct"]] = relationship(
        back_populates="supplier",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    attachments: Mapped[list["SupplierAttachment"]] = relationship(
        back_populates="supplier",
        cascade="all, delete-orphan",
    )
    events: Mapped[list["SupplierEvent"]] = relationship(
        back_populates="supplier",
        cascade="all, delete-orphan",
    )


class SupplierProduct(Base):
    """One product line / SKU class for a supplier — where the method lives."""

    __tablename__ = "supplier_products"
    __table_args__ = (
        sa.Index("ix_supplier_products_supplier_meat", "supplier_id", "meat_type"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.suppliers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    meat_type: Mapped[str] = mapped_column(
        sa.Enum(MeatType, name="supplier_product_meat_type", native_enum=False, length=50),
        nullable=False,
    )
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Poultry axis (chicken / turkey / duck). Red-meat lines leave this at
    # NOT_DISCLOSED and use ``zabihah_status`` instead.
    slaughter_method: Mapped[str] = mapped_column(
        sa.Enum(
            SlaughterMethod,
            name="supplier_slaughter_method",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{SlaughterMethod.NOT_DISCLOSED.value}'"),
    )
    # Red-meat axis (beef / lamb / goat). NULL on poultry lines — which axis is
    # meaningful is decided by ``meat_type``. Attributed to the restaurant/
    # supplier; the named body resolves to ``certifier_id``.
    zabihah_status: Mapped[Optional[str]] = mapped_column(
        sa.Enum(
            ZabihahStatus,
            name="supplier_zabihah_status",
            native_enum=False,
            length=30,
        ),
        nullable=True,
    )
    # Canonical certifying body the line is attributed to (resolves the
    # free-text ``certifying_body_name`` to a registry row). SET NULL so
    # deleting a certifier doesn't cascade-delete product lines.
    certifier_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.certifiers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    line_tier: Mapped[str] = mapped_column(
        sa.Enum(SupplierTier, name="supplier_line_tier", native_enum=False, length=50),
        nullable=False,
        server_default=text(f"'{SupplierTier.LISTED.value}'"),
    )
    stunning: Mapped[Optional[str]] = mapped_column(
        sa.Enum(Stunning, name="supplier_stunning", native_enum=False, length=50),
        nullable=True,
    )

    certifying_body_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    certificate_number: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    certificate_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    certificate_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    last_verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    evidence_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    supplier: Mapped["Supplier"] = relationship(back_populates="products")


class SupplierAttachment(Base):
    """Evidence (cert / audit letter / plant report) on a supplier or a line."""

    __tablename__ = "supplier_attachments"
    __table_args__ = ({"schema": "app"},)

    id: Mapped[uuid.UUID] = _uuid_pk()
    supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.suppliers.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    supplier_product_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.supplier_products.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    document_type: Mapped[str] = mapped_column(
        sa.Enum(
            SupplierAttachmentType,
            name="supplier_attachment_type",
            native_enum=False,
            length=50,
        ),
        nullable=False,
    )
    issuing_authority: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    certificate_number: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    valid_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    storage_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    original_filename: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    content_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    caption: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    supplier: Mapped[Optional["Supplier"]] = relationship(back_populates="attachments")


class SupplierEvent(Base):
    """Append-only audit log on a supplier — the visible correction trail."""

    __tablename__ = "supplier_events"
    __table_args__ = ({"schema": "app"},)

    id: Mapped[uuid.UUID] = _uuid_pk()
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.suppliers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(
        sa.Enum(
            SupplierEventType, name="supplier_event_type", native_enum=False, length=50
        ),
        nullable=False,
    )
    actor_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    supplier: Mapped["Supplier"] = relationship(back_populates="events")


class PlaceSupplierLink(Base):
    """A restaurant → product-line sourcing edge, with its own evidence tier.

    One live link per ``(place_id, supplier_product_id)`` — enforced by a
    partial unique index (``WHERE ended_at IS NULL``) created in the migration.
    A place may hold several live links for the same meat; the composition step
    picks the best-evidenced one.
    """

    __tablename__ = "place_supplier_links"
    __table_args__ = ({"schema": "app"},)

    id: Mapped[uuid.UUID] = _uuid_pk()
    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    supplier_product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.supplier_products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # Denormalised from the product for fast per-meat filtering; must equal
    # the product's meat_type (enforced at the service layer).
    meat_type: Mapped[str] = mapped_column(
        sa.Enum(MeatType, name="place_supplier_link_meat_type", native_enum=False, length=50),
        nullable=False,
    )
    evidence_tier: Mapped[str] = mapped_column(
        sa.Enum(
            SourcingEvidence,
            name="place_supplier_evidence_tier",
            native_enum=False,
            length=50,
        ),
        nullable=False,
        server_default=text(f"'{SourcingEvidence.OWNER_STATED.value}'"),
    )
    source: Mapped[str] = mapped_column(
        sa.Enum(LinkSource, name="place_supplier_link_source", native_enum=False, length=50),
        nullable=False,
        server_default=text(f"'{LinkSource.OWNER_CLAIM.value}'"),
    )
    source_claim_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.halal_claims.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_visit_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.verification_visits.id", ondelete="SET NULL"),
        nullable=True,
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    last_confirmed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
