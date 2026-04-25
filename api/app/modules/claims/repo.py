from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.exceptions import ConflictError, NotFoundError
from app.modules.claims.enums import ClaimEventType, ClaimScope, ClaimStatus, ClaimType
from app.modules.claims.models import HalalClaim, ClaimEvent, Evidence
from app.modules.places.models import Place


def log_claim_event(
    db: Session,
    *,
    claim_id,
    event_type: ClaimEventType,
    actor_user_id=None,
    message=None,
) -> None:
    db.add(
        ClaimEvent(
            claim_id=claim_id,
            event_type=event_type,
            actor_user_id=actor_user_id,
            message=message,
        )
    )


def create_claim(db: Session, *, place_id: UUID, claim_type: ClaimType, scope: ClaimScope, actor_user_id: UUID | None = None) -> HalalClaim:
    try:
        place_exists = db.execute(select(Place.id).where(Place.id == place_id)).scalar_one_or_none()
        if not place_exists:
            raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=settings.CLAIM_TTL_DAYS)

        claim = HalalClaim(
            place_id=place_id,
            claim_type=claim_type,
            scope=scope,
            status=ClaimStatus.PENDING,
            expires_at=expires_at,
            created_by_user_id=actor_user_id,
        )
        db.add(claim)
        db.flush()

        db.add(ClaimEvent(
            claim_id=claim.id,
            event_type=ClaimEventType.SUBMITTED,
            message="Claim submitted",
            actor_user_id=actor_user_id,
        ))

        db.commit()
        db.refresh(claim)
        return claim

    except IntegrityError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


def get_claim_detail(db: Session, *, claim_id: UUID) -> dict:
    claim = db.execute(
        select(HalalClaim).where(HalalClaim.id == claim_id)
    ).scalar_one_or_none()

    if not claim:
        raise NotFoundError("CLAIM_NOT_FOUND", "Claim not found")

    evidence = db.execute(
        select(Evidence).where(Evidence.claim_id == claim_id).order_by(Evidence.created_at.desc())
    ).scalars().all()

    events = db.execute(
        select(ClaimEvent).where(ClaimEvent.claim_id == claim_id).order_by(ClaimEvent.created_at.asc())
    ).scalars().all()

    return {
        "id": claim.id,
        "place_id": claim.place_id,
        "claim_type": claim.claim_type,
        "scope": claim.scope,
        "status": claim.status,
        "expires_at": claim.expires_at,
        "created_by_user_id": claim.created_by_user_id,
        "created_at": claim.created_at,
        "updated_at": claim.updated_at,
        "evidence": evidence,
        "events": events,
    }


def add_evidence(
    db: Session,
    *,
    claim_id: UUID,
    evidence_type: str,
    uri: str,
    notes: str | None = None,
    actor_user_id: UUID | None = None,
) -> Evidence:
    try:
        claim_exists = db.execute(select(HalalClaim.id).where(HalalClaim.id == claim_id)).scalar_one_or_none()
        if not claim_exists:
            raise ValueError("CLAIM_NOT_FOUND")

        ev = Evidence(
            claim_id=claim_id,
            evidence_type=evidence_type,
            uri=uri,
            notes=notes,
            uploaded_by_user_id=actor_user_id,
        )
        db.add(ev)
        db.flush()

        db.add(
            ClaimEvent(
                claim_id=claim_id,
                event_type=ClaimEventType.EVIDENCE_ADDED,
                message=f"Evidence added: {evidence_type}",
                actor_user_id=actor_user_id,
            )
        )

        db.commit()
        db.refresh(ev)
        return ev

    except IntegrityError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


def get_claims_for_place(db: Session, *, place_id: UUID) -> list[dict]:
    """Return active + historical claims for a place with evidence counts and confidence score."""
    evidence_counts = (
        select(Evidence.claim_id, func.count(Evidence.id).label("evidence_count"))
        .group_by(Evidence.claim_id)
        .cte("evidence_counts")
    )

    stmt = (
        select(HalalClaim, func.coalesce(evidence_counts.c.evidence_count, 0).label("evidence_count"))
        .outerjoin(evidence_counts, evidence_counts.c.claim_id == HalalClaim.id)
        .where(HalalClaim.place_id == place_id)
        .order_by(HalalClaim.created_at.desc())
    )

    rows = db.execute(stmt).all()
    result: list[dict] = []

    for claim, evidence_count in rows:
        ec = int(evidence_count)
        result.append(
            {
                "id": claim.id,
                "place_id": claim.place_id,
                "claim_type": claim.claim_type,
                "scope": claim.scope,
                "status": claim.status,
                "expires_at": claim.expires_at,
                "evidence_count": ec,
                "confidence_score": _confidence_score(status=claim.status, evidence_count=ec, expires_at=claim.expires_at),
            }
        )

    return result


