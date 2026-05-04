"""Admin-side repo for halal-claim decisions.

Owns the four decision transitions:

  * approve  — PENDING_REVIEW (or NEEDS_MORE_INFO) → APPROVED, then
               profile derivation runs.
  * reject   — PENDING_REVIEW (or NEEDS_MORE_INFO) → REJECTED.
  * request-info — PENDING_REVIEW → NEEDS_MORE_INFO. Re-opens the
                   owner's attachment-upload path so they can submit
                   more evidence.
  * revoke   — APPROVED → REVOKED. Marks the resulting profile
               revoked_at (admin pulled the claim).

Each transition writes back the decided_at + decided_by_user_id +
decision_note + (optional) internal_notes. Idempotency is per-
endpoint where it makes sense (already-decided ⇒ 409, already-
revoked ⇒ no-op).

Approve is the heaviest path because it triggers the profile
derivation. The whole thing is wrapped in a single transaction —
either the claim flips to APPROVED, the profile is created/updated,
the profile-event row is written, AND any prior source_claim is
marked SUPERSEDED, or none of it lands.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.admin.halal_claims.schemas import (
    HalalClaimApprove,
    HalalClaimReject,
    HalalClaimRequestInfo,
    HalalClaimRevoke,
)
from app.modules.halal_claims.enums import HalalClaimStatus
from app.modules.halal_claims.models import HalalClaim
from app.modules.halal_profiles.models import HalalProfile
from app.modules.halal_profiles.service import (
    derive_profile_from_approved_claim,
    revoke_profile,
)


# Statuses an admin can act on for the standard decision endpoints
# (approve / reject / request-info). REVOKE has its own gate (only
# acts on APPROVED claims).
_DECIDABLE_STATUSES: tuple[str, ...] = (
    HalalClaimStatus.PENDING_REVIEW.value,
    HalalClaimStatus.NEEDS_MORE_INFO.value,
)


def admin_get_halal_claim(db: Session, claim_id: UUID) -> HalalClaim:
    """Fetch a claim with no ownership check — admin can see all.

    Raises NotFoundError on missing claim.
    """
    claim = db.execute(
        select(HalalClaim).where(HalalClaim.id == claim_id)
    ).scalar_one_or_none()
    if claim is None:
        raise NotFoundError(
            "HALAL_CLAIM_NOT_FOUND", "Halal claim not found."
        )
    return claim


def admin_list_halal_claims(
    db: Session,
    *,
    status: Optional[str] = None,
    place_id: Optional[UUID] = None,
    organization_id: Optional[UUID] = None,
    limit: int = 50,
    offset: int = 0,
) -> Sequence[HalalClaim]:
    """List claims with optional filters. Newest-first.

    Status filter accepts the raw string so callers can pass
    'PENDING_REVIEW' or 'APPROVED' without importing the enum. The
    queue's default view in admin is 'PENDING_REVIEW' but the
    endpoint stays generic.
    """
    query = select(HalalClaim).order_by(HalalClaim.created_at.desc())
    if status is not None:
        query = query.where(HalalClaim.status == status)
    if place_id is not None:
        query = query.where(HalalClaim.place_id == place_id)
    if organization_id is not None:
        query = query.where(HalalClaim.organization_id == organization_id)
    query = query.limit(limit).offset(offset)
    return db.execute(query).scalars().all()


# ---------------------------------------------------------------------------
# Decision transitions
# ---------------------------------------------------------------------------


def _stamp_decision(
    claim: HalalClaim,
    *,
    new_status: HalalClaimStatus,
    actor_user_id: UUID,
    decision_note: Optional[str],
    internal_notes: Optional[str],
) -> None:
    """Common decision-audit fields. Caller commits."""
    claim.status = new_status.value
    claim.decided_at = datetime.now(timezone.utc)
    claim.decided_by_user_id = actor_user_id
    claim.decision_note = decision_note
    # internal_notes is admin-only context. Append rather than
    # overwrite would be nice but adds complexity; for v1 we just
    # overwrite, and if admin needs threaded notes they can dump
    # them as a multi-line string.
    if internal_notes is not None:
        claim.internal_notes = internal_notes


def admin_approve_halal_claim(
    db: Session,
    *,
    claim_id: UUID,
    actor_user_id: UUID,
    payload: HalalClaimApprove,
) -> HalalClaim:
    """Approve a claim and run profile derivation.

    Single transaction:
      1. Validate the claim is in a decidable status.
      2. Stamp decision fields, flip status to APPROVED.
      3. Set claim.expires_at (mirrors the profile's expiry).
      4. Run the profile-derivation service:
         * creates or updates HalalProfile
         * marks any prior source_claim as SUPERSEDED
         * writes a CREATED or UPDATED HalalProfileEvent
         * resets dispute_state to NONE
      5. Commit.

    If derivation fails (e.g. stored questionnaire is somehow
    incomplete), the BadRequestError propagates and the whole
    transaction rolls back — claim stays in its prior state.
    """
    claim = admin_get_halal_claim(db, claim_id)
    if claim.status not in _DECIDABLE_STATUSES:
        raise ConflictError(
            "HALAL_CLAIM_NOT_DECIDABLE",
            (
                f"Claim is in status {claim.status} and cannot be "
                "decided from here."
            ),
        )

    _stamp_decision(
        claim,
        new_status=HalalClaimStatus.APPROVED,
        actor_user_id=actor_user_id,
        decision_note=payload.decision_note,
        internal_notes=payload.internal_notes,
    )
    # Mirror the profile's expires_at onto the claim. The claim is
    # archival once approved, but having expires_at on the row makes
    # the renewal-due reporting easier.
    claim.expires_at = payload.expires_at_override
    db.add(claim)
    db.flush()  # stamp the decision before derivation reads claim.

    profile, event_type = derive_profile_from_approved_claim(
        db,
        claim=claim,
        actor_user_id=actor_user_id,
        validation_tier=payload.validation_tier,
        expires_at=payload.expires_at_override,
        certificate_expires_at=payload.certificate_expires_at,
    )
    # Sync claim.expires_at with what the profile actually got — the
    # service applies the default-12-months when expires_at_override
    # was None, so we read it back.
    claim.expires_at = profile.expires_at
    db.add(claim)

    db.commit()
    db.refresh(claim)
    return claim


def admin_reject_halal_claim(
    db: Session,
    *,
    claim_id: UUID,
    actor_user_id: UUID,
    payload: HalalClaimReject,
) -> HalalClaim:
    """Move PENDING_REVIEW (or NEEDS_MORE_INFO) → REJECTED.

    Does NOT touch the place's HalalProfile — a rejection is the
    absence of a new profile, not a removal of an existing one.
    """
    claim = admin_get_halal_claim(db, claim_id)
    if claim.status not in _DECIDABLE_STATUSES:
        raise ConflictError(
            "HALAL_CLAIM_NOT_DECIDABLE",
            (
                f"Claim is in status {claim.status} and cannot be "
                "decided from here."
            ),
        )
    _stamp_decision(
        claim,
        new_status=HalalClaimStatus.REJECTED,
        actor_user_id=actor_user_id,
        decision_note=payload.decision_note,
        internal_notes=payload.internal_notes,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim


def admin_request_info_halal_claim(
    db: Session,
    *,
    claim_id: UUID,
    actor_user_id: UUID,
    payload: HalalClaimRequestInfo,
) -> HalalClaim:
    """Move PENDING_REVIEW → NEEDS_MORE_INFO.

    The decision_note is the message the owner sees on their claim
    detail. Once in NEEDS_MORE_INFO, the owner regains the ability
    to upload additional attachments (see /me/halal-claims router's
    status guard) and to re-submit (Phase 2 submit handles the
    NEEDS_MORE_INFO→PENDING_REVIEW transition).

    Re-requesting info from a claim already in NEEDS_MORE_INFO is
    allowed — admin might want to update the message.
    """
    claim = admin_get_halal_claim(db, claim_id)
    if claim.status not in _DECIDABLE_STATUSES:
        raise ConflictError(
            "HALAL_CLAIM_NOT_DECIDABLE",
            (
                f"Claim is in status {claim.status} and cannot be "
                "decided from here."
            ),
        )
    _stamp_decision(
        claim,
        new_status=HalalClaimStatus.NEEDS_MORE_INFO,
        actor_user_id=actor_user_id,
        decision_note=payload.decision_note,
        internal_notes=payload.internal_notes,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim


def admin_revoke_halal_claim(
    db: Session,
    *,
    claim_id: UUID,
    actor_user_id: UUID,
    payload: HalalClaimRevoke,
) -> HalalClaim:
    """Pull an APPROVED claim. Marks the linked HalalProfile as
    revoked_at=now.

    Only acts on APPROVED claims. Already-REVOKED returns 200 with
    the existing row (no-op) so a double-click doesn't 409.
    """
    claim = admin_get_halal_claim(db, claim_id)
    if claim.status == HalalClaimStatus.REVOKED.value:
        return claim
    if claim.status != HalalClaimStatus.APPROVED.value:
        raise ConflictError(
            "HALAL_CLAIM_NOT_REVOCABLE",
            (
                "Only APPROVED claims can be revoked. Current "
                f"status: {claim.status}."
            ),
        )

    _stamp_decision(
        claim,
        new_status=HalalClaimStatus.REVOKED,
        actor_user_id=actor_user_id,
        decision_note=payload.decision_note,
        internal_notes=payload.internal_notes,
    )

    profile = db.execute(
        select(HalalProfile).where(HalalProfile.place_id == claim.place_id)
    ).scalar_one_or_none()
    # Only revoke the profile if THIS claim is still the source
    # (i.e. no later claim has superseded). If a later claim is the
    # current source_claim, we don't touch the profile — admin's
    # revoking an old/superseded approval that isn't driving the
    # consumer view anyway.
    if profile is not None and profile.source_claim_id == claim.id:
        revoke_profile(
            db,
            profile=profile,
            actor_user_id=actor_user_id,
            related_claim_id=claim.id,
            reason=payload.decision_note,
        )

    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim
