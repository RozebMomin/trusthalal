"""Admin data access for the supplier registry."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.admin.suppliers.schemas import (
    SupplierCreate,
    SupplierPatch,
    SupplierProductCreate,
    SupplierProductPatch,
)
from app.modules.suppliers.enums import SupplierEventType
from app.modules.suppliers.models import (
    PlaceSupplierLink,
    Supplier,
    SupplierEvent,
    SupplierProduct,
)


def _log(
    db: Session,
    *,
    supplier_id: UUID,
    event_type: SupplierEventType,
    actor_user_id: UUID | None,
    description: str | None = None,
) -> None:
    db.add(
        SupplierEvent(
            supplier_id=supplier_id,
            event_type=event_type.value,
            actor_user_id=actor_user_id,
            description=description,
        )
    )


def _like(term: str) -> str:
    return f"%{term.lower()}%"


def admin_list_suppliers(
    db: Session,
    *,
    q: Optional[str] = None,
    tier: Optional[str] = None,
    method: Optional[str] = None,
    include_revoked: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[Supplier]:
    """List suppliers for the admin browse.

    ``q`` matches name / slug / any alias (case-insensitive). ``tier`` is an
    exact company-tier match. ``method`` returns suppliers with at least one
    product line of that slaughter method. Revoked suppliers are excluded
    unless ``include_revoked``.
    """
    stmt = select(Supplier)

    if not include_revoked:
        stmt = stmt.where(Supplier.revoked_at.is_(None))

    if q:
        pat = _like(q)
        stmt = stmt.where(
            or_(
                func.lower(Supplier.name).like(pat),
                func.lower(Supplier.slug).like(pat),
                func.lower(func.array_to_string(Supplier.aliases, " ")).like(pat),
            )
        )

    if tier:
        stmt = stmt.where(Supplier.verification_tier == tier)

    if method:
        stmt = stmt.where(
            select(SupplierProduct.id)
            .where(
                SupplierProduct.supplier_id == Supplier.id,
                SupplierProduct.slaughter_method == method,
            )
            .exists()
        )

    stmt = stmt.order_by(Supplier.name.asc()).limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().unique().all())


def admin_get_supplier(db: Session, *, supplier_id: UUID) -> Supplier:
    supplier = db.execute(
        select(Supplier).where(Supplier.id == supplier_id)
    ).scalar_one_or_none()
    if supplier is None:
        raise NotFoundError("SUPPLIER_NOT_FOUND", "Supplier not found")
    return supplier


def _get_product(db: Session, *, supplier_id: UUID, product_id: UUID) -> SupplierProduct:
    product = db.execute(
        select(SupplierProduct).where(
            SupplierProduct.id == product_id,
            SupplierProduct.supplier_id == supplier_id,
        )
    ).scalar_one_or_none()
    if product is None:
        raise NotFoundError(
            "SUPPLIER_PRODUCT_NOT_FOUND", "No such product line on this supplier"
        )
    return product


def _new_product(supplier_id: UUID, payload: SupplierProductCreate) -> SupplierProduct:
    return SupplierProduct(
        supplier_id=supplier_id,
        meat_type=payload.meat_type.value,
        product_name=payload.product_name,
        slaughter_method=payload.slaughter_method.value,
        zabihah_status=payload.zabihah_status.value if payload.zabihah_status else None,
        line_tier=payload.line_tier.value,
        stunning=payload.stunning.value if payload.stunning else None,
        certifying_body_name=payload.certifying_body_name,
        certifier_id=payload.certifier_id,
        certificate_number=payload.certificate_number,
        certificate_url=payload.certificate_url,
        certificate_expires_at=payload.certificate_expires_at,
        source_url=payload.source_url,
        notes=payload.notes,
    )


def admin_create_supplier(
    db: Session, *, payload: SupplierCreate, actor_user_id: UUID | None
) -> Supplier:
    existing = db.execute(
        select(Supplier.id).where(Supplier.slug == payload.slug)
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(
            "SUPPLIER_SLUG_TAKEN", f"A supplier with slug {payload.slug!r} already exists"
        )

    supplier = Supplier(
        name=payload.name,
        slug=payload.slug,
        aliases=payload.aliases,
        website_url=payload.website_url,
        country_code=payload.country_code,
        region=payload.region,
        city=payload.city,
        verification_tier=payload.verification_tier.value,
        certifying_body_name=payload.certifying_body_name,
        notes=payload.notes,
    )
    db.add(supplier)
    db.flush()

    for product in payload.products:
        db.add(_new_product(supplier.id, product))

    _log(
        db,
        supplier_id=supplier.id,
        event_type=SupplierEventType.LISTED,
        actor_user_id=actor_user_id,
        description=f"Created ({payload.verification_tier.value}).",
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError(
            "SUPPLIER_SLUG_TAKEN", f"A supplier with slug {payload.slug!r} already exists"
        )
    db.refresh(supplier)
    return supplier


def admin_patch_supplier(
    db: Session, *, supplier_id: UUID, patch: SupplierPatch, actor_user_id: UUID | None
) -> Supplier:
    supplier = admin_get_supplier(db, supplier_id=supplier_id)
    data = patch.model_dump(exclude_unset=True)

    tier_changed_to = None
    if "verification_tier" in data and data["verification_tier"] is not None:
        new_tier = data.pop("verification_tier")
        new_val = new_tier.value if hasattr(new_tier, "value") else new_tier
        if new_val != supplier.verification_tier:
            supplier.verification_tier = new_val
            tier_changed_to = new_val

    for key, value in data.items():
        setattr(supplier, key, value)

    if tier_changed_to is not None:
        _log(
            db,
            supplier_id=supplier.id,
            event_type=SupplierEventType.VERIFIED,
            actor_user_id=actor_user_id,
            description=f"Company tier set to {tier_changed_to}.",
        )
    else:
        _log(
            db,
            supplier_id=supplier.id,
            event_type=SupplierEventType.CORRECTED,
            actor_user_id=actor_user_id,
            description="Supplier details edited.",
        )
    db.commit()
    db.refresh(supplier)
    return supplier


def admin_revoke_supplier(
    db: Session, *, supplier_id: UUID, actor_user_id: UUID | None, reason: str | None
) -> Supplier:
    supplier = admin_get_supplier(db, supplier_id=supplier_id)
    if supplier.revoked_at is None:
        supplier.revoked_at = datetime.now(timezone.utc)
        _log(
            db,
            supplier_id=supplier.id,
            event_type=SupplierEventType.REVOKED,
            actor_user_id=actor_user_id,
            description=reason or "Revoked.",
        )
        db.commit()
        db.refresh(supplier)
    return supplier


def admin_restore_supplier(
    db: Session, *, supplier_id: UUID, actor_user_id: UUID | None
) -> Supplier:
    supplier = admin_get_supplier(db, supplier_id=supplier_id)
    if supplier.revoked_at is not None:
        supplier.revoked_at = None
        _log(
            db,
            supplier_id=supplier.id,
            event_type=SupplierEventType.CORRECTED,
            actor_user_id=actor_user_id,
            description="Restored.",
        )
        db.commit()
        db.refresh(supplier)
    return supplier


def admin_add_product(
    db: Session,
    *,
    supplier_id: UUID,
    payload: SupplierProductCreate,
    actor_user_id: UUID | None,
) -> SupplierProduct:
    admin_get_supplier(db, supplier_id=supplier_id)  # 404 guard
    product = _new_product(supplier_id, payload)
    db.add(product)
    _log(
        db,
        supplier_id=supplier_id,
        event_type=SupplierEventType.LINE_ADDED,
        actor_user_id=actor_user_id,
        description=f"{payload.meat_type.value} — {payload.product_name} ({payload.slaughter_method.value}).",
    )
    db.commit()
    db.refresh(product)
    return product


def admin_patch_product(
    db: Session,
    *,
    supplier_id: UUID,
    product_id: UUID,
    patch: SupplierProductPatch,
    actor_user_id: UUID | None,
) -> SupplierProduct:
    product = _get_product(db, supplier_id=supplier_id, product_id=product_id)
    for key, value in patch.model_dump(exclude_unset=True).items():
        if hasattr(value, "value"):  # enum → its str value
            value = value.value
        setattr(product, key, value)
    _log(
        db,
        supplier_id=supplier_id,
        event_type=SupplierEventType.CORRECTED,
        actor_user_id=actor_user_id,
        description=f"Line edited: {product.meat_type} — {product.product_name}.",
    )
    db.commit()
    db.refresh(product)
    return product


def admin_delete_product(
    db: Session, *, supplier_id: UUID, product_id: UUID, actor_user_id: UUID | None
) -> None:
    product = _get_product(db, supplier_id=supplier_id, product_id=product_id)
    in_use = db.execute(
        select(PlaceSupplierLink.id)
        .where(PlaceSupplierLink.supplier_product_id == product_id)
        .limit(1)
    ).scalar_one_or_none()
    if in_use is not None:
        raise ConflictError(
            "SUPPLIER_PRODUCT_IN_USE",
            "This product line is referenced by a restaurant sourcing link. "
            "Remove the link first, or revoke the supplier.",
        )
    db.delete(product)
    _log(
        db,
        supplier_id=supplier_id,
        event_type=SupplierEventType.CORRECTED,
        actor_user_id=actor_user_id,
        description=f"Line removed: {product.meat_type} — {product.product_name}.",
    )
    db.commit()


def admin_list_supplier_events(
    db: Session, *, supplier_id: UUID, limit: int = 50, offset: int = 0
) -> list[SupplierEvent]:
    admin_get_supplier(db, supplier_id=supplier_id)  # 404 guard
    return list(
        db.execute(
            select(SupplierEvent)
            .where(SupplierEvent.supplier_id == supplier_id)
            .order_by(SupplierEvent.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
