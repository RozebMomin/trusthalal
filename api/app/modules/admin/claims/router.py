from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.admin.claims.repo import (
    admin_expire_claim,
    admin_list_claim_events,
    admin_list_claims,
    admin_reject_claim,
    admin_verify_claim,
)
from app.modules.admin.claims.schemas import (
    AdminClaimAction,
    ClaimAdminRead,
    ClaimEventRead,
)
from app.modules.claims.schemas import ClaimRead
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/claims", tags=["admin"])


@router.get("", response_model=list[ClaimAdminRead])
def list_claims_admin(
    status: str | None = Query(default=None, max_length=50),
    place_id: UUID | None = Query(default=None),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.VERIFIER)),
) -> list[ClaimAdminRead]:
    """List claims for the admin/verifier queue.

    Both ADMIN and VERIFIER can read this. The write paths below
    (verify/reject/expire) stay ADMIN-only — verifiers moderate via
    the public ``POST /claims/{id}/verify`` route, which has its own
    role-gated logic. Loosening the read lets the admin panel's
    /claims page work for verifiers without building a second queue
    surface.
    """
    rows = admin_list_claims(
        db,
        status=status,
        place_id=place_id,
        limit=limit,
        offset=offset,
    )
    return [ClaimAdminRead.model_validate(row) for row in rows]


@router.get("/{claim_id}/events", response_model=list[ClaimEventRead])
def list_claim_events_admin(
    claim_id: UUID,
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.VERIFIER)),
) -> list[ClaimEventRead]:
    """Event history for a claim.

    Same role posture as the list endpoint: ADMIN and VERIFIER can
    read the audit trail (verifiers need it to understand the
    context when deciding how to moderate). Events carry
    ``actor_email`` / ``actor_display_name`` which is internal-staff
    info — safe to expose to verifiers, who are themselves staff.
    """
    return admin_list_claim_events(db, claim_id=claim_id, limit=limit, offset=offset)



@router.post("/{claim_id}/verify", response_model=ClaimRead)
def verify_claim_admin(
    claim_id: UUID,
    payload: AdminClaimAction,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> ClaimRead:
    return admin_verify_claim(db, claim_id=claim_id, actor_user_id=user.id, reason=payload.reason)


@router.post("/{claim_id}/reject", response_model=ClaimRead)
def reject_claim_admin(
    claim_id: UUID,
    payload: AdminClaimAction,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> ClaimRead:
    return admin_reject_claim(db, claim_id=claim_id, actor_user_id=user.id, reason=payload.reason)


@router.post("/{claim_id}/expire", response_model=ClaimRead)
def expire_claim_admin(
    claim_id: UUID,
    payload: AdminClaimAction,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> ClaimRead:
    return admin_expire_claim(db, claim_id=claim_id, actor_user_id=user.id, reason=payload.reason)