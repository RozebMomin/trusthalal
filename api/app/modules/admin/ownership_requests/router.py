from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.admin.ownership_requests.repo import (
    admin_approve_ownership_request,
    admin_create_ownership_request,
    admin_list_ownership_requests,
    admin_reject_ownership_request,
    admin_request_more_evidence,
)
from app.modules.admin.ownership_requests.schemas import (
    OwnershipRequestAdminCreate,
    OwnershipRequestAdminRead,
    OwnershipRequestApprove,
    OwnershipRequestEvidence,
    OwnershipRequestReject,
)
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/ownership-requests", tags=["admin"])


@router.post(
    "",
    response_model=OwnershipRequestAdminRead,
    status_code=status.HTTP_201_CREATED,
)
def create_ownership_request_admin(
    payload: OwnershipRequestAdminCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OwnershipRequestAdminRead:
    """Create an ownership request on someone's behalf (admin path).

    Use when an admin takes an inbound request by phone, email, or
    in-person and wants to capture it in the system without the
    claimant going through the public submit flow. ``requester_user_id``
    can be null for unauthenticated intakes; set it to a real user id
    when the claimant has an account and you want them to be able to
    see the request later via ``GET /ownership-requests/{id}/detail``.
    """
    return admin_create_ownership_request(db, payload=payload)


@router.get("", response_model=list[OwnershipRequestAdminRead])
def list_ownership_requests(
    status: str | None = Query(default=None, max_length=50),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[OwnershipRequestAdminRead]:
    return admin_list_ownership_requests(db, status=status, limit=limit, offset=offset)


@router.post("/{request_id}/approve", response_model=OwnershipRequestAdminRead)
def approve_ownership_request(
    request_id: UUID,
    payload: OwnershipRequestApprove,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OwnershipRequestAdminRead:
    return admin_approve_ownership_request(
        db,
        request_id=request_id,
        payload=payload,
        actor_user_id=user.id,
    )


@router.post("/{request_id}/reject", response_model=OwnershipRequestAdminRead)
def reject_ownership_request(
    request_id: UUID,
    payload: OwnershipRequestReject,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OwnershipRequestAdminRead:
    return admin_reject_ownership_request(
        db,
        request_id=request_id,
        payload=payload,
        actor_user_id=user.id,
    )


@router.post(
    "/{request_id}/request-evidence",
    response_model=OwnershipRequestAdminRead,
)
def request_more_evidence(
    request_id: UUID,
    payload: OwnershipRequestEvidence,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OwnershipRequestAdminRead:
    return admin_request_more_evidence(
        db,
        request_id=request_id,
        payload=payload,
        actor_user_id=user.id,
    )
