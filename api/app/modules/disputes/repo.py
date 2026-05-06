"""Repository functions for the consumer-dispute flow.

Disputes are signed-in consumer reports that a place's halal profile
is wrong. Two surfaces share this module:

  * ``/places/{place_id}/disputes`` — public file path
    (auth required; the `reporter_user_id` comes from the session).
  * ``/me/disputes`` — reporter's own disputes (list, get, withdraw,
    upload attachments).

The admin-side counterparts live in ``app.modules.admin.disputes``
and call into this module's helpers for the shared transitions
(open, resolve) so the profile-state side effects stay in one place.

Lifecycle
---------
The status machine:

    OPEN ──> OWNER_RECONCILING ──> ADMIN_REVIEWING ──> RESOLVED_*
              ↑                                          ↑
              │                                          │
              └─ admin moves here when an owner needs    └─ terminal
                 to file a RECONCILIATION halal_claim       (UPHELD or
                                                             DISMISSED)
    OPEN ──> WITHDRAWN  (consumer-driven; only OPEN disputes can
                         be withdrawn — once admin starts reviewing
                         the dispute is on a track to resolution)

Side effects on transitions
---------------------------
* On OPEN (file): flip the place's HalalProfile.dispute_state to
  DISPUTED, write a HalalProfileEvent (DISPUTE_OPENED), cross-write
  a place_event (DISPUTE_OPENED). If the place has no profile yet
  (rare — disputes typically come after a halal posture is live),
  the dispute is still recorded but no profile flip happens.
* On RESOLVED_* (admin decision): flip the profile.dispute_state
  back to NONE, write a HalalProfileEvent (DISPUTE_RESOLVED),
  cross-write a place_event (DISPUTE_RESOLVED). The actual data
  correction (if UPHELD) is a separate owner-driven RECONCILIATION
  halal_claim — this resolution doesn't change the profile's
  attribute columns, only its dispute_state badge.
* WITHDRAWN: same dispute_state flip back to NONE if no other
  open disputes exist on the place. Slight subtlety: a place could
  have two consumers dispute it independently. We don't currently
  count concurrent disputes — flipping back to NONE on either
  resolution is acceptable for v1 since multi-dispute is rare and
  the profile-state badge is just a UX hint, not an audit record.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.modules.disputes.enums import DisputeStatus, DisputedAttribute
from app.modules.disputes.models import ConsumerDispute
from app.modules.disputes.schemas import ConsumerDisputeCreate
from app.modules.halal_profiles.enums import (
    HalalProfileDisputeState,
    HalalProfileEventType,
)
from app.modules.halal_profiles.models import HalalProfile, HalalProfileEvent
from app.modules.places.enums import PlaceEventType
from app.modules.places.models import Place
from app.modules.places.repo import log_place_event


# Statuses where the consumer can still take action on their own
# dispute (withdraw, upload more attachments). Once admin or owner
# touches it, the dispute is locked from the consumer side — they
# can read but not modify.
_REPORTER_EDITABLE_STATUSES: tuple[str, ...] = (DisputeStatus.OPEN.value,)

# Statuses an admin can resolve from. Resolving requires the dispute
# to be in OPEN, OWNER_RECONCILING, or ADMIN_REVIEWING — terminal
# states (RESOLVED_*, WITHDRAWN) reject.
_ADMIN_RESOLVABLE_STATUSES: tuple[str, ...] = (
    DisputeStatus.OPEN.value,
    DisputeStatus.OWNER_RECONCILING.value,
    DisputeStatus.ADMIN_REVIEWING.value,
)


# ---------------------------------------------------------------------------
# Internal helpers — profile-state transitions
# ---------------------------------------------------------------------------


def _flip_profile_to_disputed(
    db: Session,
    *,
    place_id: UUID,
    dispute: ConsumerDispute,
    actor_user_id: Optional[UUID],
) -> Optional[HalalProfile]:
    """Set the place's profile to DISPUTED + write the audit event.

    Returns the profile if one exists (for the caller to attach the
    contested_profile_id), or ``None`` when the place has no profile
    yet. Writing the dispute is allowed in either case — a dispute
    against a place with no live halal profile is unusual but not
    invalid.
    """
    profile = db.execute(
        select(HalalProfile).where(HalalProfile.place_id == place_id)
    ).scalar_one_or_none()
    if profile is None:
        return None

    # Only flip if not already DISPUTED. Idempotent on concurrent
    # disputes — the badge is a single bit at the profile level.
    if profile.dispute_state != HalalProfileDisputeState.DISPUTED.value:
        profile.dispute_state = HalalProfileDisputeState.DISPUTED.value
        db.add(profile)

    db.add(
        HalalProfileEvent(
            profile_id=profile.id,
            event_type=HalalProfileEventType.DISPUTE_OPENED.value,
            actor_user_id=actor_user_id,
            related_dispute_id=dispute.id,
            description=(
                f"Consumer dispute filed: {dispute.disputed_attribute}."
            ),
        )
    )
    return profile


def _maybe_clear_profile_dispute_state(
    db: Session,
    *,
    place_id: UUID,
    dispute: ConsumerDispute,
    actor_user_id: Optional[UUID],
    description: str,
) -> None:
    """Flip profile.dispute_state back to NONE if no other active
    disputes remain on the place + write a DISPUTE_RESOLVED event.

    Called from both admin-resolve and consumer-withdraw paths.
    Counting "other active disputes" excludes the dispute being
    resolved/withdrawn (since the caller has already updated its
    status). If anything else is still OPEN / OWNER_RECONCILING /
    ADMIN_REVIEWING, leave the badge on.
    """
    profile = db.execute(
        select(HalalProfile).where(HalalProfile.place_id == place_id)
    ).scalar_one_or_none()
    if profile is None:
        return

    other_active = db.execute(
        select(ConsumerDispute.id)
        .where(
            ConsumerDispute.place_id == place_id,
            ConsumerDispute.id != dispute.id,
            ConsumerDispute.status.in_(
                [
                    DisputeStatus.OPEN.value,
                    DisputeStatus.OWNER_RECONCILING.value,
                    DisputeStatus.ADMIN_REVIEWING.value,
                ]
            ),
        )
        .limit(1)
    ).first()

    if other_active is None:
        profile.dispute_state = HalalProfileDisputeState.NONE.value
        db.add(profile)

    db.add(
        HalalProfileEvent(
            profile_id=profile.id,
            event_type=HalalProfileEventType.DISPUTE_RESOLVED.value,
            actor_user_id=actor_user_id,
            related_dispute_id=dispute.id,
            description=description,
        )
    )


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def _get_dispute_or_404(db: Session, dispute_id: UUID) -> ConsumerDispute:
    dispute = db.execute(
        select(ConsumerDispute).where(ConsumerDispute.id == dispute_id)
    ).scalar_one_or_none()
    if dispute is None:
        raise NotFoundError("CONSUMER_DISPUTE_NOT_FOUND", "Dispute not found.")
    return dispute


def get_dispute_for_reporter(
    db: Session, *, dispute_id: UUID, reporter_user_id: UUID
) -> ConsumerDispute:
    """Reporter-only fetch. 404 unknown id; 403 not-yours.

    Same posture as the halal-claim ownership check — we surface 403
    when the id resolves but belongs to a different reporter, so the
    client can distinguish "wrong url" from "not authorized."
    """
    dispute = _get_dispute_or_404(db, dispute_id)
    if dispute.reporter_user_id != reporter_user_id:
        raise ForbiddenError(
            "CONSUMER_DISPUTE_FORBIDDEN",
            "You don't have access to this dispute.",
        )
    return dispute


def list_disputes_for_reporter(
    db: Session,
    *,
    reporter_user_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> Sequence[ConsumerDispute]:
    """The signed-in reporter's own disputes, newest first."""
    return (
        db.execute(
            select(ConsumerDispute)
            .where(ConsumerDispute.reporter_user_id == reporter_user_id)
            .order_by(ConsumerDispute.submitted_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )


def admin_get_dispute(db: Session, dispute_id: UUID) -> ConsumerDispute:
    """Admin fetch — no ownership gate. 404 on missing id."""
    return _get_dispute_or_404(db, dispute_id)


def admin_list_disputes(
    db: Session,
    *,
    status: Optional[str] = None,
    place_id: Optional[UUID] = None,
    reporter_user_id: Optional[UUID] = None,
    limit: int = 50,
    offset: int = 0,
) -> Sequence[ConsumerDispute]:
    """Admin queue list with optional filters. Newest first.

    Default callsite passes ``status='OPEN'`` for the work queue;
    the per-place and per-reporter filters power the place detail
    and "are we seeing repeat offenders" investigations respectively.
    """
    query = select(ConsumerDispute).order_by(
        ConsumerDispute.submitted_at.desc()
    )
    if status is not None:
        query = query.where(ConsumerDispute.status == status)
    if place_id is not None:
        query = query.where(ConsumerDispute.place_id == place_id)
    if reporter_user_id is not None:
        query = query.where(ConsumerDispute.reporter_user_id == reporter_user_id)
    query = query.limit(limit).offset(offset)
    return db.execute(query).scalars().all()


# ---------------------------------------------------------------------------
# Mutations — consumer-side
# ---------------------------------------------------------------------------


def file_dispute(
    db: Session,
    *,
    place_id: UUID,
    reporter_user_id: UUID,
    payload: ConsumerDisputeCreate,
) -> ConsumerDispute:
    """Consumer files a new dispute on a place.

    Authorization: any signed-in user can file. Rate limit lives at
    the route layer.

    Guards:
      * Place exists and isn't soft-deleted (same posture as the
        public ``/places/{id}`` read — disputes against deleted
        places are useless).
      * Duplicate guard: caller already has an OPEN dispute on the
        same (place, attribute). Spamming the same complaint should
        push the consumer to update the existing one rather than
        firing five copies.

    Side effect: flips the place's HalalProfile.dispute_state to
    DISPUTED (if a profile exists), writes the audit events.
    """
    place = db.execute(
        select(Place).where(
            Place.id == place_id, Place.is_deleted.is_(False)
        )
    ).scalar_one_or_none()
    if place is None:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found.")

    duplicate = db.execute(
        select(ConsumerDispute.id).where(
            ConsumerDispute.place_id == place_id,
            ConsumerDispute.reporter_user_id == reporter_user_id,
            ConsumerDispute.disputed_attribute == payload.disputed_attribute.value,
            ConsumerDispute.status == DisputeStatus.OPEN.value,
        )
    ).first()
    if duplicate is not None:
        raise ConflictError(
            "CONSUMER_DISPUTE_DUPLICATE",
            (
                "You already have an open dispute on this place for "
                "this attribute. Update the existing one instead of "
                "filing a duplicate."
            ),
        )

    dispute = ConsumerDispute(
        place_id=place_id,
        reporter_user_id=reporter_user_id,
        status=DisputeStatus.OPEN.value,
        disputed_attribute=payload.disputed_attribute.value,
        description=payload.description,
    )
    db.add(dispute)
    db.flush()  # claim an id so the events can FK back to it.

    profile = _flip_profile_to_disputed(
        db,
        place_id=place_id,
        dispute=dispute,
        actor_user_id=reporter_user_id,
    )
    if profile is not None:
        dispute.contested_profile_id = profile.id
        db.add(dispute)

    log_place_event(
        db,
        place_id=place_id,
        event_type=PlaceEventType.DISPUTE_OPENED,
        actor_user_id=reporter_user_id,
        message=(
            f"Consumer dispute filed: {payload.disputed_attribute.value}."
        ),
    )

    db.commit()
    db.refresh(dispute)
    return dispute


def withdraw_dispute(
    db: Session,
    *,
    dispute_id: UUID,
    reporter_user_id: UUID,
) -> ConsumerDispute:
    """Reporter withdraws their own dispute.

    Only OPEN disputes can be withdrawn. Once admin or owner has
    touched it (OWNER_RECONCILING / ADMIN_REVIEWING / RESOLVED_*),
    the consumer can no longer pull it back — we want a paper trail
    on every dispute that admin spent time on.

    Side effect: flips profile.dispute_state back to NONE if no
    other active disputes remain on the place.
    """
    dispute = get_dispute_for_reporter(
        db, dispute_id=dispute_id, reporter_user_id=reporter_user_id
    )
    if dispute.status not in _REPORTER_EDITABLE_STATUSES:
        raise ConflictError(
            "CONSUMER_DISPUTE_NOT_WITHDRAWABLE",
            (
                f"This dispute is in status {dispute.status} and can "
                "no longer be withdrawn."
            ),
        )

    dispute.status = DisputeStatus.WITHDRAWN.value
    dispute.decided_at = datetime.now(timezone.utc)
    db.add(dispute)

    _maybe_clear_profile_dispute_state(
        db,
        place_id=dispute.place_id,
        dispute=dispute,
        actor_user_id=reporter_user_id,
        description="Dispute withdrawn by reporter.",
    )
    log_place_event(
        db,
        place_id=dispute.place_id,
        event_type=PlaceEventType.DISPUTE_RESOLVED,
        actor_user_id=reporter_user_id,
        message="Consumer withdrew their dispute.",
    )

    db.commit()
    db.refresh(dispute)
    return dispute


# ---------------------------------------------------------------------------
# Mutations — admin-side
# ---------------------------------------------------------------------------


def admin_resolve_dispute(
    db: Session,
    *,
    dispute_id: UUID,
    actor_user_id: UUID,
    decision: DisputeStatus,
    admin_decision_note: Optional[str],
) -> ConsumerDispute:
    """Admin resolves a dispute as RESOLVED_UPHELD or RESOLVED_DISMISSED.

    Other ``decision`` values are rejected at the route's Pydantic
    layer; we re-check here defensively.

    Side effect: flips profile.dispute_state back to NONE if no
    other active disputes remain on the place. The actual data
    correction (if UPHELD) happens via a separate owner-driven
    RECONCILIATION halal_claim — this endpoint just clears the
    dispute badge.
    """
    if decision not in (
        DisputeStatus.RESOLVED_UPHELD,
        DisputeStatus.RESOLVED_DISMISSED,
    ):
        raise ConflictError(
            "CONSUMER_DISPUTE_BAD_DECISION",
            "Decision must be RESOLVED_UPHELD or RESOLVED_DISMISSED.",
        )

    dispute = _get_dispute_or_404(db, dispute_id)
    if dispute.status not in _ADMIN_RESOLVABLE_STATUSES:
        raise ConflictError(
            "CONSUMER_DISPUTE_NOT_RESOLVABLE",
            (
                f"Dispute is in status {dispute.status} and can no "
                "longer be resolved."
            ),
        )

    dispute.status = decision.value
    dispute.decided_at = datetime.now(timezone.utc)
    dispute.decided_by_user_id = actor_user_id
    dispute.admin_decision_note = admin_decision_note
    db.add(dispute)

    headline = (
        "Dispute upheld"
        if decision == DisputeStatus.RESOLVED_UPHELD
        else "Dispute dismissed"
    )
    note = (admin_decision_note or "").strip()
    full_description = f"{headline}. {note}" if note else f"{headline}."

    _maybe_clear_profile_dispute_state(
        db,
        place_id=dispute.place_id,
        dispute=dispute,
        actor_user_id=actor_user_id,
        description=full_description,
    )
    log_place_event(
        db,
        place_id=dispute.place_id,
        event_type=PlaceEventType.DISPUTE_RESOLVED,
        actor_user_id=actor_user_id,
        message=full_description,
    )

    db.commit()
    db.refresh(dispute)
    return dispute


def admin_request_owner_reconciliation(
    db: Session,
    *,
    dispute_id: UUID,
    actor_user_id: UUID,
    admin_decision_note: Optional[str],
) -> ConsumerDispute:
    """Admin moves a dispute to OWNER_RECONCILING.

    Use this when the dispute is plausible enough that the owner
    needs to respond — typically by filing a RECONCILIATION
    halal_claim. The `admin_decision_note` is admin-only context
    (the owner notification path is currently a TODO; today we just
    park the status until the owner files reconciliation).

    Idempotent on a dispute already in OWNER_RECONCILING.
    """
    dispute = _get_dispute_or_404(db, dispute_id)
    if dispute.status == DisputeStatus.OWNER_RECONCILING.value:
        return dispute
    if dispute.status not in (
        DisputeStatus.OPEN.value,
        DisputeStatus.ADMIN_REVIEWING.value,
    ):
        raise ConflictError(
            "CONSUMER_DISPUTE_BAD_TRANSITION",
            (
                f"Dispute in status {dispute.status} can't move to "
                "OWNER_RECONCILING."
            ),
        )

    dispute.status = DisputeStatus.OWNER_RECONCILING.value
    if admin_decision_note is not None:
        dispute.admin_decision_note = admin_decision_note
    db.add(dispute)
    db.commit()
    db.refresh(dispute)
    return dispute
