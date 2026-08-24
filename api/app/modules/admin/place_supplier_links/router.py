"""Admin endpoints for restaurant → supplier-product sourcing links.

Place-scoped: an admin wires a restaurant to a supplier's product line, which
is what makes the read-path composition show supplier-backed method. Links
created here are ``source=ADMIN``. ADMIN-only.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.admin.place_supplier_links.repo import (
    admin_create_place_link,
    admin_end_place_link,
    admin_list_place_links,
    admin_patch_place_link,
    admin_reconcile_supplier_for_place,
)
from app.modules.admin.place_supplier_links.schemas import (
    PlaceSupplierLinkAdminRead,
    PlaceSupplierLinkCreate,
    PlaceSupplierLinkPatch,
    SupplierReconcileRequest,
)
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/places", tags=["admin: suppliers"])


@router.get(
    "/{place_id}/supplier-links",
    response_model=list[PlaceSupplierLinkAdminRead],
    summary="List a place's supplier sourcing links",
)
def list_place_links_admin(
    place_id: UUID,
    include_ended: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[PlaceSupplierLinkAdminRead]:
    return admin_list_place_links(db, place_id=place_id, include_ended=include_ended)


@router.post(
    "/{place_id}/supplier-links",
    response_model=PlaceSupplierLinkAdminRead,
    status_code=status.HTTP_201_CREATED,
    summary="Link a place to a supplier product line",
    description=(
        "Creates an ADMIN-sourced link. 409 PLACE_SUPPLIER_LINK_EXISTS if a live "
        "link to that product line already exists; 404 if the place or product "
        "line is unknown."
    ),
)
def create_place_link_admin(
    place_id: UUID,
    payload: PlaceSupplierLinkCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> PlaceSupplierLinkAdminRead:
    return admin_create_place_link(
        db, place_id=place_id, payload=payload, actor_user_id=user.id
    )


@router.post(
    "/{place_id}/supplier-links/reconcile",
    response_model=PlaceSupplierLinkAdminRead,
    status_code=status.HTTP_201_CREATED,
    summary="One-shot: find-or-create a supplier + line and link it to the place",
    description=(
        "Reconciles a claim's stated free-text supplier into the registry in a "
        "single call: find-or-create the supplier, find-or-create its product "
        "line for the meat, and link this place to it. Idempotent — reuses "
        "existing supplier/line/link rather than duplicating."
    ),
)
def reconcile_supplier_admin(
    place_id: UUID,
    payload: SupplierReconcileRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> PlaceSupplierLinkAdminRead:
    return admin_reconcile_supplier_for_place(
        db, place_id=place_id, payload=payload, actor_user_id=user.id
    )


@router.patch(
    "/{place_id}/supplier-links/{link_id}",
    response_model=PlaceSupplierLinkAdminRead,
    summary="Update a link's evidence tier / note",
)
def patch_place_link_admin(
    place_id: UUID,
    link_id: UUID,
    payload: PlaceSupplierLinkPatch,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> PlaceSupplierLinkAdminRead:
    return admin_patch_place_link(
        db, place_id=place_id, link_id=link_id, patch=payload, actor_user_id=user.id
    )


@router.delete(
    "/{place_id}/supplier-links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="End a sourcing link (soft; sets ended_at)",
    description="Idempotent. The row survives for history; it stops backing the listing.",
)
def end_place_link_admin(
    place_id: UUID,
    link_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> None:
    admin_end_place_link(db, place_id=place_id, link_id=link_id, actor_user_id=user.id)
    return None
