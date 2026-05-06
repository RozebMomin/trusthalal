"""Admin-side repo for verification-visit review.

Owns the queue list, single-row read, and the two terminal
transitions:

  * ACCEPT — admin agrees with the visit. Promotes the place's
             halal_profile.validation_tier to TRUST_HALAL_VERIFIED if
             a profile exists and isn't already at the top tier.
             Always refreshes the profile's last_verified_at to the
             visit's visited_at (the visit IS the verification, even
             if the tier was already verified). Writes a
             ``VERIFIER_VISIT_ACCEPTED`` row to halal_profile_events
             AND a cross-write to place_events.
  * REJECT — admin disagrees / insufficient evidence. No profile
             change. Cross-writes a place_event so the audit trail
             captures it.

Acceptance only makes sense when the place HAS a HalalProfile. A
verifier can't promote thin air; a place with no profile means no
owner has filed an approved halal claim yet, and the verifier is in
front of the wrong workflow. We surface ``VERIFICATION_VISIT_NO_PROFILE``
so admin can either reject the visit (if the verifier was off-base)
or wait for an owner claim.

The whole acceptance path runs in one transaction. Rejection is
trivially atomic.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.halal_profiles.enums import (
    HalalProfileEventType,
    ValidationTier,
)
from app.modules.halal_profiles.models import HalalProfile, HalalProfileEvent
from app.modules.places.enums import PlaceEventType
from app.modules.places.repo import log_place_event
from app.modules.verifiers.enums import VerificationVisitStatus
from app.modules.verifiers.models import VerificationVisit
from app.modules.verifiers.schemas import VerificationVisitDecision


# Statuses an admin can act on. Once ACCEPTED / REJECTED / WITHDRAWN,
# the row is terminal.
_DECIDABLE_STATUSES: tuple[str, ...] = (
    VerificationVisitStatus.SUBMITTED.value,
    VerificationVisitStatus.UNDER_REVIEW.value,
)


def admin_get_visit(db: Session, *, visit_id: UUID) -> VerificationVisit:
    row = db.execute(
        select(VerificationVisit).where(VerificationVisit.id == visit_id)
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "VERIFICATION_VISIT_NOT_FOUND",
            "Verification visit not found.",
        )
    return row


def admin_list_visits(
    db: Session,
    *,
    status: VerificationVisitStatus | None,
    place_id: UUID | None,
    verifier_user_id: UUID | None,
    limit: int,
    offset: int,
) -> Sequence[VerificationVisit]:
    """Newest-first queue with optional filters.

    Status filter is the most common — admin defaults to SUBMITTED
    to focus on actionable rows. Place + verifier filters support
    "show me everything for this place" and "show me everything
    from this verifier" pivots.
    """
    stmt = select(VerificationVisit).order_by(
        VerificationVisit.submitted_at.desc()
    )
    if status is not None:
        stmt = stmt.where(VerificationVisit.status == status.value)
    if place_id is not None:
        stmt = stmt.where(VerificationVisit.place_id == place_id)
    if verifier_user_id is not None:
        stmt = stmt.where(
            VerificationVisit.verifier_user_id == verifier_user_id
        )
    stmt = stmt.limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def admin_mark_under_review(
    db: Session, *, visit_id: UUID, decided_by_user_id: UUID
) -> VerificationVisit:
    """Move a SUBMITTED visit to UNDER_REVIEW.

    Idempotent against already-UNDER_REVIEW. Anything else (decided
    or withdrawn) gets a 409. Used by the admin UI to claim a row
    so other admins know it's being looked at.
    """
    visit = admin_get_visit(db, visit_id=visit_id)
    if visit.status == VerificationVisitStatus.UNDER_REVIEW.value:
        return visit
    if visit.status != VerificationVisitStatus.SUBMITTED.value:
        raise ConflictError(
            "VERIFICATION_VISIT_NOT_DECIDABLE",
            (
                f"Visit is in status {visit.status}; only SUBMITTED "
                "visits can be claimed for review."
            ),
        )
    visit.status = VerificationVisitStatus.UNDER_REVIEW.value
    db.commit()
    db.refresh(visit)
    return visit


def admin_decide_visit(
    db: Session,
    *,
    visit_id: UUID,
    payload: VerificationVisitDecision,
    decided_by_user_id: UUID,
) -> VerificationVisit:
    """Apply an admin decision (ACCEPTED or REJECTED).

    All effects run inside one transaction so the visit, profile,
    profile-event, and place-events flip atomically.
    """
    decision = payload.decision

    if decision not in (
        VerificationVisitStatus.ACCEPTED,
        VerificationVisitStatus.REJECTED,
    ):
        raise ConflictError(
            "VERIFICATION_VISIT_INVALID_DECISION",
            "Decision must be ACCEPTED or REJECTED.",
        )

    if decision == VerificationVisitStatus.REJECTED and not (
        payload.decision_note and payload.decision_note.strip()
    ):
        raise ConflictError(
            "VERIFICATION_VISIT_REJECT_NOTE_REQUIRED",
            "Rejecting a visit requires a decision_note.",
        )

    visit = admin_get_visit(db, visit_id=visit_id)
    if visit.status not in _DECIDABLE_STATUSES:
        raise ConflictError(
            "VERIFICATION_VISIT_NOT_DECIDABLE",
            (
                f"Visit is in status {visit.status}; only SUBMITTED or "
                "UNDER_REVIEW visits can be decided."
            ),
        )

    now = datetime.now(timezone.utc)

    if decision == VerificationVisitStatus.ACCEPTED:
        _apply_acceptance(
            db,
            visit=visit,
            decided_by_user_id=decided_by_user_id,
            now=now,
        )
    else:
        _apply_rejection(
            db,
            visit=visit,
            decided_by_user_id=decided_by_user_id,
            decision_note=payload.decision_note,
        )

    visit.status = decision.value
    visit.decided_at = now
    visit.decided_by_user_id = decided_by_user_id
    visit.decision_note = payload.decision_note

    db.commit()
    db.refresh(visit)
    return visit


def _apply_acceptance(
    db: Session,
    *,
    visit: VerificationVisit,
    decided_by_user_id: UUID,
    now: datetime,
) -> None:
    """Promote the place's profile + write the audit events.

    Pre-condition: a non-revoked HalalProfile exists for the place.
    Otherwise a 409 (VERIFICATION_VISIT_NO_PROFILE) tells the admin
    to reject the visit instead — verifier visits don't bootstrap
    new profiles.
    """
    profile = db.execute(
        select(HalalProfile).where(
            HalalProfile.place_id == visit.place_id,
            HalalProfile.revoked_at.is_(None),
        )
    ).scalar_one_or_none()

    if profile is None:
        raise ConflictError(
            "VERIFICATION_VISIT_NO_PROFILE",
            (
                "This place has no active halal profile to elevate. "
                "Verifier visits don't bootstrap profiles — wait for "
                "the owner's halal claim to be approved first, or "
                "reject the visit if the verifier is off-base."
            ),
        )

    previous_tier = profile.validation_tier

    # Always refresh last_verified_at — the visit confirms the
    # current data even if the tier was already at the top.
    profile.last_verified_at = visit.visited_at

    if profile.validation_tier != ValidationTier.TRUST_HALAL_VERIFIED.value:
        profile.validation_tier = ValidationTier.TRUST_HALAL_VERIFIED.value
        description = (
            f"Verifier visit accepted (visit_id={visit.id}); tier "
            f"promoted {previous_tier} → "
            f"{ValidationTier.TRUST_HALAL_VERIFIED.value}."
        )
    else:
        description = (
            f"Verifier visit accepted (visit_id={visit.id}); "
            "last_verified_at refreshed (tier already at top)."
        )

    db.add(
        HalalProfileEvent(
            profile_id=profile.id,
            event_type=HalalProfileEventType.VERIFIER_VISIT_ACCEPTED.value,
            actor_user_id=decided_by_user_id,
            related_claim_id=None,  # the visit isn't a claim
            description=description,
        )
    )

    log_place_event(
        db,
        place_id=visit.place_id,
        event_type=PlaceEventType.VERIFIER_VISIT_ACCEPTED,
        actor_user_id=decided_by_user_id,
        message=description,
    )


def _apply_rejection(
    db: Session,
    *,
    visit: VerificationVisit,
    decided_by_user_id: UUID,
    decision_note: str | None,
) -> None:
    """Cross-write a place-event so the place's audit trail captures
    the rejection. No profile changes."""
    log_place_event(
        db,
        place_id=visit.place_id,
        event_type=PlaceEventType.VERIFIER_VISIT_REJECTED,
        actor_user_id=decided_by_user_id,
        message=(
            f"Verifier visit rejected (visit_id={visit.id})"
            + (f": {decision_note}" if decision_note else ".")
        ),
    )
