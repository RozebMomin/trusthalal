"""Admin endpoints for the supplier registry (admin-curated).

Create suppliers + product lines (where slaughter method lives), edit them,
revoke, and read the audit trail. Everything is ADMIN-only. Nothing here reads
or writes a restaurant sourcing link — those come with the owner/consumer
surfaces later.
"""
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.admin.suppliers.repo import (
    admin_add_product,
    admin_create_supplier,
    admin_delete_product,
    admin_get_supplier,
    admin_list_supplier_events,
    admin_list_suppliers,
    admin_patch_product,
    admin_patch_supplier,
    admin_restore_supplier,
    admin_revoke_supplier,
)
from app.modules.admin.suppliers.schemas import (
    SupplierAdminRead,
    SupplierCreate,
    SupplierDetailRead,
    SupplierEventRead,
    SupplierPatch,
    SupplierProductAdminRead,
    SupplierProductCreate,
    SupplierProductPatch,
    SupplierRevokeRequest,
)
from app.modules.suppliers.enums import SlaughterMethod, SupplierTier
from app.modules.suppliers.models import Supplier
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/suppliers", tags=["admin: suppliers"])


def _read(supplier: Supplier) -> SupplierAdminRead:
    item = SupplierAdminRead.model_validate(supplier)
    item.product_count = len(supplier.products)
    return item


def _detail(supplier: Supplier) -> SupplierDetailRead:
    item = SupplierDetailRead.model_validate(supplier)
    item.product_count = len(supplier.products)
    return item


@router.get(
    "",
    response_model=list[SupplierAdminRead],
    summary="List suppliers (search + filter)",
    description=(
        "Admin registry browse. `q` matches name / slug / alias; `tier` filters "
        "by company tier; `method` returns suppliers with at least one product "
        "line of that slaughter method. Revoked suppliers are excluded unless "
        "`include_revoked=true`."
    ),
)
def list_suppliers_admin(
    q: str | None = Query(default=None, max_length=255),
    tier: SupplierTier | None = Query(default=None),
    method: SlaughterMethod | None = Query(default=None),
    include_revoked: bool = Query(default=False),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[SupplierAdminRead]:
    rows = admin_list_suppliers(
        db,
        q=q,
        tier=tier.value if tier else None,
        method=method.value if method else None,
        include_revoked=include_revoked,
        limit=limit,
        offset=offset,
    )
    return [_read(s) for s in rows]


@router.post(
    "",
    response_model=SupplierDetailRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a supplier (optionally with product lines)",
    description="Slug must be unique (409 SUPPLIER_SLUG_TAKEN otherwise).",
)
def create_supplier_admin(
    payload: SupplierCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> SupplierDetailRead:
    supplier = admin_create_supplier(db, payload=payload, actor_user_id=user.id)
    return _detail(supplier)


@router.get(
    "/{supplier_id}/events",
    response_model=list[SupplierEventRead],
    summary="Supplier audit trail (newest first)",
)
def list_supplier_events_admin(
    supplier_id: UUID,
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[SupplierEventRead]:
    rows = admin_list_supplier_events(
        db, supplier_id=supplier_id, limit=limit, offset=offset
    )
    return [SupplierEventRead.model_validate(r) for r in rows]


@router.post(
    "/{supplier_id}/products",
    response_model=SupplierProductAdminRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a product line to a supplier",
)
def add_supplier_product_admin(
    supplier_id: UUID,
    payload: SupplierProductCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> SupplierProductAdminRead:
    product = admin_add_product(
        db, supplier_id=supplier_id, payload=payload, actor_user_id=user.id
    )
    return SupplierProductAdminRead.model_validate(product)


@router.patch(
    "/{supplier_id}/products/{product_id}",
    response_model=SupplierProductAdminRead,
    summary="Edit a product line",
)
def patch_supplier_product_admin(
    supplier_id: UUID,
    product_id: UUID,
    payload: SupplierProductPatch,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> SupplierProductAdminRead:
    product = admin_patch_product(
        db,
        supplier_id=supplier_id,
        product_id=product_id,
        patch=payload,
        actor_user_id=user.id,
    )
    return SupplierProductAdminRead.model_validate(product)


@router.delete(
    "/{supplier_id}/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a product line",
    description=(
        "Blocked with 409 SUPPLIER_PRODUCT_IN_USE if a restaurant sourcing link "
        "references the line."
    ),
)
def delete_supplier_product_admin(
    supplier_id: UUID,
    product_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> None:
    admin_delete_product(
        db, supplier_id=supplier_id, product_id=product_id, actor_user_id=user.id
    )
    return None


@router.post(
    "/{supplier_id}/revoke",
    response_model=SupplierDetailRead,
    summary="Revoke a supplier (soft; excludes it + its lines from reads)",
    description="Idempotent. Optional reason lands on the REVOKED audit event.",
)
def revoke_supplier_admin(
    supplier_id: UUID,
    payload: SupplierRevokeRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> SupplierDetailRead:
    supplier = admin_revoke_supplier(
        db,
        supplier_id=supplier_id,
        actor_user_id=user.id,
        reason=payload.reason if payload else None,
    )
    return _detail(supplier)


@router.post(
    "/{supplier_id}/restore",
    response_model=SupplierDetailRead,
    summary="Restore a revoked supplier",
    description="Idempotent.",
)
def restore_supplier_admin(
    supplier_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> SupplierDetailRead:
    supplier = admin_restore_supplier(
        db, supplier_id=supplier_id, actor_user_id=user.id
    )
    return _detail(supplier)


@router.get(
    "/{supplier_id}",
    response_model=SupplierDetailRead,
    summary="Get a supplier with its product lines",
)
def get_supplier_admin(
    supplier_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> SupplierDetailRead:
    return _detail(admin_get_supplier(db, supplier_id=supplier_id))


@router.patch(
    "/{supplier_id}",
    response_model=SupplierDetailRead,
    summary="Edit a supplier (slug immutable)",
)
def patch_supplier_admin(
    supplier_id: UUID,
    payload: SupplierPatch,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> SupplierDetailRead:
    supplier = admin_patch_supplier(
        db, supplier_id=supplier_id, patch=payload, actor_user_id=user.id
    )
    return _detail(supplier)
