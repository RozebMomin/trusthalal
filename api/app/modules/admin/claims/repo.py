from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.claims.enums import ClaimEventType, ClaimStatus
from app.modules.claims.models import ClaimEvent, Evidence, HalalClaim
from app.modules.claims.repo import log_claim_event
from app.modules.users.models import User


def _get_claim_or_404(db: Session, claim_id: UUID) -> HalalClaim:
    claim = db.execute(select(HalalClaim).where(HalalClaim.id == claim_id)).scalar_one_or_none()
    if not claim:
        raise NotFoundError("CLAIM_NOT_FOUND", "Claim not found")
    return claim


def admin_list_claims(
    db: Session,
    *,
    status: str | None,
    place_id: UUID | None,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    """Paginated admin queue.

    Returns dicts (not ORM objects) because we want `evidence_count` alongside
    the claim columns — Pydantic's from_attributes will flatten the row.
    """
    evidence_count = (
        select(Evidence.claim_id, func.count(Evidence.id).label("n"))
        .group_by(Evidence.claim_id)
        .subquery()
    )

    stmt = (
        select(
            HalalClaim,
            func.coalesce(evidence_count.c.n, 0).label("evidence_count"),
        )
        .outerjoin(evidence_count, evidence_count.c.claim_id == HalalClaim.id)
    )

    if status:
        stmt = stmt.where(HalalClaim.status == status)
    if place_id:
        stmt = stmt.where(HalalClaim.place_id == place_id)

    stmt = (
        stmt.order_by(HalalClaim.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    rows: list[dict[str, Any]] = []
    for claim, n in db.execute(stmt).all():
        rows.append(
            {
                "id": claim.id,
                "place_id": claim.place_id,
                "claim_type": claim.claim_type,
                "scope": claim.scope,
                "status": claim.status,
                "expires_at": claim.expires_at,
                "created_by_user_id": claim.created_by_user_id,
                "created_at": claim.created_at,
                "updated_at": claim.updated_at,
                "evidence_count": int(n),
            }
        )
    return rows


def admin_verify_claim(
    db: Session,
    *,
    claim_id: UUID,
    actor_user_id: UUID,
    reason: str,
) -> HalalClaim:
    claim = _get_claim_or_404(db, claim_id)

    if claim.status in {ClaimStatus.REJECTED, ClaimStatus.EXPIRED}:
        raise ConflictError("CLAIM_NOT_VERIFIABLE", f"Cannot verify a claim in status {claim.status}")

    claim.status = ClaimStatus.VERIFIED
    claim.updated_at = datetime.now(timezone.utc)

    # Optional: bump confidence on admin verify (simple MVP)
    if hasattr(claim, "confidence_score") and claim.confidence_score is not None:
        claim.confidence_score = max(claim.confidence_score, 90)

    log_claim_event(
        db,
        claim_id=claim.id,
        event_type=ClaimEventType.ADMIN_VERIFIED,
        actor_user_id=actor_user_id,
        message=f"Admin verified claim: {reason}",
    )

    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim


def admin_reject_claim(
    db: Session,
    *,
    claim_id: UUID,
    actor_user_id: UUID,
    reason: str,
) -> HalalClaim:
    claim = _get_claim_or_404(db, claim_id)

    if claim.status == ClaimStatus.EXPIRED:
        raise ConflictError("CLAIM_NOT_REJECTABLE", "Cannot reject an expired claim (expire is final).")

    claim.status = ClaimStatus.REJECTED
    claim.updated_at = datetime.now(timezone.utc)

    if hasattr(claim, "confidence_score") and claim.confidence_score is not None:
        claim.confidence_score = min(claim.confidence_score, 10)

    log_claim_event(
        db,
        claim_id=claim.id,
        event_type=ClaimEventType.ADMIN_REJECTED,
        actor_user_id=actor_user_id,
        message=f"Admin rejected claim: {reason}",
    )

    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim


def admin_expire_claim(
    db: Session,
    *,
    claim_id: UUID,
    actor_user_id: UUID,
    reason: str,
) -> HalalClaim:
    claim = _get_claim_or_404(db, claim_id)

    # Idempotent: expiring an expired claim is a no-op
    if claim.status == ClaimStatus.EXPIRED:
        return claim

    claim.status = ClaimStatus.EXPIRED
    claim.updated_at = datetime.now(timezone.utc)

    # Force expiry timestamp to now so logic stays consistent
    if hasattr(claim, "expires_at"):
        claim.expires_at = datetime.now(timezone.utc)

    log_claim_event(
        db,
        claim_id=claim.id,
        event_type=ClaimEventType.ADMIN_EXPIRED,
        actor_user_id=actor_user_id,
        message=f"Admin expired claim: {reason}",
    )

    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim


def admin_list_claim_events(
    db: Session,
    *,
    claim_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """List events with the acting user LEFT-joined in.

    The endpoint powers the admin panel's Event History timeline; to
    answer "who did this?" without an N+1, the query joins users on
    ``actor_user_id`` and the return rows carry ``actor_email`` +
    ``actor_display_name`` alongside the normal event columns.

    LEFT JOIN (not INNER) because:
      * ``actor_user_id`` is nullable for batch-job rows (``EXPIRED``).
      * The FK is ON DELETE SET NULL, so a deleted user leaves the
        event pointing at nothing — we still want the row visible.
    """
    # Ensure claim exists (same 404 contract as before).
    claim = db.execute(
        select(HalalClaim).where(HalalClaim.id == claim_id)
    ).scalar_one_or_none()
    if not claim:
        raise NotFoundError("CLAIM_NOT_FOUND", "Claim not found")

    stmt = (
        select(
            ClaimEvent,
            User.email.label("actor_email"),
            User.display_name.label("actor_display_name"),
        )
        .outerjoin(User, User.id == ClaimEvent.actor_user_id)
        .where(ClaimEvent.claim_id == claim_id)
        .order_by(ClaimEvent.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    rows: list[dict[str, Any]] = []
    for event, actor_email, actor_display_name in db.execute(stmt).all():
        rows.append(
            {
                "id": event.id,
                "claim_id": event.claim_id,
                "event_type": event.event_type,
                "message": event.message,
                "actor_user_id": event.actor_user_id,
                "actor_email": actor_email,
                "actor_display_name": actor_display_name,
                "created_at": event.created_at,
            }
        )
    return rows