"""Admin data access for place → supplier-product sourcing links."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.admin.place_supplier_links.schemas import (
    PlaceSupplierLinkAdminRead,
    PlaceSupplierLinkCreate,
    PlaceSupplierLinkPatch,
)
from app.modules.places.models import Place
from app.modules.suppliers.enums import LinkSource
from app.modules.suppliers.models import (
    PlaceSupplierLink,
    Supplier,
    SupplierProduct,
)

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
    db.commit()
    db.refresh(link)
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
