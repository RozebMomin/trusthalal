"""DB glue for method composition.

Thin layer over the pure core in ``provenance.py``: fetch the live, non-revoked
sourcing links for a (place, meat) and the self-attested profile fallback, then
let ``resolve_method`` decide. All the honesty logic lives in the pure module;
this file only knows how to read the rows.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.halal_profiles.models import HalalProfile
from app.modules.suppliers.models import (
    PlaceSupplierLink,
    Supplier,
    SupplierProduct,
)
from app.modules.suppliers.provenance import (
    LinkCandidate,
    MethodResolution,
    canonicalize_profile_method,
    resolve_method,
)


def public_search_suppliers(
    db: Session,
    *,
    q: Optional[str] = None,
    meat: Optional[str] = None,
    limit: int = 20,
) -> list[Supplier]:
    """Search non-revoked suppliers by name/slug/alias, optionally scoped to
    suppliers that carry a product line of ``meat``. Products load via the
    selectin relationship; the caller filters them to the meat for the picker.
    """
    stmt = select(Supplier).where(Supplier.revoked_at.is_(None))
    if q:
        pat = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Supplier.name).like(pat),
                func.lower(Supplier.slug).like(pat),
                func.lower(func.array_to_string(Supplier.aliases, " ")).like(pat),
            )
        )
    if meat:
        stmt = stmt.where(
            select(SupplierProduct.id)
            .where(
                SupplierProduct.supplier_id == Supplier.id,
                SupplierProduct.meat_type == meat,
            )
            .exists()
        )
    stmt = stmt.order_by(Supplier.name.asc()).limit(limit)
    return list(db.execute(stmt).scalars().unique().all())

# meat_type -> the HalalProfile per-meat column that holds the owner's
# self-attested method (legacy vocabulary; canonicalised on read). Only the
# four columns that exist on the profile; other meats have no self-attested
# fallback and resolve to NOT_DISCLOSED without a supplier link.
_PROFILE_COLUMN: dict[str, str] = {
    "CHICKEN": "chicken_slaughter",
    "BEEF": "beef_slaughter",
    "LAMB": "lamb_slaughter",
    "GOAT": "goat_slaughter",
}


def _profile_fallback(
    db: Session, *, place_id: uuid.UUID, meat_type: str
) -> tuple[Optional[str], Optional[datetime]]:
    column = _PROFILE_COLUMN.get(str(meat_type))
    if column is None:
        return None, None
    profile = db.execute(
        select(HalalProfile).where(
            HalalProfile.place_id == place_id,
            HalalProfile.revoked_at.is_(None),
        )
    ).scalar_one_or_none()
    if profile is None:
        return None, None
    return (
        canonicalize_profile_method(getattr(profile, column)),
        profile.last_verified_at,
    )


def resolve_place_method(
    db: Session,
    *,
    place_id: uuid.UUID,
    meat_type: str,
    now: Optional[datetime] = None,
) -> MethodResolution:
    """Compose the shown method + confidence for one served meat at a place.

    Considers only **live** links: ``ended_at IS NULL``, not past ``expires_at``,
    and whose supplier isn't revoked. Falls back to the profile's self-attested
    value when there's no live link.
    """
    now = now or datetime.now(timezone.utc)

    rows = db.execute(
        select(PlaceSupplierLink, SupplierProduct, Supplier)
        .join(
            SupplierProduct,
            SupplierProduct.id == PlaceSupplierLink.supplier_product_id,
        )
        .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
        .where(
            PlaceSupplierLink.place_id == place_id,
            PlaceSupplierLink.meat_type == str(meat_type),
            PlaceSupplierLink.ended_at.is_(None),
            or_(
                PlaceSupplierLink.expires_at.is_(None),
                PlaceSupplierLink.expires_at > now,
            ),
            Supplier.revoked_at.is_(None),
        )
    ).all()

    candidates = [
        LinkCandidate(
            method=str(prod.slaughter_method),
            supplier_tier=str(sup.verification_tier),
            line_tier=str(prod.line_tier),
            evidence_tier=str(link.evidence_tier),
            supplier_id=sup.id,
            supplier_name=sup.name,
            product_last_verified_at=prod.last_verified_at,
            link_last_confirmed_at=link.last_confirmed_at,
        )
        for (link, prod, sup) in rows
    ]

    fallback_method, fallback_as_of = _profile_fallback(
        db, place_id=place_id, meat_type=meat_type
    )
    return resolve_method(
        candidates,
        fallback_method=fallback_method,
        fallback_as_of=fallback_as_of,
    )
