"""Persistence helpers for verifier applications.

Phase 8a is the application surface. Repo helpers cover:

  * ``submit_application`` — public POST handler. Captures the
    applicant's session id when one's available so admin can
    correlate to an existing user; otherwise just stores the
    contact info and applicant_email.
  * ``has_pending_application_for_user`` / ``has_pending_application_for_email``
    — duplicate guards. A consumer can only have one PENDING row at
    a time; the second submission gets a 409 with a stable code so
    frontends can render "you already applied; we'll get back to
    you" instead of confusing the user with a generic error.
  * ``withdraw_application`` — the applicant pulls their own
    PENDING row before admin acts on it. Idempotent against
    already-WITHDRAWN; everything else 409s.
  * ``get_my_application`` / ``list_my_applications`` — applicant-
    self read paths.

Profile creation on APPROVED is admin-side and lives in
``app/modules/admin/verifiers/repo.py`` to keep the consumer module
free of role-mutation code.
"""
from __future__ import annotations

from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.verifiers.enums import VerifierApplicationStatus
from app.modules.verifiers.models import VerifierApplication
from app.modules.verifiers.schemas import VerifierApplicationCreate


# Statuses that "block" a new submission for the same applicant.
# APPROVED is here too — once you're a verifier, you don't re-apply.
# A verifier whose profile got REVOKED would be re-onboarded by admin
# directly rather than via a fresh public application.
_BLOCKING_STATUSES: tuple[str, ...] = (
    VerifierApplicationStatus.PENDING.value,
    VerifierApplicationStatus.APPROVED.value,
)


def has_blocking_application_for_user(
    db: Session, *, user_id: UUID
) -> VerifierApplication | None:
    """Return the most recent blocking row for this user, if any.

    Used by ``submit_application`` to short-circuit before INSERT
    when the caller is signed in. The applicant may also have older
    REJECTED / WITHDRAWN rows — those don't block.
    """
    return db.execute(
        select(VerifierApplication)
        .where(
            VerifierApplication.applicant_user_id == user_id,
            VerifierApplication.status.in_(_BLOCKING_STATUSES),
        )
        .order_by(VerifierApplication.submitted_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def has_blocking_application_for_email(
    db: Session, *, email: str
) -> VerifierApplication | None:
    """Same idea, but keyed on email — covers the anonymous-applicant
    path where ``applicant_user_id`` is NULL. Email comparison is
    case-insensitive to match how email lookups work elsewhere
    (Pydantic's EmailStr already normalizes whitespace; we lowercase
    here so 'Foo@x.com' and 'foo@x.com' collide).
    """
    return db.execute(
        select(VerifierApplication)
        .where(
            VerifierApplication.applicant_email.ilike(email),
            VerifierApplication.status.in_(_BLOCKING_STATUSES),
        )
        .order_by(VerifierApplication.submitted_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def submit_application(
    db: Session,
    *,
    payload: VerifierApplicationCreate,
    applicant_user_id: UUID | None,
) -> VerifierApplication:
    """Create a PENDING application row.

    Raises ``ConflictError(VERIFIER_APPLICATION_DUPLICATE)`` when the
    applicant already has a PENDING or APPROVED row keyed on either
    their user_id (if signed in) or their email.
    """
    if applicant_user_id is not None:
        existing = has_blocking_application_for_user(
            db, user_id=applicant_user_id
        )
        if existing is not None:
            raise ConflictError(
                "VERIFIER_APPLICATION_DUPLICATE",
                "You already have an active verifier application.",
            )

    existing_by_email = has_blocking_application_for_email(
        db, email=payload.applicant_email
    )
    if existing_by_email is not None:
        raise ConflictError(
            "VERIFIER_APPLICATION_DUPLICATE",
            "An application from this email is already pending review.",
        )

    application = VerifierApplication(
        applicant_user_id=applicant_user_id,
        applicant_email=payload.applicant_email,
        applicant_name=payload.applicant_name,
        motivation=payload.motivation,
        background=payload.background,
        social_links=payload.social_links,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def get_application_for_applicant(
    db: Session, *, application_id: UUID, applicant_user_id: UUID
) -> VerifierApplication:
    """Read-with-ownership-check.

    Raises NotFoundError when the row doesn't exist OR belongs to a
    different user — same posture as ``/me/halal-claims/{id}``: 404
    rather than 403 so we don't leak existence.
    """
    row = db.execute(
        select(VerifierApplication).where(
            VerifierApplication.id == application_id,
            VerifierApplication.applicant_user_id == applicant_user_id,
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "VERIFIER_APPLICATION_NOT_FOUND",
            "Verifier application not found.",
        )
    return row


def list_applications_for_applicant(
    db: Session, *, applicant_user_id: UUID, limit: int, offset: int
) -> Sequence[VerifierApplication]:
    """Newest-first list scoped to the caller. No status filter — the
    applicant sees their full history (PENDING + APPROVED + REJECTED +
    WITHDRAWN) so they understand the timeline.
    """
    return list(
        db.execute(
            select(VerifierApplication)
            .where(VerifierApplication.applicant_user_id == applicant_user_id)
            .order_by(VerifierApplication.submitted_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )


def withdraw_application(
    db: Session, *, application_id: UUID, applicant_user_id: UUID
) -> VerifierApplication:
    """Mark a PENDING application WITHDRAWN.

    Idempotent against already-WITHDRAWN (returns the row unchanged).
    Anything other than PENDING / WITHDRAWN raises CONFLICT — once
    admin has decided, the applicant can't roll the decision back.
    """
    app = get_application_for_applicant(
        db,
        application_id=application_id,
        applicant_user_id=applicant_user_id,
    )

    if app.status == VerifierApplicationStatus.WITHDRAWN.value:
        return app

    if app.status != VerifierApplicationStatus.PENDING.value:
        raise ConflictError(
            "VERIFIER_APPLICATION_NOT_WITHDRAWABLE",
            (
                f"Application is in status {app.status}; only PENDING "
                "applications can be withdrawn."
            ),
        )

    app.status = VerifierApplicationStatus.WITHDRAWN.value
    db.commit()
    db.refresh(app)
    return app
