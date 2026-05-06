"""Persistence helpers for verification visits — verifier-self side.

Phase 8b adds the site-visit submission + lifecycle on top of the
verifier scaffolding from 8a. Repo helpers here cover:

  * ``submit_visit`` — verifier files a new visit. Status starts as
    SUBMITTED; admin acts on it from there.
  * ``get_visit_for_verifier`` — read-with-ownership-check (404
    rather than 403 on rows owned by another verifier).
  * ``list_visits_for_verifier`` — newest-first list of the caller's
    own visits.
  * ``withdraw_visit`` — verifier pulls a SUBMITTED visit before
    admin acts. Idempotent against already-WITHDRAWN; CONFLICT
    once admin engaged.

Profile elevation on ACCEPTED is admin-side and lives in
``app/modules/admin/verifiers/visits_repo.py``.
"""
from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.places.enums import PlaceEventType
from app.modules.places.models import Place
from app.modules.places.repo import log_place_event
from app.modules.verifiers.enums import (
    VerificationVisitStatus,
    VerifierProfileStatus,
)
from app.modules.verifiers.models import VerificationVisit, VerifierProfile
from app.modules.verifiers.schemas import VerificationVisitCreate


# Statuses a verifier can pull on the self-service withdraw path.
# Once admin marks UNDER_REVIEW or decides, withdraw 409s.
_WITHDRAWABLE_STATUSES: tuple[str, ...] = (
    VerificationVisitStatus.SUBMITTED.value,
)


def _ensure_active_verifier(db: Session, *, user_id: UUID) -> VerifierProfile:
    """Fetch the caller's verifier profile and confirm it's ACTIVE.

    A user with role=VERIFIER but no profile (or a SUSPENDED /
    REVOKED profile) gets a 409 — they can't submit visits while
    paused. This is a defense in depth: admin status changes also
    flip the role, but the profile.status is the source of truth.
    """
    profile = db.execute(
        select(VerifierProfile).where(VerifierProfile.user_id == user_id)
    ).scalar_one_or_none()
    if profile is None:
        raise ConflictError(
            "VERIFIER_PROFILE_MISSING",
            (
                "Your verifier profile hasn't been provisioned yet. "
                "Contact Trust Halal if you believe this is a mistake."
            ),
        )
    if profile.status != VerifierProfileStatus.ACTIVE.value:
        raise ConflictError(
            "VERIFIER_PROFILE_NOT_ACTIVE",
            (
                f"Your verifier profile is {profile.status}; new visits "
                "can't be submitted."
            ),
        )
    return profile


def submit_visit(
    db: Session,
    *,
    payload: VerificationVisitCreate,
    verifier_user_id: UUID,
) -> VerificationVisit:
    """Create a SUBMITTED visit for the given place.

    Pre-conditions verified inside the transaction:
      * Caller has an ACTIVE verifier profile (otherwise 409).
      * Place exists and isn't soft-deleted (otherwise 404).
    Cross-writes a ``VERIFIER_VISIT_SUBMITTED`` row to ``place_events``
    so the place's audit trail captures the submission.
    """
    _ensure_active_verifier(db, user_id=verifier_user_id)

    place = db.execute(
        select(Place).where(
            Place.id == payload.place_id,
            Place.is_deleted.is_(False),
        )
    ).scalar_one_or_none()
    if place is None:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found.")

    visit = VerificationVisit(
        verifier_user_id=verifier_user_id,
        place_id=payload.place_id,
        visited_at=payload.visited_at,
        structured_findings=(
            payload.structured_findings.model_dump(mode="json")
            if payload.structured_findings is not None
            else None
        ),
        notes_for_admin=payload.notes_for_admin,
        public_review_url=payload.public_review_url,
        disclosure=payload.disclosure.value,
        disclosure_note=payload.disclosure_note,
    )
    db.add(visit)
    db.flush()  # need visit.id for the place-event message

    log_place_event(
        db,
        place_id=payload.place_id,
        event_type=PlaceEventType.VERIFIER_VISIT_SUBMITTED,
        actor_user_id=verifier_user_id,
        message=f"Verifier visit submitted (visit_id={visit.id}).",
    )
    db.commit()
    db.refresh(visit)
    return visit


def get_visit_for_verifier(
    db: Session, *, visit_id: UUID, verifier_user_id: UUID
) -> VerificationVisit:
    """Read with ownership check.

    Raises NotFoundError when the visit doesn't exist OR belongs to
    another verifier — same posture as ``/me/halal-claims/{id}`` so
    we don't leak existence.
    """
    row = db.execute(
        select(VerificationVisit).where(
            VerificationVisit.id == visit_id,
            VerificationVisit.verifier_user_id == verifier_user_id,
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "VERIFICATION_VISIT_NOT_FOUND",
            "Verification visit not found.",
        )
    return row


def list_visits_for_verifier(
    db: Session,
    *,
    verifier_user_id: UUID,
    status: VerificationVisitStatus | None,
    limit: int,
    offset: int,
) -> Sequence[VerificationVisit]:
    """Newest-first list scoped to the caller. Optional status filter
    lets the verifier UI separate "in flight" from "decided" visits."""
    stmt = (
        select(VerificationVisit)
        .where(VerificationVisit.verifier_user_id == verifier_user_id)
        .order_by(VerificationVisit.submitted_at.desc())
    )
    if status is not None:
        stmt = stmt.where(VerificationVisit.status == status.value)
    stmt = stmt.limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def withdraw_visit(
    db: Session, *, visit_id: UUID, verifier_user_id: UUID
) -> VerificationVisit:
    """Verifier withdraws a SUBMITTED visit before admin acts.

    Idempotent against already-WITHDRAWN; CONFLICT for any other
    status. Note: the model uses ``VerificationVisitStatus`` which
    doesn't (yet) define WITHDRAWN as a status — verifiers
    historically had no way to retract a submission. Phase 8b adds
    the value to the StrEnum and to the column's
    ``sa.Enum(native_enum=False)`` allow-list. SQLAlchemy enforces
    via the Python-side validator since native_enum=False, so no
    DB migration is required.
    """
    visit = get_visit_for_verifier(
        db, visit_id=visit_id, verifier_user_id=verifier_user_id
    )

    if visit.status == VerificationVisitStatus.WITHDRAWN.value:
        return visit

    if visit.status not in _WITHDRAWABLE_STATUSES:
        raise ConflictError(
            "VERIFICATION_VISIT_NOT_WITHDRAWABLE",
            (
                f"Visit is in status {visit.status}; only SUBMITTED "
                "visits can be withdrawn."
            ),
        )

    visit.status = VerificationVisitStatus.WITHDRAWN.value
    db.commit()
    db.refresh(visit)
    return visit
