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

from app.core.analytics import track
from app.core.exceptions import ConflictError, NotFoundError
from app.modules.halal_profiles.enums import (
    AlcoholPolicy,
    HalalProfileEventType,
    MenuPosture,
    SlaughterMethod,
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


# Verifier finding → profile slaughter column. The verifier records the
# observable method (hand vs machine) so it maps 1:1 to the neutral profile
# vocabulary. ZABIHAH/NOT_ZABIHAH are legacy values from older visits, folded
# onto the observable equivalents. UNSURE has no profile analogue, so it lands
# on NOT_SERVED (the "no confirmed halal method" column value).
_FINDING_TO_SLAUGHTER = {
    "HAND_CUT": SlaughterMethod.HAND_CUT,
    "MACHINE_CUT": SlaughterMethod.MACHINE_CUT,
    "ZABIHAH": SlaughterMethod.HAND_CUT,
    "NOT_ZABIHAH": SlaughterMethod.MACHINE_CUT,
    "NOT_SERVED": SlaughterMethod.NOT_SERVED,
    "UNSURE": SlaughterMethod.NOT_SERVED,
}
# The label the verifier flow writes the "menu fully halal" answer under.
_MENU_CHECK_KEY = "Menu is fully halal"
_CERT_CHECK_KEY = "Halal cert visible on premises"
_ALCOHOL_CHECK_KEY = "Alcohol on premises"


# Meat key → profile column, for the four tracked meats.
_MEAT_COLUMNS = (
    ("CHICKEN", "chicken_slaughter"),
    ("BEEF", "beef_slaughter"),
    ("LAMB", "lamb_slaughter"),
    ("GOAT", "goat_slaughter"),
)


# Each "_opt" helper returns None when the visit didn't record that field, so
# a refresh can update *only* what was observed and leave the rest intact
# (a visit that only touched chicken must not wipe a previously-recorded beef).
def _menu_posture_opt(checks: dict, menu_partial: dict | None) -> MenuPosture | None:
    ans = checks.get(_MENU_CHECK_KEY)
    if ans == "YES":
        return MenuPosture.FULLY_HALAL
    if ans == "PARTIAL":
        scope = (menu_partial or {}).get("scope")
        if scope == "ON_REQUEST":
            return MenuPosture.HALAL_UPON_REQUEST
        return MenuPosture.HALAL_OPTIONS_ADVERTISED
    return None


def _alcohol_opt(checks: dict) -> AlcoholPolicy | None:
    ans = checks.get(_ALCOHOL_CHECK_KEY)
    if ans == "YES":
        return AlcoholPolicy.FULL_BAR
    if ans == "PARTIAL":
        return AlcoholPolicy.BEER_AND_WINE_ONLY
    if ans == "NO":
        return AlcoholPolicy.NONE
    return None


def _cert_opt(checks: dict) -> bool | None:
    ans = checks.get(_CERT_CHECK_KEY)
    return None if ans is None else ans == "YES"


def _meat_opt(meat_checks: dict, key: str) -> str | None:
    mc = meat_checks.get(key)
    if not isinstance(mc, dict):
        return None
    finding = mc.get("finding")
    if finding is None:
        return None
    return _FINDING_TO_SLAUGHTER.get(finding, SlaughterMethod.NOT_SERVED).value


def _bootstrap_profile_from_visit(
    db: Session,
    *,
    visit: VerificationVisit,
    decided_by_user_id: UUID,
) -> HalalProfile:
    """Create a halal profile for a place that had none, from the visit's
    observations. Community-verification path: a verifier confirming a place
    in person is enough to establish its profile (there may be no owner). No
    ``source_claim_id`` — the absence of a claim is what marks it
    verifier-established; the trust history's VERIFIER_VISIT row carries the
    who/when. Unrecorded fields fall back to sensible defaults.
    """
    obs = visit.observations or {}
    checks = obs.get("checks") or {}
    meat_checks = obs.get("meat_checks") or {}

    profile = HalalProfile(
        place_id=visit.place_id,
        source_claim_id=None,
        validation_tier=ValidationTier.TRUST_HALAL_VERIFIED.value,
        menu_posture=(
            _menu_posture_opt(checks, obs.get("menu_partial"))
            or MenuPosture.HALAL_OPTIONS_ADVERTISED
        ).value,
        alcohol_policy=(_alcohol_opt(checks) or AlcoholPolicy.NONE).value,
        chicken_slaughter=_meat_opt(meat_checks, "CHICKEN")
        or SlaughterMethod.NOT_SERVED.value,
        beef_slaughter=_meat_opt(meat_checks, "BEEF") or SlaughterMethod.NOT_SERVED.value,
        lamb_slaughter=_meat_opt(meat_checks, "LAMB") or SlaughterMethod.NOT_SERVED.value,
        goat_slaughter=_meat_opt(meat_checks, "GOAT") or SlaughterMethod.NOT_SERVED.value,
        has_certification=bool(_cert_opt(checks)),
        last_verified_at=visit.visited_at,
    )
    db.add(profile)
    db.flush()  # assign profile.id for the event below
    db.add(
        HalalProfileEvent(
            profile_id=profile.id,
            event_type=HalalProfileEventType.CREATED.value,
            actor_user_id=decided_by_user_id,
            related_claim_id=None,
            description="Profile established from an accepted verifier visit.",
        )
    )
    return profile


def _refresh_profile_from_visit(profile: HalalProfile, visit: VerificationVisit) -> None:
    """Re-apply a verifier's fresh observations onto an existing
    *verifier-established* profile — only the fields the visit actually
    recorded, so a partial visit can't wipe earlier findings. Owner-claim
    profiles are never touched here (a visit confirms the owner's data, it
    doesn't overwrite it)."""
    obs = visit.observations or {}
    checks = obs.get("checks") or {}
    meat_checks = obs.get("meat_checks") or {}

    mp = _menu_posture_opt(checks, obs.get("menu_partial"))
    if mp is not None:
        profile.menu_posture = mp.value
    al = _alcohol_opt(checks)
    if al is not None:
        profile.alcohol_policy = al.value
    cert = _cert_opt(checks)
    if cert is not None:
        profile.has_certification = cert
    for key, attr in _MEAT_COLUMNS:
        v = _meat_opt(meat_checks, key)
        if v is not None:
            setattr(profile, attr, v)


def _apply_acceptance(
    db: Session,
    *,
    visit: VerificationVisit,
    decided_by_user_id: UUID,
    now: datetime,
) -> None:
    """Promote (or establish) the place's profile + write the audit events.

    If the place already has a non-revoked profile, the visit elevates it to
    TRUST_HALAL_VERIFIED and refreshes last_verified_at. If it has none, the
    visit *establishes* one from its observations — community verification
    doesn't wait on an owner claim.
    """
    profile = db.execute(
        select(HalalProfile).where(
            HalalProfile.place_id == visit.place_id,
            HalalProfile.revoked_at.is_(None),
        )
    ).scalar_one_or_none()

    bootstrapped = False
    if profile is None:
        profile = _bootstrap_profile_from_visit(
            db, visit=visit, decided_by_user_id=decided_by_user_id
        )
        bootstrapped = True
    elif profile.source_claim_id is None:
        # Verifier-established profile (no owner claim behind it): let this
        # fresh visit update the observed data — per-meat method, menu posture,
        # alcohol, cert — so re-verifying actually improves the profile instead
        # of only bumping the timestamp. Owner-claim profiles are left as-is.
        _refresh_profile_from_visit(profile, visit)

    previous_tier = profile.validation_tier

    # Always refresh last_verified_at — the visit confirms the
    # current data even if the tier was already at the top.
    profile.last_verified_at = visit.visited_at

    if bootstrapped:
        description = (
            f"Verifier visit accepted (visit_id={visit.id}); profile "
            f"established at {ValidationTier.TRUST_HALAL_VERIFIED.value} from "
            "the visit."
        )
    elif profile.validation_tier != ValidationTier.TRUST_HALAL_VERIFIED.value:
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
    track(
        "verifier_visit_filed",
        distinct_id=visit.verifier_user_id,
        properties={"place_id": str(visit.place_id), "visit_id": str(visit.id)},
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
