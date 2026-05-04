"""Profile-derivation service.

When an admin approves a halal claim, the claim's structured_response
gets translated into the flat columns of the place's HalalProfile.
This module owns that translation + the bookkeeping around it
(supersession of older claims, audit-event writes, dispute_state
reset).

Why a separate service module
-----------------------------
The mapping is non-trivial — nested ``MeatSourcing`` objects collapse
into per-meat slaughter columns, the questionnaire is versioned, and
admin's optional overrides (validation_tier, expires_at) layer on
top. Keeping it in one well-tested place means admin endpoint and
any future revoke/restore paths share the exact same derivation
logic.

This module does not commit. Callers (admin halal-claim repo)
control the transaction boundary so a single approve-claim operation
stays atomic — either the claim flips to APPROVED, the profile is
created/updated, AND the audit event lands, or none of it does.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError
from app.modules.halal_claims.enums import HalalClaimStatus
from app.modules.halal_claims.models import HalalClaim
from app.modules.halal_claims.schemas import HalalQuestionnaireResponse
from app.modules.halal_profiles.enums import (
    AlcoholPolicy,
    HalalProfileDisputeState,
    HalalProfileEventType,
    MenuPosture,
    SlaughterMethod,
    ValidationTier,
)
from app.modules.halal_profiles.models import HalalProfile, HalalProfileEvent


# Default profile lifetime when admin doesn't override. 12 months
# matches the typical halal-cert renewal cadence; long enough for the
# owner to plan, short enough that stale profiles don't linger.
_DEFAULT_PROFILE_TTL_DAYS = 365


def _coerce_questionnaire(claim: HalalClaim) -> HalalQuestionnaireResponse:
    """Re-validate the stored draft as a strict response.

    Defends against a claim being approved with an incomplete
    questionnaire (which would mean the submit-time validation was
    bypassed somehow). On failure raises BadRequestError so admin
    sees a clean error rather than a 500.
    """
    if claim.structured_response is None:
        raise BadRequestError(
            "HALAL_CLAIM_QUESTIONNAIRE_INCOMPLETE",
            "Cannot approve a claim with no questionnaire data.",
        )
    try:
        return HalalQuestionnaireResponse.model_validate(
            claim.structured_response
        )
    except ValidationError as exc:
        raise BadRequestError(
            "HALAL_CLAIM_QUESTIONNAIRE_INCOMPLETE",
            "Stored questionnaire is missing required answers.",
            extra=exc.errors(),
        )


def _slaughter_for(meat_sourcing) -> str:
    """Pull a SlaughterMethod from a MeatSourcing or default."""
    if meat_sourcing is None:
        return SlaughterMethod.NOT_SERVED.value
    return meat_sourcing.slaughter_method.value


def _profile_fields_from_questionnaire(
    questionnaire: HalalQuestionnaireResponse,
    *,
    validation_tier: ValidationTier,
    last_verified_at: datetime,
    expires_at: datetime,
    certificate_expires_at: Optional[datetime],
    source_claim_id: UUID,
) -> dict:
    """Map a strict questionnaire + admin's tier choice → profile
    column values. Pure function; no DB.
    """
    return {
        "validation_tier": validation_tier.value,
        "menu_posture": questionnaire.menu_posture.value,
        "has_pork": questionnaire.has_pork,
        "alcohol_policy": questionnaire.alcohol_policy.value,
        "alcohol_in_cooking": questionnaire.alcohol_in_cooking,
        "chicken_slaughter": _slaughter_for(questionnaire.chicken),
        "beef_slaughter": _slaughter_for(questionnaire.beef),
        "lamb_slaughter": _slaughter_for(questionnaire.lamb),
        "goat_slaughter": _slaughter_for(questionnaire.goat),
        "seafood_only": questionnaire.seafood_only,
        "has_certification": questionnaire.has_certification,
        "certifying_body_name": questionnaire.certifying_body_name,
        "certificate_expires_at": certificate_expires_at,
        "caveats": questionnaire.caveats,
        # Always reset dispute state on a fresh approval. A claim
        # approval supersedes any prior dispute against the place;
        # if a new dispute lands later it'll re-flip the state.
        "dispute_state": HalalProfileDisputeState.NONE.value,
        "last_verified_at": last_verified_at,
        "expires_at": expires_at,
        # A new approval clears any prior revoke marker — the admin
        # is explicitly bringing the profile back to current.
        "revoked_at": None,
        "source_claim_id": source_claim_id,
    }


def derive_profile_from_approved_claim(
    db: Session,
    *,
    claim: HalalClaim,
    actor_user_id: UUID,
    validation_tier: ValidationTier,
    expires_at: Optional[datetime] = None,
    certificate_expires_at: Optional[datetime] = None,
) -> tuple[HalalProfile, HalalProfileEventType]:
    """Create-or-update the place's HalalProfile from an approved
    claim. Caller is responsible for the surrounding transaction.

    Returns the profile + the kind of event that was logged
    (CREATED for first profile, UPDATED for subsequent approvals).
    The audit event itself is appended to the session but not
    committed.

    On supersession: the previous source_claim (if any) is marked
    SUPERSEDED so the queue stops surfacing it as the "current"
    approved claim for this place.
    """
    questionnaire = _coerce_questionnaire(claim)

    now = datetime.now(timezone.utc)
    final_expires_at = (
        expires_at or now + timedelta(days=_DEFAULT_PROFILE_TTL_DAYS)
    )

    existing_profile = db.execute(
        select(HalalProfile).where(HalalProfile.place_id == claim.place_id)
    ).scalar_one_or_none()

    if existing_profile is None:
        # First-time profile creation.
        profile = HalalProfile(
            place_id=claim.place_id,
            **_profile_fields_from_questionnaire(
                questionnaire,
                validation_tier=validation_tier,
                last_verified_at=now,
                expires_at=final_expires_at,
                certificate_expires_at=certificate_expires_at,
                source_claim_id=claim.id,
            ),
        )
        db.add(profile)
        # Flush so the profile gets its id for the event row's FK.
        db.flush()
        db.refresh(profile)

        event = HalalProfileEvent(
            profile_id=profile.id,
            event_type=HalalProfileEventType.CREATED.value,
            actor_user_id=actor_user_id,
            related_claim_id=claim.id,
            description=(
                f"Profile created from claim {claim.id} at "
                f"validation_tier={validation_tier.value}."
            ),
        )
        db.add(event)
        return profile, HalalProfileEventType.CREATED

    # Existing profile — update in place. Mark the previous
    # source_claim as SUPERSEDED if there was one and it's not
    # already terminal.
    prior_source_claim_id = existing_profile.source_claim_id
    if prior_source_claim_id and prior_source_claim_id != claim.id:
        prior_claim = db.execute(
            select(HalalClaim).where(HalalClaim.id == prior_source_claim_id)
        ).scalar_one_or_none()
        if prior_claim is not None and prior_claim.status == HalalClaimStatus.APPROVED.value:
            prior_claim.status = HalalClaimStatus.SUPERSEDED.value
            db.add(prior_claim)

    new_fields = _profile_fields_from_questionnaire(
        questionnaire,
        validation_tier=validation_tier,
        last_verified_at=now,
        expires_at=final_expires_at,
        certificate_expires_at=certificate_expires_at,
        source_claim_id=claim.id,
    )
    diff_summary = _diff_summary(existing_profile, new_fields)
    for key, value in new_fields.items():
        setattr(existing_profile, key, value)
    db.add(existing_profile)

    event = HalalProfileEvent(
        profile_id=existing_profile.id,
        event_type=HalalProfileEventType.UPDATED.value,
        actor_user_id=actor_user_id,
        related_claim_id=claim.id,
        description=(
            f"Profile updated from claim {claim.id}. "
            + (diff_summary if diff_summary else "(no field changes)")
        ),
    )
    db.add(event)
    return existing_profile, HalalProfileEventType.UPDATED


def _diff_summary(profile: HalalProfile, new_fields: dict) -> str:
    """Build a 'field: old → new' summary for the audit event.

    Skips fields that didn't change. Skips bookkeeping fields
    (source_claim_id, last_verified_at, expires_at) that change on
    every update and would just spam the description.
    """
    boring = {
        "source_claim_id",
        "last_verified_at",
        "expires_at",
        "revoked_at",
    }
    parts: list[str] = []
    for key, new_val in new_fields.items():
        if key in boring:
            continue
        old_val = getattr(profile, key, None)
        if old_val != new_val:
            parts.append(f"{key}: {old_val} → {new_val}")
    return "; ".join(parts)


def revoke_profile(
    db: Session,
    *,
    profile: HalalProfile,
    actor_user_id: UUID,
    related_claim_id: Optional[UUID],
    reason: Optional[str],
) -> None:
    """Mark a profile revoked. Used when an admin pulls a previously-
    approved claim (fraud discovered, restaurant closed, etc.).

    The profile row stays — consumer-facing reads will check
    revoked_at and either hide the place or render a "no longer
    verified" badge. Caller controls the transaction.
    """
    now = datetime.now(timezone.utc)
    profile.revoked_at = now
    db.add(profile)

    event = HalalProfileEvent(
        profile_id=profile.id,
        event_type=HalalProfileEventType.REVOKED.value,
        actor_user_id=actor_user_id,
        related_claim_id=related_claim_id,
        description=reason or "Profile revoked.",
    )
    db.add(event)
