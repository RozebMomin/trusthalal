"""Admin-side repo for verifier-application review.

Covers the queue list, single-row read, and the two decision
transitions (APPROVE / REJECT). Approval is the heaviest path
because it has to:

  1. Flip the application row to APPROVED.
  2. Find or invite the matching User (by email or by
     applicant_user_id). For the v1 surface we require the applicant
     to have an existing account — otherwise approval would also
     need to thread an invite-token flow that's better added later.
     A 409 with VERIFIER_APPLICATION_USER_MISSING tells the admin to
     ask the applicant to sign up first.
  3. Promote that User's role to VERIFIER. Other admin roles
     (existing ADMIN / OWNER / VERIFIER) are protected — the admin
     gets a 409 instead of overwriting a sensitive role.
  4. Create a VerifierProfile row with status=ACTIVE.
  5. Stamp the application's ``resulting_verifier_profile_id`` so
     provenance survives.

Everything happens in one transaction — either the application
flips, the role flips, and the profile lands, or none of it does.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.users.enums import UserRole
from app.modules.users.models import User
from app.modules.verifiers.enums import (
    VerifierApplicationStatus,
    VerifierProfileStatus,
)
from app.modules.verifiers.models import VerifierApplication, VerifierProfile
from app.modules.verifiers.schemas import VerifierApplicationDecision


# Statuses an admin can act on. APPROVED / REJECTED / WITHDRAWN are
# all terminal — re-deciding gets a 409 so the audit trail stays
# clean.
_DECIDABLE_STATUSES: tuple[str, ...] = (
    VerifierApplicationStatus.PENDING.value,
)


def admin_get_application(
    db: Session, *, application_id: UUID
) -> VerifierApplication:
    """Fetch any application — admin sees all rows regardless of
    applicant_user_id ownership. 404 on missing.
    """
    row = db.execute(
        select(VerifierApplication).where(
            VerifierApplication.id == application_id
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "VERIFIER_APPLICATION_NOT_FOUND",
            "Verifier application not found.",
        )
    return row


def admin_list_applications(
    db: Session,
    *,
    status: VerifierApplicationStatus | None = None,
    limit: int,
    offset: int,
) -> Sequence[VerifierApplication]:
    """Newest-first queue. Optional status filter — the admin UI
    defaults to ``status=PENDING`` to focus on the actionable rows
    but can switch to APPROVED / REJECTED / WITHDRAWN for history.
    """
    stmt = select(VerifierApplication).order_by(
        VerifierApplication.submitted_at.desc()
    )
    if status is not None:
        stmt = stmt.where(VerifierApplication.status == status.value)
    stmt = stmt.limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def admin_decide_application(
    db: Session,
    *,
    application_id: UUID,
    payload: VerifierApplicationDecision,
    decided_by_user_id: UUID,
) -> VerifierApplication:
    """Apply an admin decision (APPROVE or REJECT).

    The schema validates the decision is one of the two terminal
    states; we double-check here so the repo is independently safe
    when called from a script.
    """
    decision = payload.decision

    if decision not in (
        VerifierApplicationStatus.APPROVED,
        VerifierApplicationStatus.REJECTED,
    ):
        raise ConflictError(
            "VERIFIER_APPLICATION_INVALID_DECISION",
            (
                "Decision must be APPROVED or REJECTED. WITHDRAWN is "
                "applicant-driven and PENDING is the starting state."
            ),
        )

    if decision == VerifierApplicationStatus.REJECTED and not (
        payload.decision_note and payload.decision_note.strip()
    ):
        # Required for REJECTED so the applicant gets context. The
        # schema would also be a fine place to enforce this, but the
        # repo guard keeps it true regardless of how the call is
        # constructed.
        raise ConflictError(
            "VERIFIER_APPLICATION_REJECT_NOTE_REQUIRED",
            "Rejecting an application requires a decision_note.",
        )

    application = admin_get_application(db, application_id=application_id)

    if application.status not in _DECIDABLE_STATUSES:
        raise ConflictError(
            "VERIFIER_APPLICATION_NOT_DECIDABLE",
            (
                f"Application is in status {application.status}; only "
                "PENDING applications can be decided."
            ),
        )

    application.status = decision.value
    application.decided_at = datetime.now(timezone.utc)
    application.decided_by_user_id = decided_by_user_id
    application.decision_note = payload.decision_note

    if decision == VerifierApplicationStatus.APPROVED:
        profile = _approve_into_verifier_profile(db, application=application)
        application.resulting_verifier_profile_id = profile.user_id

    db.commit()
    db.refresh(application)
    return application


def _approve_into_verifier_profile(
    db: Session, *, application: VerifierApplication
) -> VerifierProfile:
    """Promote the applicant to a VERIFIER and create their profile.

    The user the application points to must exist already. We resolve
    by ``applicant_user_id`` first (most accurate), then fall back to
    ``applicant_email`` lookup. If neither resolves, we surface a
    409 so the admin can ask the applicant to create an account.

    Role guard: existing OWNER / ADMIN / VERIFIER accounts can't be
    "promoted" through this path — promotion only flows from
    CONSUMER. Other roles get a 409 to force the admin to do the
    cross-role flip deliberately, since OWNER → VERIFIER would
    surprise the existing org-management surface.
    """
    user = _resolve_applicant_user(db, application=application)
    if user is None:
        raise ConflictError(
            "VERIFIER_APPLICATION_USER_MISSING",
            (
                "Can't approve — no Trust Halal account found for "
                f"{application.applicant_email}. Ask the applicant to "
                "sign up first, then reapprove."
            ),
        )

    if user.role == UserRole.VERIFIER.value:
        # Already a verifier — just make sure a profile row exists
        # (defensive: shouldn't happen given the application pre-
        # check, but keeps the path idempotent).
        profile = db.execute(
            select(VerifierProfile).where(VerifierProfile.user_id == user.id)
        ).scalar_one_or_none()
        if profile is not None:
            return profile

    elif user.role != UserRole.CONSUMER.value:
        raise ConflictError(
            "VERIFIER_APPLICATION_USER_WRONG_ROLE",
            (
                f"User has role {user.role}; only CONSUMER accounts "
                "can be promoted to VERIFIER through this flow."
            ),
        )

    user.role = UserRole.VERIFIER.value

    profile = VerifierProfile(
        user_id=user.id,
        bio=None,
        social_links=application.social_links,
        is_public=False,
        status=VerifierProfileStatus.ACTIVE.value,
    )
    db.add(profile)
    db.flush()
    return profile


def _resolve_applicant_user(
    db: Session, *, application: VerifierApplication
) -> User | None:
    """Find the User row the application should promote.

    Preference order:
      1. ``applicant_user_id`` — the session id captured at submit.
      2. Email lookup (case-insensitive).

    Returns None when no user matches; caller surfaces the 409.
    """
    if application.applicant_user_id is not None:
        user = db.execute(
            select(User).where(User.id == application.applicant_user_id)
        ).scalar_one_or_none()
        if user is not None:
            return user

    return db.execute(
        select(User).where(User.email.ilike(application.applicant_email))
    ).scalar_one_or_none()