def verify_claim(db: Session, *, claim_id: UUID, actor_user_id: UUID | None = None) -> HalalClaim:
    try:
        claim = db.execute(select(HalalClaim).where(HalalClaim.id == claim_id)).scalar_one_or_none()
        if not claim:
            raise NotFoundError("CLAIM_NOT_FOUND", "Claim not found")

        # Claims are idempotent
        if claim.status == ClaimStatus.VERIFIED:
            return claim
        
        # Optional: prevent verifying expired claims
        if claim.expires_at <= datetime.now(timezone.utc):
            raise ConflictError("CLAIM_EXPIRED", "Claim is expired")
        
        claim.status = ClaimStatus.VERIFIED
        db.add(claim)
        db.flush()

        db.add(
            ClaimEvent(
                claim_id=claim.id,
                event_type=ClaimEventType.VERIFIED,
                message="Claim verified",
                actor_user_id=actor_user_id,
            )
        )

        db.commit()
        db.refresh(claim)
        return claim

    except IntegrityError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


def refresh_claim(
    db: Session,
    *,
    claim_id: UUID,
    reason: str | None = None,
    actor_user_id: UUID | None = None,
) -> HalalClaim:
    """Refresh a claim by resetting expires_at. Preserves all prior audit history by appending a REFRESH_REQUESTED event.

    Trust-first policy:
    - Refresh is a *renewal request*, not an automatic re-verification.
    - Requires at least one piece of evidence on the claim.
    - Allowed only when the claim is already expired, or expiring within settings.CLAIM_REFRESH_WINDOW_DAYS.
    - Claims in DISPUTED or REJECTED status cannot be refreshed.

    Audit:
    - Preserves all prior audit history by appending a REFRESH_REQUESTED event.
    """
    try:
        claim = db.execute(select(HalalClaim).where(HalalClaim.id == claim_id)).scalar_one_or_none()
        if not claim:
            raise NotFoundError("CLAIM_NOT_FOUND", "Claim not found")
        
        # Status gating first (more actionable errors)
        if claim.status == ClaimStatus.DISPUTED:
            raise ConflictError("CLAIM_DISPUTED", "Claim is disputed and cannot be refreshed")
        
        if claim.status == ClaimStatus.REJECTED:
            raise ConflictError("CLAIM_NOT_REFRESHABLE", "Claim cannot be refreshed in its current status")
        
        # Evidence is required before a renewal can be requested.
        evidence_count = db.execute(select(func.count(Evidence.id)).where(Evidence.claim_id == claim_id)).scalar_one()
        if int(evidence_count) <= 0:
            raise ConflictError("CLAIM_EVIDENCE_REQUIRED", "Evidence is required before requesting a renewal")

        now = datetime.now(timezone.utc)
        window_start = now + timedelta(days=settings.CLAIM_REFRESH_WINDOW_DAYS)

        # Must be expired or expiring soon
        if claim.expires_at > window_start:
            raise ConflictError("CLAIM_NOT_EXPIRING", "Claim is not expiring soon")

        # Reset expiry
        claim.expires_at = now + timedelta(days=settings.CLAIM_TTL_DAYS)
        claim.status = ClaimStatus.PENDING

        db.add(claim)
        db.flush()

        db.add(
            ClaimEvent(
                claim_id=claim.id,
                event_type=ClaimEventType.REFRESH_REQUESTED,
                message=(reason or "Owner requested claim renewal"),
                actor_user_id=actor_user_id,
            )
        )

        db.commit()
        db.refresh(claim)
        return claim

    except IntegrityError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


def dispute_claim(
    db: Session,
    *,
    claim_id: UUID,
    reason: str | None = None,
    actor_user_id: UUID | None = None,
) -> HalalClaim:
    try:
        claim = db.execute(select(HalalClaim).where(HalalClaim.id == claim_id)).scalar_one_or_none()
        if not claim:
            raise NotFoundError("CLAIM_NOT_FOUND", "Claim not found")

        # idempotent
        if claim.status == ClaimStatus.DISPUTED:
            return claim

        # Do not allow disputing an expired claim (or a claim whose expiry time has passed)
        if claim.status == ClaimStatus.EXPIRED or claim.expires_at <= datetime.now(timezone.utc):
            raise ConflictError("CLAIM_EXPIRED", "Claim is expired")

        claim.status = ClaimStatus.DISPUTED
        db.add(claim)
        db.flush()

        db.add(
            ClaimEvent(
                claim_id=claim.id,
                event_type=ClaimEventType.DISPUTED,
                message=reason or "Claim disputed",
                actor_user_id=actor_user_id,
            )
        )

        db.commit()
        db.refresh(claim)
        return claim

    except IntegrityError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


def _confidence_score(*, status: ClaimStatus, evidence_count: int, expires_at: datetime) -> int:
    """Deterministic v1 confidence score (0-100)."""
    # Base trust by status
    base_map = {
        ClaimStatus.VERIFIED: 85,
        ClaimStatus.PENDING: 30,
        ClaimStatus.REJECTED: 5,
        ClaimStatus.EXPIRED: 20,
    }
    base = base_map.get(status, 0)

    # Evidence weight (big jump for having *any* evidence)
    bonus = 0
    if evidence_count <= 0:
        bonus -= 15  # explicit penalty for no evidence
    else:
        bonus += 35  # big confidence bump once there is evidence
        if evidence_count >= 2:
            bonus += 10
        if evidence_count >= 3:
            bonus += 5  # small extra beyond 2

    # Expiry penalty (stronger)
    now = datetime.now(timezone.utc)
    if expires_at <= now:
        bonus -= 25

    score = base + bonus
    return max(0, min(100, score))