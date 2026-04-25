from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.admin.organizations.repo import (
    admin_add_member,
    admin_create_organization,
    admin_deactivate_member,
    admin_get_organization,
    admin_list_members,
    admin_list_org_places,
    admin_list_organizations,
    admin_patch_organization,
)
from app.modules.admin.organizations.schemas import (
    MemberAdminCreate,
    OrganizationAdminCreate,
    OrganizationAdminPatch,
    OrganizationAdminRead,
    OrganizationDetailRead,
    OrganizationMemberAdminRead,
    OrganizationPlaceOwnerRead,
    OrganizationPlaceSummary,
)
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/organizations", tags=["admin"])


@router.post(
    "",
    response_model=OrganizationAdminRead,
    status_code=status.HTTP_201_CREATED,
)
def create_org_admin(
    payload: OrganizationAdminCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationAdminRead:
    return admin_create_organization(db, payload)


@router.get("", response_model=list[OrganizationAdminRead])
def list_orgs_admin(
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[OrganizationAdminRead]:
    return admin_list_organizations(db, q=q, limit=limit, offset=offset)


@router.get("/{org_id}", response_model=OrganizationDetailRead)
def get_org_admin(
    org_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationDetailRead:
    org = admin_get_organization(db, org_id)
    members = admin_list_members(db, org_id)
    return OrganizationDetailRead(
        id=org.id,
        name=org.name,
        contact_email=org.contact_email,
        created_at=org.created_at,
        updated_at=org.updated_at,
        members=[OrganizationMemberAdminRead.model_validate(m) for m in members],
    )


@router.get(
    "/{org_id}/places",
    response_model=list[OrganizationPlaceOwnerRead],
)
def list_org_places_admin(
    org_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[OrganizationPlaceOwnerRead]:
    """List places this org owns (live + historical).

    Closes the user ↔ org ↔ place triangle visually: the org detail
    page can now show "which places does Acme run?" without bouncing
    through the places admin and filtering by owner.

    ACTIVE rows come first; REVOKED history rows follow so admins can
    see what the org USED to own — useful when triaging "we never
    worked with Acme, why does our catalog show them?"

    Soft-deleted places are included (the ``place.is_deleted`` flag
    lets the UI fade or badge them).
    """
    rows = admin_list_org_places(db, org_id=org_id)
    return [
        OrganizationPlaceOwnerRead(
            id=owner.id,
            role=owner.role,
            status=owner.status,
            created_at=owner.created_at,
            place=OrganizationPlaceSummary.model_validate(place),
        )
        for owner, place in rows
    ]


@router.patch("/{org_id}", response_model=OrganizationAdminRead)
def patch_org_admin(
    org_id: UUID,
    payload: OrganizationAdminPatch,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationAdminRead:
    """Partial update for an organization.

    Omitted fields are left alone. Sending ``contact_email: null``
    clears the field; omitting the key leaves the existing value.
    """
    return admin_patch_organization(db, org_id=org_id, patch=payload)


@router.post(
    "/{org_id}/members",
    response_model=OrganizationMemberAdminRead,
    status_code=status.HTTP_201_CREATED,
)
def add_member_admin(
    org_id: UUID,
    payload: MemberAdminCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationMemberAdminRead:
    return admin_add_member(db, org_id=org_id, payload=payload)


@router.delete(
    "/{org_id}/members/{user_id}",
    response_model=OrganizationMemberAdminRead,
)
def deactivate_member_admin(
    org_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationMemberAdminRead:
    return admin_deactivate_member(db, org_id=org_id, user_id=user_id)
