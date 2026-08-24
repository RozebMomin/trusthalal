"""Admin data access for place → supplier-product sourcing links."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.admin.place_supplier_links.schemas import (
    PlaceSupplierLinkAdminRead,
    PlaceSupplierLinkCreate,
    PlaceSupplierLinkPatch,
    SupplierReconcileRequest,
)
from app.modules.places.models import Place
from app.modules.suppliers.enums import (
    LinkSource,
    SupplierEventType,
    SupplierTier,
    ZabihahStatus,
)
from app.modules.suppliers.models import (
    PlaceSupplierLink,
    Supplier,
    SupplierEvent,
    SupplierProduct,
)
from app.modules.suppliers.repo import fill_profile_method_from_supplier

_RED_MEAT = {"BEEF", "LAMB", "GOAT"}


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s or "supplier"

Row = tuple[PlaceSupplierLink, SupplierProduct, Supplier]


def _to_read(link: PlaceSupplierLink, product: SupplierProduct, supplier: Supplier) -> PlaceSupplierLinkAdminRead:
    return PlaceSupplierLinkAdminRead(
        id=link.id,
        place_id=link.place_id,
        supplier_product_id=link.supplier_product_id,
        meat_type=link.meat_type,
        evidence_tier=link.evidence_tier,
        source=link.source,
        note=link.note,
        last_confirmed_at=link.last_confirmed_at,
        expires_at=link.expires_at,
        ended_at=link.ended_at,
        created_at=link.created_at,
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        supplier_revoked=supplier.revoked_at is not None,
        product_name=product.product_name,
        slaughter_method=product.slaughter_method,
        line_tier=product.line_tier,
    )


def _require_place(db: Session, place_id: UUID) -> None:
    if db.execute(select(Place.id).where(Place.id == place_id)).scalar_one_or_none() is None:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")


def admin_list_place_links(
    db: Session, *, place_id: UUID, include_ended: bool = False
) -> list[PlaceSupplierLinkAdminRead]:
    _require_place(db, place_id)
    stmt = (
        select(PlaceSupplierLink, SupplierProduct, Supplier)
        .join(SupplierProduct, SupplierProduct.id == PlaceSupplierLink.supplier_product_id)
        .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
        .where(PlaceSupplierLink.place_id == place_id)
    )
    if not include_ended:
        stmt = stmt.where(PlaceSupplierLink.ended_at.is_(None))
    stmt = stmt.order_by(PlaceSupplierLink.meat_type.asc(), Supplier.name.asc())
    return [_to_read(link, product, supplier) for link, product, supplier in db.execute(stmt).all()]


def _get_link_row(db: Session, *, place_id: UUID, link_id: UUID) -> Row:
    row = db.execute(
        select(PlaceSupplierLink, SupplierProduct, Supplier)
        .join(SupplierProduct, SupplierProduct.id == PlaceSupplierLink.supplier_product_id)
        .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
        .where(PlaceSupplierLink.id == link_id, PlaceSupplierLink.place_id == place_id)
    ).one_or_none()
    if row is None:
        raise NotFoundError("PLACE_SUPPLIER_LINK_NOT_FOUND", "No such sourcing link on this place")
    return row  # type: ignore[return-value]


def admin_create_place_link(
    db: Session, *, place_id: UUID, payload: PlaceSupplierLinkCreate, actor_user_id: UUID | None
) -> PlaceSupplierLinkAdminRead:
    _require_place(db, place_id)

    product = db.execute(
        select(SupplierProduct).where(SupplierProduct.id == payload.supplier_product_id)
    ).scalar_one_or_none()
    if product is None:
        raise NotFoundError("SUPPLIER_PRODUCT_NOT_FOUND", "Supplier product line not found")

    supplier = db.execute(
        select(Supplier).where(Supplier.id == product.supplier_id)
    ).scalar_one()

    existing = db.execute(
        select(PlaceSupplierLink.id).where(
            PlaceSupplierLink.place_id == place_id,
            PlaceSupplierLink.supplier_product_id == product.id,
            PlaceSupplierLink.ended_at.is_(None),
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(
            "PLACE_SUPPLIER_LINK_EXISTS",
            "This place already has a live link to that product line.",
        )

    link = PlaceSupplierLink(
        place_id=place_id,
        supplier_product_id=product.id,
        meat_type=product.meat_type,
        evidence_tier=payload.evidence_tier.value,
        source=LinkSource.ADMIN.value,
        note=payload.note,
    )
    db.add(link)
    # Fill the profile's per-meat column from the linked line when it's a gap
    # (NOT_DISCLOSED / NOT_SERVED) — so linking a supplier here resolves the
    # meat the same way the verifier auto-match does. A stated hand/machine
    # value is left untouched.
    fill_profile_method_from_supplier(
        db,
        place_id=place_id,
        meat_type=str(product.meat_type),
        method=str(product.slaughter_method),
    )
    db.commit()
    db.refresh(link)
    return _to_read(link, product, supplier)


def admin_reconcile_supplier_for_place(
    db: Session,
    *,
    place_id: UUID,
    payload: SupplierReconcileRequest,
    actor_user_id: UUID | None,
) -> PlaceSupplierLinkAdminRead:
    """One-shot reconcile: find-or-create the supplier + its product line and
    link this place to it — atomically, in a single transaction.

    Idempotent by design: a supplier is reused when one already exists with the
    same slug (name), a product line is reused on ``(supplier, meat, product
    name)``, and an existing live link is returned rather than duplicated. So an
    admin can safely re-run it. Used from the claim review's "create & link".
    """
    _require_place(db, place_id)
    meat = payload.meat_type.value

    # --- supplier: reuse by slug, else create -----------------------------
    base = _slugify(payload.supplier_name)
    supplier = db.execute(
        select(Supplier).where(Supplier.slug == base)
    ).scalar_one_or_none()
    if supplier is None:
        slug, n = base, 2
        while db.execute(
            select(Supplier.id).where(Supplier.slug == slug)
        ).scalar_one_or_none() is not None:
            slug, n = f"{base}-{n}", n + 1
        supplier = Supplier(
            name=payload.supplier_name.strip(),
            slug=slug,
            city=payload.supplier_city,
            region=payload.supplier_state,
            certifying_body_name=payload.certifying_body_name,
            verification_tier=SupplierTier.LISTED.value,
        )
        db.add(supplier)
        db.flush()
        db.add(
            SupplierEvent(
                supplier_id=supplier.id,
                event_type=SupplierEventType.LISTED.value,
                actor_user_id=actor_user_id,
                description="Created from claim reconciliation.",
            )
        )

    # --- product line: reuse by (meat, name), else create -----------------
    product = db.execute(
        select(SupplierProduct).where(
            SupplierProduct.supplier_id == supplier.id,
            SupplierProduct.meat_type == meat,
            func.lower(SupplierProduct.product_name)
            == payload.product_name.strip().lower(),
        )
    ).scalar_one_or_none()
    if product is None:
        zabihah = None
        if meat in _RED_MEAT:
            zabihah = (
                ZabihahStatus.ZABIHAH.value
                if payload.slaughter_method.value in ("HAND_CUT", "MACHINE_CUT")
                else ZabihahStatus.UNSURE.value
            )
        product = SupplierProduct(
            supplier_id=supplier.id,
            meat_type=meat,
            product_name=payload.product_name.strip(),
            slaughter_method=payload.slaughter_method.value,
            zabihah_status=zabihah,
            line_tier=SupplierTier.LISTED.value,
            certifying_body_name=payload.certifying_body_name,
        )
        db.add(product)
        db.flush()
        db.add(
            SupplierEvent(
                supplier_id=supplier.id,
                event_type=SupplierEventType.LINE_ADDED.value,
                actor_user_id=actor_user_id,
                description=f"{meat} — {product.product_name} (claim reconciliation).",
            )
        )

    # --- link: reuse a live one, else create ------------------------------
    link = db.execute(
        select(PlaceSupplierLink).where(
            PlaceSupplierLink.place_id == place_id,
            PlaceSupplierLink.supplier_product_id == product.id,
            PlaceSupplierLink.ended_at.is_(None),
        )
    ).scalar_one_or_none()
    if link is None:
        link = PlaceSupplierLink(
            place_id=place_id,
            supplier_product_id=product.id,
            meat_type=product.meat_type,
            evidence_tier=payload.evidence_tier.value,
            source=LinkSource.ADMIN.value,
            note=payload.note,
        )
        db.add(link)
        db.flush()

    fill_profile_method_from_supplier(
        db,
        place_id=place_id,
        meat_type=str(product.meat_type),
        method=str(product.slaughter_method),
    )
    db.commit()
    db.refresh(link)
    db.refresh(product)
    db.refresh(supplier)
    return _to_read(link, product, supplier)


def admin_patch_place_link(
    db: Session,
    *,
    place_id: UUID,
    link_id: UUID,
    patch: PlaceSupplierLinkPatch,
    actor_user_id: UUID | None,
) -> PlaceSupplierLinkAdminRead:
    link, product, supplier = _get_link_row(db, place_id=place_id, link_id=link_id)
    data = patch.model_dump(exclude_unset=True)
    if "evidence_tier" in data and data["evidence_tier"] is not None:
        ev = data["evidence_tier"]
        link.evidence_tier = ev.value if hasattr(ev, "value") else ev
    if "note" in data:
        link.note = data["note"]
    link.last_confirmed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(link)
    return _to_read(link, product, supplier)


def admin_end_place_link(
    db: Session, *, place_id: UUID, link_id: UUID, actor_user_id: UUID | None
) -> None:
    link, _product, _supplier = _get_link_row(db, place_id=place_id, link_id=link_id)
    if link.ended_at is None:
        link.ended_at = datetime.now(timezone.utc)
        db.commit()
