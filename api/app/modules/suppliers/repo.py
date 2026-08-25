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

from app.modules.certifiers.models import Certifier
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
        select(PlaceSupplierLink, SupplierProduct, Supplier, Certifier)
        .join(
            SupplierProduct,
            SupplierProduct.id == PlaceSupplierLink.supplier_product_id,
        )
        .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
        # Canonical certifier for the line, when one is linked. Outer so lines
        # with only a free-text certifier still return.
        .outerjoin(Certifier, Certifier.id == SupplierProduct.certifier_id)
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

    # Red meat composes on the zabihah axis (the line's zabihah_status), poultry
    # on hand/machine — so the surfaced value matches how each species reads.
    _RED = {"BEEF", "LAMB", "GOAT"}

    def _line_value(prod: SupplierProduct) -> str:
        if str(prod.meat_type) in _RED:
            return str(prod.zabihah_status or "UNSURE")
        return str(prod.slaughter_method)

    candidates = [
        LinkCandidate(
            method=_line_value(prod),
            supplier_tier=str(sup.verification_tier),
            line_tier=str(prod.line_tier),
            evidence_tier=str(link.evidence_tier),
            supplier_id=sup.id,
            supplier_name=sup.name,
            # Prefer the canonical certifier name; fall back to the free text.
            certifying_body_name=(cert.name if cert is not None else prod.certifying_body_name),
            product_last_verified_at=prod.last_verified_at,
            link_last_confirmed_at=link.last_confirmed_at,
        )
        for (link, prod, sup, cert) in rows
    ]

    fallback_method, fallback_as_of = _profile_fallback(
        db, place_id=place_id, meat_type=meat_type
    )
    return resolve_method(
        candidates,
        fallback_method=fallback_method,
        fallback_as_of=fallback_as_of,
    )


def place_supplier_certifiers(
    db: Session, *, place_id: uuid.UUID, now: Optional[datetime] = None
) -> dict[tuple[str, str], str]:
    """Map ``(meat_type, supplier_name_lower)`` -> canonical certifier name for
    the place's **live** supplier links.

    The composed provenance (``resolve_place_method``) is one row per meat, so
    it can only carry a single certifier even when a meat is sourced from
    several suppliers (three beef suppliers, three different certifiers). This
    keeps the per-supplier granularity so each product row can show the
    certifier of ITS own supplier. Canonical certifier wins over the line's
    free-text; lines with neither are omitted.
    """
    now = now or datetime.now(timezone.utc)
    rows = db.execute(
        select(
            PlaceSupplierLink.meat_type,
            Supplier.name,
            Certifier.name,
            SupplierProduct.certifying_body_name,
        )
        .join(
            SupplierProduct,
            SupplierProduct.id == PlaceSupplierLink.supplier_product_id,
        )
        .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
        .outerjoin(Certifier, Certifier.id == SupplierProduct.certifier_id)
        .where(
            PlaceSupplierLink.place_id == place_id,
            PlaceSupplierLink.ended_at.is_(None),
            or_(
                PlaceSupplierLink.expires_at.is_(None),
                PlaceSupplierLink.expires_at > now,
            ),
            Supplier.revoked_at.is_(None),
        )
    ).all()
    out: dict[tuple[str, str], str] = {}
    for meat_type, supplier_name, cert_name, free_text in rows:
        cert = cert_name or free_text
        if not cert:
            continue
        out[(str(meat_type), (supplier_name or "").strip().lower())] = cert
    return out


# ---------------------------------------------------------------------------
# Free-text → registry matching + profile-column fill
#
# Used to turn a verifier's free-text supplier ("Wayne Farms") into a real
# sourcing link, and to fill a place's per-meat profile column from the linked
# line — so a meat leaves the NOT_DISCLOSED bucket when its supplier is known.
# ---------------------------------------------------------------------------

# Profile per-meat column names keyed by MeatType value.
_MEAT_PROFILE_COLUMN = {
    "CHICKEN": "chicken_slaughter",
    "BEEF": "beef_slaughter",
    "LAMB": "lamb_slaughter",
    "GOAT": "goat_slaughter",
}
# Column values a supplier link may fill — a gap, not an already-stated method.
_RESOLVABLE_COLUMN_VALUES = frozenset({"NOT_DISCLOSED", "NOT_SERVED"})


def _supplier_match_keys(s: Supplier) -> set[str]:
    keys = {s.name.strip().lower(), s.slug.strip().lower()}
    for alias in s.aliases or []:
        norm = (alias or "").strip().lower()
        if norm:
            keys.add(norm)
    return keys


def match_supplier_product(
    db: Session, *, name: str, meat_type: str
) -> Optional[SupplierProduct]:
    """Strict match of a free-text supplier name to a registry product line.

    Returns a SupplierProduct only when unambiguous: exactly one non-revoked
    supplier matches the name / slug / alias (case-insensitive *exact*, not
    substring), and that supplier has exactly one product line for
    ``meat_type``. Anything ambiguous returns None — an unresolved meat beats a
    wrong link.
    """
    normalized = (name or "").strip().lower()
    if not normalized:
        return None
    suppliers = (
        db.execute(select(Supplier).where(Supplier.revoked_at.is_(None)))
        .scalars()
        .all()
    )
    matched = [s for s in suppliers if normalized in _supplier_match_keys(s)]
    if len(matched) != 1:
        return None
    products = (
        db.execute(
            select(SupplierProduct).where(
                SupplierProduct.supplier_id == matched[0].id,
                SupplierProduct.meat_type == str(meat_type),
            )
        )
        .scalars()
        .all()
    )
    if len(products) != 1:
        return None
    return products[0]


def fill_profile_method_from_supplier(
    db: Session, *, place_id: uuid.UUID, meat_type: str, method: str
) -> bool:
    """Fill the profile's per-meat column from a linked supplier line's method,
    but only when the column is a *gap* (NOT_DISCLOSED / NOT_SERVED) — never
    overriding an already-stated hand/machine value. Returns True on change."""
    col = _MEAT_PROFILE_COLUMN.get(str(meat_type))
    if col is None:
        return False
    profile = db.execute(
        select(HalalProfile).where(
            HalalProfile.place_id == place_id,
            HalalProfile.revoked_at.is_(None),
        )
    ).scalar_one_or_none()
    if profile is None:
        return False
    current = getattr(profile, col)
    if current in _RESOLVABLE_COLUMN_VALUES and method != current:
        setattr(profile, col, method)
        return True
    return False
