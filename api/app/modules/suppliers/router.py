"""Authenticated read of the supplier registry — for the owner claim editor's
supplier picker. Any signed-in user can search; the data is public registry
information (name + method per line). Curation is admin-only (see
app/modules/admin/suppliers).
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.db.deps import get_db
from app.modules.halal_profiles.enums import MeatType
from app.modules.suppliers.repo import public_search_suppliers
from app.modules.suppliers.schemas import (
    SupplierProductPublicRead,
    SupplierPublicRead,
)

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get(
    "",
    response_model=list[SupplierPublicRead],
    summary="Search the supplier registry (authenticated)",
    description=(
        "Find suppliers by name / slug / alias, optionally scoped to those with "
        "a product line of `meat`. Used by the owner claim editor to attach a "
        "registry supplier line to a product. Revoked suppliers are excluded."
    ),
)
def search_suppliers(
    q: str | None = Query(default=None, max_length=255),
    meat: MeatType | None = Query(default=None),
    limit: int = Query(20, gt=0, le=50),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[SupplierPublicRead]:
    meat_value = meat.value if meat else None
    suppliers = public_search_suppliers(db, q=q, meat=meat_value, limit=limit)

    out: list[SupplierPublicRead] = []
    for s in suppliers:
        products = s.products
        if meat_value:
            products = [p for p in products if str(p.meat_type) == meat_value]
        out.append(
            SupplierPublicRead(
                id=s.id,
                name=s.name,
                slug=s.slug,
                city=s.city,
                region=s.region,
                country_code=s.country_code,
                certifying_body_name=s.certifying_body_name,
                products=[
                    SupplierProductPublicRead.model_validate(p) for p in products
                ],
            )
        )
    return out
