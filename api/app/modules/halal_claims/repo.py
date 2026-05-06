"""Repository functions for the owner-side halal-claim flow.

Handles:
  * Creating a DRAFT claim (with org-membership + place-ownership
    authorization gates).
  * Listing the caller's claims.
  * Looking up a single claim with ownership check.
  * Patching a DRAFT (questionnaire updates).
  * Submitting a DRAFT for admin review (DRAFT → PENDING_REVIEW),
    with strict validation that the questionnaire is complete.

Phase 3 will add admin-side ops (approve / reject / request-info)
in a separate ``app.modules.admin.halal_claims.repo`` module.

Authorization model
-------------------
A user can act on a halal claim if and only if all three are true:

  1. The claim's ``organization_id`` is one the user is an ACTIVE
     member of (``OrganizationMember.status = 'ACTIVE'``).
  2. The org owns the place at the time of action — i.e., there's
     an ``ACTIVE`` PlaceOwner row for ``(place_id, organization_id)``.
  3. The org is in a status eligible to sponsor (UNDER_REVIEW or
     VERIFIED). DRAFT or REJECTED orgs can't sponsor.

Lookups that 403 vs 404 follow the same pattern as ownership_requests:
unknown id is 404, known-but-not-yours is 403.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional, Sequence
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from app.modules.halal_claims.enums import (
    HalalClaimEventType,
    HalalClaimStatus,
    HalalClaimType,
)
from app.modules.halal_claims.models import HalalClaim, HalalClaimEvent
from app.modules.halal_claims.schemas import (
    HalalQuestionnaireDraft,
    HalalQuestionnaireResponse,
    MyHalalClaimBatchCreate,
    MyHalalClaimCreate,
    MyHalalClaimPatch,
)
from app.modules.organizations.enums import OrganizationStatus
from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.places.enums import PlaceEventType
from app.modules.places.models import Place
from app.modules.places.repo import log_place_event


# ---------------------------------------------------------------------------
# Audit-trail helper
# ---------------------------------------------------------------------------


def log_halal_claim_event(
    db: Session,
    *,
    claim_id: UUID,
    event_type: HalalClaimEventType,
    actor_user_id: Optional[UUID] = None,
    description: Optional[str] = None,
) -> None:
    """Append a HalalClaimEvent row. Caller controls the transaction.

    Mirrors ``log_place_event`` in shape: stash the ORM row on the
    session and let the surrounding business operation commit. Single
    place to evolve if we ever add structured payloads beyond the
    ``description`` text column.
    """
    db.add(
        HalalClaimEvent(
            claim_id=claim_id,
            event_type=event_type.value,
            actor_user_id=actor_user_id,
            description=description,
        )
    )


# ---------------------------------------------------------------------------
# Authorization helpers
# ---------------------------------------------------------------------------


# Statuses an organization must be in to sponsor a halal claim.
# Mirrors the same gate the ownership-request flow enforces — DRAFT
# orgs are still pending the owner's own admin-review submission and
# can't be used to claim halal posture on a place yet.
_ELIGIBLE_ORG_STATUSES: tuple[str, ...] = (
    OrganizationStatus.UNDER_REVIEW.value,
    OrganizationStatus.VERIFIED.value,
)


def _assert_user_can_act_on_org(
    db: Session, *, user_id: UUID, organization_id: UUID
) -> Organization:
    """Membership + status gate.

    Returns the org row on success. Raises:

    * ``ForbiddenError("HALAL_CLAIM_ORG_NOT_MEMBER")`` if the user
      isn't an ACTIVE member.
    * ``ConflictError("HALAL_CLAIM_ORG_NOT_ELIGIBLE")`` if the org
      exists but isn't UNDER_REVIEW or VERIFIED.
    * ``NotFoundError("HALAL_CLAIM_ORG_NOT_FOUND")`` if the org
      doesn't exist.
    """
    org = db.execute(
        select(Organization).where(Organization.id == organization_id)
    ).scalar_one_or_none()
    if org is None:
        raise NotFoundError(
            "HALAL_CLAIM_ORG_NOT_FOUND",
            "That organization doesn't exist.",
        )

    is_member = db.execute(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user_id,
            OrganizationMember.status == "ACTIVE",
        )
    ).first()
    if is_member is None:
        raise ForbiddenError(
            "HALAL_CLAIM_ORG_NOT_MEMBER",
            "You are not an active member of that organization.",
        )

    if org.status not in _ELIGIBLE_ORG_STATUSES:
        raise ConflictError(
            "HALAL_CLAIM_ORG_NOT_ELIGIBLE",
            (
                "Organizations must be under review or verified before "
                "they can sponsor a halal claim. Submit your "
                "organization for review first."
            ),
        )
    return org


def _assert_org_owns_place(
    db: Session, *, organization_id: UUID, place_id: UUID
) -> None:
    """Place-ownership gate.

    Raises:
      * ``NotFoundError("PLACE_NOT_FOUND")`` if the place is missing
        or soft-deleted.
      * ``ConflictError("HALAL_CLAIM_NOT_PLACE_OWNER")`` if the org
        doesn't have an ACTIVE PlaceOwner row for the place.
    """
    place = db.execute(
        select(Place).where(
            Place.id == place_id, Place.is_deleted.is_(False)
        )
    ).scalar_one_or_none()
    if place is None:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found.")

    owner_link = db.execute(
        select(PlaceOwner.id).where(
            PlaceOwner.place_id == place_id,
            PlaceOwner.organization_id == organization_id,
            PlaceOwner.status == "ACTIVE",
        )
    ).first()
    if owner_link is None:
        raise ConflictError(
            "HALAL_CLAIM_NOT_PLACE_OWNER",
            (
                "Your organization isn't a recognized owner of this "
                "place. Submit an ownership claim first."
            ),
        )


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def _user_can_view(claim: HalalClaim, user_id: UUID) -> bool:
    """True when the user submitted the claim. Membership-via-org
    isn't sufficient on its own — different members of the same org
    can each submit their own claims and shouldn't necessarily see
    each other's drafts. Phase 2 keeps this strict; we can relax it
    later if real workflows demand it."""
    return claim.submitted_by_user_id == user_id


def get_halal_claim_for_user(
    db: Session,
    *,
    claim_id: UUID,
    user_id: UUID,
) -> HalalClaim:
    """Single-claim lookup with ownership check.

    Splits 404 (truly unknown id) from 403 (id exists but isn't
    yours). The 403 is mildly informative — the caller learns the
    id refers to a real claim — but cookie-auth users guessing
    UUIDs is not a meaningful threat surface.
    """
    claim = db.execute(
        select(HalalClaim).where(HalalClaim.id == claim_id)
    ).scalar_one_or_none()
    if claim is None:
        raise NotFoundError(
            "HALAL_CLAIM_NOT_FOUND", "Halal claim not found."
        )
    if not _user_can_view(claim, user_id):
        raise ForbiddenError(
            "HALAL_CLAIM_FORBIDDEN",
            "You don't have access to this halal claim.",
        )
    return claim


def list_halal_claim_events_for_user(
    db: Session,
    *,
    claim_id: UUID,
    user_id: UUID,
) -> Sequence[HalalClaimEvent]:
    """Audit timeline for a claim, oldest first.

    Reuses ``get_halal_claim_for_user`` so the same 404/403 split
    applies — an unauthenticated peek at someone else's timeline
    can't slip through here.
    """
    get_halal_claim_for_user(db, claim_id=claim_id, user_id=user_id)
    return (
        db.execute(
            select(HalalClaimEvent)
            .where(HalalClaimEvent.claim_id == claim_id)
            .order_by(HalalClaimEvent.created_at)
        )
        .scalars()
        .all()
    )


def list_halal_claims_for_user(
    db: Session,
    *,
    user_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> Sequence[HalalClaim]:
    """List the caller's claims, newest first."""
    return (
        db.execute(
            select(HalalClaim)
            .where(HalalClaim.submitted_by_user_id == user_id)
            .order_by(HalalClaim.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------


def create_halal_claim_for_user(
    db: Session,
    *,
    user_id: UUID,
    payload: MyHalalClaimCreate,
) -> HalalClaim:
    """Create a DRAFT claim.

    Authorization gates run before the row is created — we don't
    want a leftover DRAFT sitting around if the org ineligibility
    gate fires. A small tradeoff: two SELECTs upfront, but worth it
    to keep the table clean.
    """
    _assert_user_can_act_on_org(
        db, user_id=user_id, organization_id=payload.organization_id
    )
    _assert_org_owns_place(
        db,
        organization_id=payload.organization_id,
        place_id=payload.place_id,
    )

    structured_dict: Optional[dict[str, Any]] = (
        payload.structured_response.model_dump(exclude_none=False)
        if payload.structured_response is not None
        else None
    )

    claim = HalalClaim(
        place_id=payload.place_id,
        submitted_by_user_id=user_id,
        organization_id=payload.organization_id,
        # Phase 2 only creates INITIAL claims. RENEWAL and
        # RECONCILIATION variants are produced in later phases by
        # different code paths (the renewal cron + the dispute flow).
        claim_type=HalalClaimType.INITIAL.value,
        status=HalalClaimStatus.DRAFT.value,
        structured_response=structured_dict,
    )
    db.add(claim)
    # Flush before logging so the event row has the claim's UUID for
    # its FK; commit happens once at the end so claim + event land
    # together (or both roll back).
    db.flush()
    log_halal_claim_event(
        db,
        claim_id=claim.id,
        event_type=HalalClaimEventType.DRAFT_CREATED,
        actor_user_id=user_id,
        description="Owner started a halal claim.",
    )
    db.commit()
    db.refresh(claim)
    return claim


def batch_create_halal_claims_for_user(
    db: Session,
    *,
    user_id: UUID,
    payload: MyHalalClaimBatchCreate,
) -> list[HalalClaim]:
    """Create N DRAFT claims sharing one questionnaire payload.

    Use case: a chain restaurant whose locations all maintain the
    same halal standard — the owner fills out the questionnaire
    once and we fan it out across every selected place.

    Each (place, org) selection runs the same gates as the
    single-create path. The first one that fails raises and the
    whole transaction rolls back — no half-created batches.
    Authorization runs upfront (before any inserts) so the all-or-
    nothing posture is cheap.

    Schema-level uniqueness on the selections is the caller's
    job; if the same (place, org) appears twice we'll happily
    create two duplicate drafts, since the model has no UNIQUE
    constraint there. Frontends should de-dupe before posting.
    """
    if not payload.selections:
        # Pydantic min_length already guards this, but defensive
        # never hurts.
        raise BadRequestError(
            "HALAL_CLAIM_BATCH_EMPTY",
            "At least one place must be selected.",
        )

    # Validate every selection upfront so a later failure doesn't
    # leave a partial set of inserts.
    for sel in payload.selections:
        _assert_user_can_act_on_org(
            db, user_id=user_id, organization_id=sel.organization_id
        )
        _assert_org_owns_place(
            db,
            organization_id=sel.organization_id,
            place_id=sel.place_id,
        )

    structured_dict: Optional[dict[str, Any]] = (
        payload.structured_response.model_dump(exclude_none=False)
        if payload.structured_response is not None
        else None
    )

    created: list[HalalClaim] = []
    for sel in payload.selections:
        claim = HalalClaim(
            place_id=sel.place_id,
            submitted_by_user_id=user_id,
            organization_id=sel.organization_id,
            claim_type=HalalClaimType.INITIAL.value,
            status=HalalClaimStatus.DRAFT.value,
            structured_response=structured_dict,
        )
        db.add(claim)
        created.append(claim)

    # Flush so each claim picks up its UUID, then write one
    # DRAFT_CREATED event per claim. Same single-transaction posture
    # as the rest of the batch — if anything in the loop fails,
    # everything rolls back.
    db.flush()
    for claim in created:
        log_halal_claim_event(
            db,
            claim_id=claim.id,
            event_type=HalalClaimEventType.DRAFT_CREATED,
            actor_user_id=user_id,
            description="Owner started a halal claim (batch).",
        )

    db.commit()
    for claim in created:
        db.refresh(claim)
    return created


def patch_halal_claim_for_user(
    db: Session,
    *,
    claim_id: UUID,
    user_id: UUID,
    patch: MyHalalClaimPatch,
) -> HalalClaim:
    """Update a DRAFT claim's questionnaire.

    Phase 2 only allows the questionnaire blob to be patched. Place
    and organization are immutable after creation — owners who picked
    the wrong values discard the draft and start a new one.

    Once a claim leaves DRAFT it's frozen against owner edits;
    further changes happen via NEEDS_MORE_INFO from admin or via a
    fresh INITIAL/RENEWAL/RECONCILIATION claim.
    """
    claim = get_halal_claim_for_user(
        db, claim_id=claim_id, user_id=user_id
    )

    if claim.status != HalalClaimStatus.DRAFT.value:
        raise ConflictError(
            "HALAL_CLAIM_NOT_EDITABLE",
            (
                f"This claim is in status {claim.status} and can no "
                "longer be edited. Submit a new claim if you need to "
                "make changes."
            ),
        )

    if patch.structured_response is None:
        # No-op patch. Mirror the organizations patch behaviour and
        # raise NO_FIELDS so clients can silently ignore.
        raise BadRequestError(
            "NO_FIELDS",
            "Patch contained no fields to change.",
        )

    claim.structured_response = patch.structured_response.model_dump(
        exclude_none=False
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)
    return claim


def submit_halal_claim_for_user(
    db: Session,
    *,
    claim_id: UUID,
    user_id: UUID,
) -> HalalClaim:
    """Move DRAFT → PENDING_REVIEW.

    Re-validates the stored structured_response against the strict
    ``HalalQuestionnaireResponse`` shape. If anything's missing or
    malformed, raises a ``BadRequestError`` with the field-level
    errors so the client can render which questions still need
    answers.

    Idempotent in the sense that calling submit on an already-
    PENDING_REVIEW claim is a no-op (no error, no state change).
    Submit from any other status raises a 409.
    """
    claim = get_halal_claim_for_user(
        db, claim_id=claim_id, user_id=user_id
    )

    if claim.status == HalalClaimStatus.PENDING_REVIEW.value:
        # Already submitted — return as-is. Avoids spurious 409s on
        # double-clicks or stale-cache resubmits.
        return claim
    if claim.status != HalalClaimStatus.DRAFT.value:
        raise ConflictError(
            "HALAL_CLAIM_NOT_SUBMITTABLE",
            (
                f"Claim is in status {claim.status} and can't be "
                "submitted from here."
            ),
        )

    if claim.structured_response is None:
        raise BadRequestError(
            "HALAL_CLAIM_QUESTIONNAIRE_INCOMPLETE",
            (
                "Fill in the questionnaire before submitting. None of "
                "the answers are present yet."
            ),
        )

    try:
        # Strict re-parse. Fields missing in the stored draft will
        # raise here, surfacing field-level details in the response.
        HalalQuestionnaireResponse.model_validate(claim.structured_response)
    except ValidationError as exc:
        # Convert to our BadRequestError with the Pydantic errors as
        # ``detail`` so the frontend can highlight the missing
        # questions inline.
        raise BadRequestError(
            "HALAL_CLAIM_QUESTIONNAIRE_INCOMPLETE",
            "The questionnaire is missing required answers.",
            extra=exc.errors(),
        )

    prior_status = claim.status
    claim.status = HalalClaimStatus.PENDING_REVIEW.value
    claim.submitted_at = datetime.now(timezone.utc)
    db.add(claim)

    # Per-claim audit row (used by the claim detail's Activity
    # timeline). Description differentiates first-time submit from a
    # re-submit out of NEEDS_MORE_INFO.
    is_first_submit = prior_status == HalalClaimStatus.DRAFT.value
    log_halal_claim_event(
        db,
        claim_id=claim.id,
        event_type=HalalClaimEventType.SUBMITTED,
        actor_user_id=user_id,
        description=(
            "Owner submitted the claim for review."
            if is_first_submit
            else "Owner re-submitted after providing more info."
        ),
    )

    # Cross-write to the place's own audit trail so the place detail
    # page picks up "halal claim submitted" alongside ownership +
    # edit events. Only on first submit — re-submits out of
    # NEEDS_MORE_INFO would just spam the place timeline.
    if is_first_submit:
        log_place_event(
            db,
            place_id=claim.place_id,
            event_type=PlaceEventType.HALAL_CLAIM_SUBMITTED,
            actor_user_id=user_id,
            message=f"Halal claim {claim.id} submitted for review.",
        )

    db.commit()
    db.refresh(claim)
    return claim
