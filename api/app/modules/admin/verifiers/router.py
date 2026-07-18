"""Admin endpoints for verifier-application review.

Three actions:

  * ``GET  /admin/verifier-applications`` — queue list with optional
    status filter.
  * ``GET  /admin/verifier-applications/{id}`` — single-row detail.
  * ``POST /admin/verifier-applications/{id}/decide`` — approve or
    reject. Approval promotes the linked user's role to VERIFIER and
    creates their VerifierProfile in the same transaction.

All endpoints gated on ADMIN role. VERIFIER role does NOT get admin
access here — verifiers can't review their peers' applications, by
design. Profile management for already-active verifiers will land
in a follow-up slice (``/admin/verifiers/{user_id}``) once the
suspend/revoke flows are needed.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import BadRequestError
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.notifications.events import (
    notify_place_verified_savers,
    notify_verifier_application_decided,
    notify_verifier_status_changed,
    notify_verifier_visit_decided,
    place_is_verified,
)
from app.modules.verifiers.models import VerificationVisit
from app.modules.admin.verifiers.repo import (
    admin_decide_application,
    admin_get_application,
    admin_get_verifier_profile,
    admin_list_applications,
    admin_set_verifier_status,
)
from app.modules.admin.verifiers.visits_repo import (
    admin_decide_visit,
    admin_get_visit,
    admin_list_visits,
    admin_mark_under_review,
)
from app.modules.users.enums import UserRole
from app.modules.verifiers.enums import (
    VerificationVisitStatus,
    VerifierApplicationStatus,
    VerifierProfileStatus,
)
from app.modules.verifiers.schemas import (
    VerificationVisitDecision,
    VerificationVisitRead,
    VerifierApplicationDecision,
    VerifierApplicationRead,
    VerifierProfileRead,
)


# Signed-URL TTL for admin attachment access. Same 60s as other admin
# evidence-viewer endpoints — long enough to render the photo, short
# enough that a leaked URL doesn't have a long shelf life.
_VISIT_ATTACHMENT_SIGNED_URL_TTL = 60


router = APIRouter(
    prefix="/admin/verifier-applications", tags=["admin: verifiers"]
)


@router.get(
    "",
    response_model=list[VerifierApplicationRead],
    summary="List verifier applications",
    description=(
        "Newest-first queue. Filter by status (default none = all). "
        "Pagination capped at 100. Admin UI typically defaults to "
        "?status=PENDING to focus on actionable rows."
    ),
)
def admin_list_verifier_applications(
    status_filter: VerifierApplicationStatus | None = Query(
        default=None,
        alias="status",
        description=(
            "Filter by application status. Omit for all statuses."
        ),
    ),
    limit: int = Query(default=50, gt=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[VerifierApplicationRead]:
    rows = admin_list_applications(
        db, status=status_filter, limit=limit, offset=offset
    )
    return [VerifierApplicationRead.model_validate(r) for r in rows]


@router.get(
    "/{application_id}",
    response_model=VerifierApplicationRead,
    summary="Get a verifier application",
    description=(
        "Single-row detail. 404 on unknown id."
    ),
)
def admin_get_verifier_application(
    application_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerifierApplicationRead:
    row = admin_get_application(db, application_id=application_id)
    return VerifierApplicationRead.model_validate(row)


@router.post(
    "/{application_id}/decide",
    response_model=VerifierApplicationRead,
    status_code=status.HTTP_200_OK,
    summary="Approve or reject a verifier application",
    description=(
        "Apply an admin decision. ``decision`` must be APPROVED or "
        "REJECTED — WITHDRAWN is applicant-driven, PENDING is the "
        "starting state. Approval flips the linked user's role to "
        "VERIFIER and creates their VerifierProfile. Rejection "
        "requires a ``decision_note`` so the applicant gets "
        "context.\n\n"
        "Failure modes:\n"
        "  * 404 — application not found.\n"
        "  * 409 ``VERIFIER_APPLICATION_NOT_DECIDABLE`` — already "
        "decided / withdrawn.\n"
        "  * 409 ``VERIFIER_APPLICATION_REJECT_NOTE_REQUIRED`` — "
        "missing decision_note on a REJECTED decision.\n"
        "  * 409 ``VERIFIER_APPLICATION_USER_MISSING`` — no Trust "
        "Halal user matches the applicant; ask them to sign up "
        "first.\n"
        "  * 409 ``VERIFIER_APPLICATION_USER_WRONG_ROLE`` — user "
        "has role OWNER/ADMIN; promotion only flows from CONSUMER."
    ),
)
def admin_decide_verifier_application(
    application_id: UUID,
    payload: VerifierApplicationDecision,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerifierApplicationRead:
    row = admin_decide_application(
        db,
        application_id=application_id,
        payload=payload,
        decided_by_user_id=user.id,
    )
    notify_verifier_application_decided(
        background,
        db,
        applicant_user_id=row.applicant_user_id,
        applicant_email=row.applicant_email,
        approved="APPROVED" in str(payload.decision),
        decision_note=payload.decision_note,
    )
    return VerifierApplicationRead.model_validate(row)


# ---------------------------------------------------------------------------
# /admin/verification-visits — admin queue + decision surface
# ---------------------------------------------------------------------------

visits_router = APIRouter(
    prefix="/admin/verification-visits", tags=["admin: verifiers"]
)


@visits_router.get(
    "",
    response_model=list[VerificationVisitRead],
    summary="List verification visits",
    description=(
        "Newest-first queue. Optional filters by status, place_id, "
        "and verifier_user_id. Pagination 1–100. Admin UI "
        "typically defaults to ?status=SUBMITTED."
    ),
)
def admin_list_verification_visits(
    status_filter: VerificationVisitStatus | None = Query(
        default=None, alias="status"
    ),
    place_id: UUID | None = Query(default=None),
    verifier_user_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, gt=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[VerificationVisitRead]:
    rows = admin_list_visits(
        db,
        status=status_filter,
        place_id=place_id,
        verifier_user_id=verifier_user_id,
        limit=limit,
        offset=offset,
    )
    return [VerificationVisitRead.model_validate(r) for r in rows]


@visits_router.get(
    "/{visit_id}",
    response_model=VerificationVisitRead,
    summary="Get a verification visit",
)
def admin_get_verification_visit(
    visit_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerificationVisitRead:
    visit = admin_get_visit(db, visit_id=visit_id)
    return VerificationVisitRead.model_validate(visit)


@visits_router.post(
    "/{visit_id}/under-review",
    response_model=VerificationVisitRead,
    summary="Mark a SUBMITTED visit UNDER_REVIEW",
    description=(
        "Soft-claim a visit so other admins know it's being looked "
        "at. Idempotent against already-UNDER_REVIEW. The verifier "
        "loses the right to withdraw at this point."
    ),
)
def admin_mark_visit_under_review(
    visit_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerificationVisitRead:
    visit = admin_mark_under_review(
        db, visit_id=visit_id, decided_by_user_id=user.id
    )
    return VerificationVisitRead.model_validate(visit)


@visits_router.post(
    "/{visit_id}/decide",
    response_model=VerificationVisitRead,
    summary="Accept or reject a verification visit",
    description=(
        "Apply an admin decision. ACCEPTED promotes the place's "
        "halal_profile.validation_tier to TRUST_HALAL_VERIFIED (when "
        "a profile exists; otherwise 409 VERIFICATION_VISIT_NO_PROFILE) "
        "and refreshes last_verified_at to the visit's visited_at. "
        "REJECTED requires a decision_note for the verifier's "
        "context. Re-deciding a terminal row returns 409.\n\n"
        "Failure modes:\n"
        "  * 404 — visit not found.\n"
        "  * 409 ``VERIFICATION_VISIT_NOT_DECIDABLE`` — already "
        "decided / withdrawn.\n"
        "  * 409 ``VERIFICATION_VISIT_REJECT_NOTE_REQUIRED`` — "
        "missing decision_note on REJECTED.\n"
        "  * 409 ``VERIFICATION_VISIT_NO_PROFILE`` — ACCEPTED "
        "with no halal profile to elevate."
    ),
)
def admin_decide_verification_visit(
    visit_id: UUID,
    payload: VerificationVisitDecision,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerificationVisitRead:
    # Capture the place's verified state before the decision so the saver
    # fan-out only fires on a genuine transition into verified.
    prior_place_id = db.execute(
        select(VerificationVisit.place_id).where(VerificationVisit.id == visit_id)
    ).scalar_one_or_none()
    was_verified = (
        place_is_verified(db, prior_place_id) if prior_place_id else False
    )

    visit = admin_decide_visit(
        db,
        visit_id=visit_id,
        payload=payload,
        decided_by_user_id=user.id,
    )
    accepted = "ACCEPT" in str(payload.decision).upper()
    notify_verifier_visit_decided(
        background,
        db,
        verifier_user_id=visit.verifier_user_id,
        place_id=visit.place_id,
        accepted=accepted,
        decision_note=payload.decision_note,
        visit_id=visit.id,
    )
    if accepted and not was_verified:
        notify_place_verified_savers(background, db, place_id=visit.place_id)
    return VerificationVisitRead.model_validate(visit)


# ---------------------------------------------------------------------------
# Attachment evidence-viewer flow
# ---------------------------------------------------------------------------
# Mirrors /admin/halal-claims/{id}/attachments + .../url. Admin needs
# to look at the photos the verifier uploaded; storage is private so
# we mint a short-lived signed URL on demand.

@visits_router.get(
    "/{visit_id}/attachments",
    summary="List attachment metadata for a visit",
)
def admin_list_visit_attachments(
    visit_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[dict]:
    visit = admin_get_visit(db, visit_id=visit_id)
    return [
        {
            "id": str(att.id),
            "visit_id": str(att.visit_id),
            "original_filename": att.original_filename,
            "content_type": att.content_type,
            "size_bytes": att.size_bytes,
            "caption": att.caption,
            "uploaded_at": att.uploaded_at.isoformat(),
        }
        for att in visit.attachments
    ]


@visits_router.get(
    "/{visit_id}/attachments/{attachment_id}/url",
    summary="Mint a short-lived signed URL for an attachment",
    description=(
        "Returns a signed URL valid for 60 seconds. The admin UI "
        "fetches it on hover/click rather than embedding so we don't "
        "have a stable pre-rendered link to leak."
    ),
)
def admin_visit_attachment_signed_url(
    visit_id: UUID,
    attachment_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    storage: StorageClient = Depends(get_storage_client),
) -> dict:
    visit = admin_get_visit(db, visit_id=visit_id)
    matching = [att for att in visit.attachments if att.id == attachment_id]
    if not matching:
        raise BadRequestError(
            "VERIFICATION_VISIT_ATTACHMENT_NOT_FOUND",
            "Attachment not found on this visit.",
        )
    att = matching[0]
    try:
        url = storage.signed_url(
            att.storage_path,
            expires_in_seconds=_VISIT_ATTACHMENT_SIGNED_URL_TTL,
        )
    except StorageError as exc:
        raise BadRequestError(
            "VERIFICATION_VISIT_ATTACHMENT_URL_FAILED",
            f"Couldn't sign the URL. ({exc})",
        )
    return {"url": url, "expires_in_seconds": _VISIT_ATTACHMENT_SIGNED_URL_TTL}


# ---------------------------------------------------------------------------
# /admin/verifiers — verifier profile management (revoke / suspend / reinstate)
# ---------------------------------------------------------------------------
# The "follow-up slice" the application-decide docstring anticipated: once a
# CONSUMER is promoted to VERIFIER, this is how staff walk it back.

profiles_router = APIRouter(prefix="/admin/verifiers", tags=["admin: verifiers"])


class VerifierStatusChange(BaseModel):
    """Optional context for a status change, shown to the verifier in the
    notification email."""

    note: str | None = Field(default=None, max_length=2000)


@profiles_router.get(
    "/{user_id}",
    response_model=VerifierProfileRead,
    summary="Get a verifier's profile + current status",
)
def admin_get_verifier(
    user_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerifierProfileRead:
    return VerifierProfileRead.model_validate(
        admin_get_verifier_profile(db, user_id=user_id)
    )


def _apply_status(
    *,
    user_id: UUID,
    new_status: VerifierProfileStatus,
    note: str | None,
    background: BackgroundTasks,
    db: Session,
    actor_id: UUID,
) -> VerifierProfileRead:
    profile = admin_set_verifier_status(
        db, user_id=user_id, new_status=new_status, actor_user_id=actor_id
    )
    notify_verifier_status_changed(
        background, db, user_id=user_id, status=new_status.value, note=note
    )
    return VerifierProfileRead.model_validate(profile)


@profiles_router.post(
    "/{user_id}/revoke",
    response_model=VerifierProfileRead,
    summary="Revoke verifier access",
    description=(
        "Permanently removes verifier access: profile → REVOKED and the "
        "user's role drops from VERIFIER back to CONSUMER. They can no "
        "longer file verification visits. Idempotent."
    ),
)
def admin_revoke_verifier(
    user_id: UUID,
    background: BackgroundTasks,
    body: VerifierStatusChange | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerifierProfileRead:
    return _apply_status(
        user_id=user_id,
        new_status=VerifierProfileStatus.REVOKED,
        note=body.note if body else None,
        background=background,
        db=db,
        actor_id=user.id,
    )


@profiles_router.post(
    "/{user_id}/suspend",
    response_model=VerifierProfileRead,
    summary="Suspend verifier access (temporary)",
    description=(
        "Temporarily pauses a verifier: profile → SUSPENDED. The VERIFIER "
        "role is kept, but visit-filing is blocked (it requires ACTIVE). "
        "Reinstate to restore. Idempotent."
    ),
)
def admin_suspend_verifier(
    user_id: UUID,
    background: BackgroundTasks,
    body: VerifierStatusChange | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerifierProfileRead:
    return _apply_status(
        user_id=user_id,
        new_status=VerifierProfileStatus.SUSPENDED,
        note=body.note if body else None,
        background=background,
        db=db,
        actor_id=user.id,
    )


@profiles_router.post(
    "/{user_id}/reinstate",
    response_model=VerifierProfileRead,
    summary="Reinstate a revoked/suspended verifier",
    description=(
        "Restores verifier access: profile → ACTIVE. If the user was "
        "dropped to CONSUMER by a prior revoke, they're promoted back to "
        "VERIFIER. Idempotent."
    ),
)
def admin_reinstate_verifier(
    user_id: UUID,
    background: BackgroundTasks,
    body: VerifierStatusChange | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerifierProfileRead:
    return _apply_status(
        user_id=user_id,
        new_status=VerifierProfileStatus.ACTIVE,
        note=body.note if body else None,
        background=background,
        db=db,
        actor_id=user.id,
    )


__all__ = ["router", "visits_router", "profiles_router"]
