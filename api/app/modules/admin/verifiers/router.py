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

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.admin.verifiers.repo import (
    admin_decide_application,
    admin_get_application,
    admin_list_applications,
)
from app.modules.users.enums import UserRole
from app.modules.verifiers.enums import VerifierApplicationStatus
from app.modules.verifiers.schemas import (
    VerifierApplicationDecision,
    VerifierApplicationRead,
)


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
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> VerifierApplicationRead:
    row = admin_decide_application(
        db,
        application_id=application_id,
        payload=payload,
        decided_by_user_id=user.id,
    )
    return VerifierApplicationRead.model_validate(row)
