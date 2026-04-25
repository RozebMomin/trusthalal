from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import AppError, NotFoundError
from app.modules.claims.repo import (
    add_evidence,
    create_claim, 
    verify_claim, 
    dispute_claim, 
    get_claim_detail,
    refresh_claim
)
from app.modules.claims.schemas import (
    ClaimCreate,
    ClaimRead,
    EvidenceCreate,
    EvidenceRead,
    DisputeRequest,
    ClaimDetailRead,
    RefreshRequest
)

from app.db.deps import get_db
from app.modules.organizations.deps import assert_can_manage_place
from app.modules.claims.models import HalalClaim

from app.modules.users.enums import UserRole

router = APIRouter(prefix="/claims", tags=["claims"])


@router.post("", response_model=ClaimRead, status_code=status.HTTP_201_CREATED)
def post_claim(
    payload: ClaimCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> ClaimRead:
    try:
        if user.role == UserRole.OWNER:
            assert_can_manage_place(db, user, payload.place_id)
        claim = create_claim(
            db,
            place_id=payload.place_id,
            claim_type=payload.claim_type,
            scope=payload.scope,
            actor_user_id=user.id,
        )
        return claim
    except AppError:
        raise


@router.get("/{claim_id}", response_model=ClaimDetailRead)
def get_claim_by_id(claim_id: UUID, db: Session = Depends(get_db)) -> ClaimDetailRead:
    try:
        return get_claim_detail(db, claim_id=claim_id)
    except AppError:
        raise


@router.post("/{claim_id}/evidence", response_model=EvidenceRead, status_code=status.HTTP_201_CREATED)
def post_claim_evidence(
    claim_id: UUID,
    payload: EvidenceCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> EvidenceRead:
    try:
        if user.role == UserRole.OWNER:
            place_id = db.execute(
                select(HalalClaim.place_id).where(HalalClaim.id == claim_id)
            ).scalar_one_or_none()
            if not place_id:
                raise NotFoundError("CLAIM_NOT_FOUND", "Claim not found")
            assert_can_manage_place(db, user, place_id)
        ev = add_evidence(
            db,
            claim_id=claim_id,
            evidence_type=payload.evidence_type,
            uri=payload.uri,
            notes=payload.notes,
            actor_user_id=user.id,
        )
        return ev
    except AppError:
        raise


@router.post("/{claim_id}/verify", response_model=ClaimRead, status_code=status.HTTP_200_OK)
def post_verify_claim(
    claim_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.VERIFIER, UserRole.ADMIN)),
) -> ClaimRead:
    try:
        return verify_claim(db, claim_id=claim_id, actor_user_id=user.id)
    except AppError:
        raise


@router.post("/{claim_id}/refresh", response_model=ClaimRead, status_code=status.HTTP_200_OK)
def post_refresh_claim(
    claim_id: UUID,
    payload: RefreshRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
) -> ClaimRead:
    try:
        if user.role == UserRole.OWNER:
            place_id = db.execute(
                select(HalalClaim.place_id).where(HalalClaim.id == claim_id)
            ).scalar_one_or_none()
            if not place_id:
                raise HTTPException(status_code=404, detail="Claim not found")
            assert_can_manage_place(db, user, place_id)
        
        return refresh_claim(
            db,
            claim_id=claim_id,
            reason=payload.reason,
            actor_user_id=user.id
        )
    except AppError:
        raise


@router.post("/{claim_id}/dispute", response_model=ClaimRead)
def post_dispute_claim(
    claim_id: UUID,
    payload: DisputeRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.CONSUMER, UserRole.ADMIN)),
) -> ClaimRead:
    try:
        return dispute_claim(db, claim_id=claim_id, reason=payload.reason, actor_user_id=user.id)
    except AppError:
        raise