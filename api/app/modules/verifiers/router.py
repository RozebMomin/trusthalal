"""Public + applicant-self verifier endpoints.

Two prefix groups, both shipped from this module:

  * ``/verifier-applications`` — the public submit endpoint.
    Anonymous-OK because community moderators may apply before
    creating a Trust Halal account; their email is captured so admin
    can reach back. Signed-in users get their applicant_user_id
    populated so admin sees the linkage.
  * ``/me/verifier-applications`` — applicant-self reads + the
    withdraw action. Auth required (need a user_id to scope the rows).

Admin review (``/admin/verifier-applications/*``) lives in its own
module under ``app/modules/admin/verifiers``.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.auth import (
    CurrentUser,
    get_current_user,
    get_current_user_optional,
)
from app.core.rate_limit import limiter, user_or_ip_key
from app.db.deps import get_db
from app.modules.verifiers.repo import (
    get_application_for_applicant,
    list_applications_for_applicant,
    submit_application,
    withdraw_application,
)
from app.modules.verifiers.schemas import (
    VerifierApplicationCreate,
    VerifierApplicationRead,
)


# /verifier-applications — public submit. Tagged separately from the
# /me/* surface so the OpenAPI grouping reads naturally.
public_router = APIRouter(
    prefix="/verifier-applications", tags=["verifier-applications"]
)


@public_router.post(
    "",
    response_model=VerifierApplicationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a verifier application",
    description=(
        "Open a verifier application. Anonymous-OK: applicants may "
        "submit before creating an account, so the form captures "
        "applicant_email + applicant_name independently of any "
        "session. When a session is present, the applicant's user_id "
        "is recorded for admin context. Rate-limited (5/hour per "
        "user-or-IP) to keep noise out of the admin queue."
    ),
)
@limiter.limit("5/hour", key_func=user_or_ip_key)
def submit_verifier_application(
    request: Request,
    payload: VerifierApplicationCreate,
    db: Session = Depends(get_db),
    user: Optional[CurrentUser] = Depends(get_current_user_optional),
) -> VerifierApplicationRead:
    application = submit_application(
        db,
        payload=payload,
        applicant_user_id=user.id if user is not None else None,
    )
    return VerifierApplicationRead.model_validate(application)


# /me/verifier-applications — applicant-self prefix.
me_router = APIRouter(
    prefix="/me/verifier-applications", tags=["verifier-applications"]
)


@me_router.get(
    "",
    response_model=list[VerifierApplicationRead],
    summary="List the applicant's own verifier applications",
    description=(
        "Newest-first, includes every status — PENDING, APPROVED, "
        "REJECTED, WITHDRAWN — so the applicant can read their full "
        "history. Pagination capped at 50; realistic applicants will "
        "have a single-digit count of rows."
    ),
)
def list_my_verifier_applications(
    limit: int = Query(default=20, gt=0, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[VerifierApplicationRead]:
    rows = list_applications_for_applicant(
        db, applicant_user_id=user.id, limit=limit, offset=offset
    )
    return [VerifierApplicationRead.model_validate(r) for r in rows]


@me_router.get(
    "/{application_id}",
    response_model=VerifierApplicationRead,
    summary="Get one of the applicant's verifier applications",
    description=(
        "Applicant-self read. 404 on unknown id and on rows owned by "
        "a different user — same posture as the rest of the /me/* "
        "surface, no existence-leak."
    ),
)
def get_my_verifier_application(
    application_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> VerifierApplicationRead:
    row = get_application_for_applicant(
        db, application_id=application_id, applicant_user_id=user.id
    )
    return VerifierApplicationRead.model_validate(row)


@me_router.post(
    "/{application_id}/withdraw",
    response_model=VerifierApplicationRead,
    summary="Withdraw a pending verifier application",
    description=(
        "Pull a PENDING application before admin acts on it. "
        "Idempotent against already-WITHDRAWN. Returns 409 once "
        "admin has APPROVED or REJECTED — the decision is final on "
        "the applicant side."
    ),
)
def withdraw_my_verifier_application(
    application_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> VerifierApplicationRead:
    row = withdraw_application(
        db, application_id=application_id, applicant_user_id=user.id
    )
    return VerifierApplicationRead.model_validate(row)


__all__ = ["public_router", "me_router"]
