"""Create OWNER_STATED sourcing links from an approved halal claim.

When an owner attaches a registry supplier line to a meat product in their
questionnaire (``MeatProductSourcing.supplier_product_id``) and the claim is
approved, we materialise a ``PlaceSupplierLink`` so the listing can show
supplier-backed method — at ``OWNER_STATED`` confidence (it's still just the
owner's word that they source there, until a document or verifier confirms it).

Called inside ``admin_approve_halal_claim`` before its commit, so it's part of
the same atomic approval transaction. Does not commit.

Idempotent: a live link to the same product line is left alone (so re-approval
/ renewal doesn't duplicate). Invalid references (missing/revoked product, or a
meat that doesn't match the entry) are skipped rather than failing the approval.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.suppliers.enums import LinkSource, SourcingEvidence
from app.modules.suppliers.models import (
    PlaceSupplierLink,
    Supplier,
    SupplierProduct,
)


def sync_owner_sourcing_links(db: Session, *, place_id: UUID, claim) -> int:
    """Materialise OWNER_STATED links for the claim's supplier_product_id refs.

    Returns the number of links created.
    """
    response = claim.structured_response or {}
    products = response.get("meat_products") or []

    created = 0
    for entry in products:
        raw = entry.get("supplier_product_id")
        if not raw:
            continue
        try:
            product_id = UUID(str(raw))
        except (ValueError, TypeError):
            continue

        row = db.execute(
            select(SupplierProduct, Supplier)
            .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
            .where(SupplierProduct.id == product_id)
        ).one_or_none()
        if row is None:
            continue
        product, supplier = row
        if supplier.revoked_at is not None:
            continue

        # Defensive: the linked line's meat must match the entry it's attached to.
        entry_meat = entry.get("meat_type")
        if entry_meat and str(product.meat_type) != str(entry_meat):
            continue

        # Idempotent — leave an existing live link as-is.
        already = db.execute(
            select(PlaceSupplierLink.id).where(
                PlaceSupplierLink.place_id == place_id,
                PlaceSupplierLink.supplier_product_id == product_id,
                PlaceSupplierLink.ended_at.is_(None),
            )
        ).scalar_one_or_none()
        if already is not None:
            continue

        db.add(
            PlaceSupplierLink(
                place_id=place_id,
                supplier_product_id=product_id,
                meat_type=product.meat_type,
                evidence_tier=SourcingEvidence.OWNER_STATED.value,
                source=LinkSource.OWNER_CLAIM.value,
                source_claim_id=claim.id,
            )
        )
        created += 1

    return created
