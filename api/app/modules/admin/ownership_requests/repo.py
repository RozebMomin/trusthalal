from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
)
from app.modules.admin.ownership_requests.schemas import (
    OwnershipRequestAdminCreate,
    OwnershipRequestApprove,
    OwnershipRequestEvidence,
    OwnershipRequestReject,
)
from app.modules.organizations.enums import OrganizationStatus
from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.ownership_requests.enums import OwnershipRequestStatus
from app.modules.ownership_requests.models import PlaceOwnershipRequest
from app.modules.ownership_requests.repo import create_ownership_request
from app.modules.places.enums import PlaceEventType
from app.modules.places.models import PlaceEvent
from app.modules.places.repo import get_place
from app.modules.users.enums import UserRole
from app.modules.users.models import User


TERMINAL_STATUSES = {
    OwnershipRequestStatus.APPROVED.value,
    OwnershipRequestStatus.REJECTED.value,
    OwnershipRequestStatus.CANCELLED.value,
}


def admin_create_ownership_request(
    db: Session, *, payload: OwnershipRequestAdminCreate
) -> PlaceOwnershipRequest:
    """Admin-side create for an ownership request on someone's behalf.

    Validates:
      * Place exists (and isn't soft-deleted — admins shouldn't be
        opening new ownership conversations on dead rows).
      * ``requester_user_id``, if supplied, points at a real user.

    Then delegates to ``create_ownership_request`` for the actual
    insert. The public path's per-place duplicate guard is
    deliberately bypassed here: admins recording an inbound intake
    (phone-call, in-person walk-in, forwarded email) need to be
    able to do it even while another claim sits in the review queue,
    and the audit trail prefers two parallel rows over a phantom one
    that never got recorded.

    Raises:
        NotFoundError(PLACE_NOT_FOUND)  if the place is unknown/deleted.
        NotFoundError(USER_NOT_FOUND)   if requester_user_id is unknown.
    """
    place = get_place(db, payload.place_id)
    if not place:
        raise NotFoundError(
            "PLACE_NOT_FOUND",
            "Place not found (or has been soft-deleted).",
        )

    if payload.requester_user_id is not None:
        user = db.execute(
            select(User).where(User.id == payload.requester_user_id)
        ).scalar_one_or_none()
        if user is None:
            raise NotFoundError(
                "USER_NOT_FOUND",
                "Requester user not found",
            )

    return create_ownership_request(
        db,
        place_id=payload.place_id,
        requester_user_id=payload.requester_user_id,
        contact_name=payload.contact_name,
        contact_email=str(payload.contact_email),
        message=payload.message,
        skip_duplicate_check=True,
    )


def admin_list_ownership_requests(
    db: Session,
    *,
    status: str | None,
    limit: int,
    offset: int,
) -> list[PlaceOwnershipRequest]:
    stmt = select(PlaceOwnershipRequest)

    if status:
        stmt = stmt.where(PlaceOwnershipRequest.status == status)

    stmt = (
        stmt.order_by(PlaceOwnershipRequest.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    return list(db.execute(stmt).scalars().all())


def _get_request_or_404(db: Session, request_id: UUID) -> PlaceOwnershipRequest:
    req = db.execute(
        select(PlaceOwnershipRequest).where(PlaceOwnershipRequest.id == request_id)
    ).scalar_one_or_none()
    if not req:
        raise NotFoundError(
            "OWNERSHIP_REQUEST_NOT_FOUND", "Ownership request not found"
        )
    return req


def _assert_not_terminal(req: PlaceOwnershipRequest) -> None:
    if req.status in TERMINAL_STATUSES:
        raise ConflictError(
            "OWNERSHIP_REQUEST_TERMINAL",
            f"Ownership request is already {req.status} and cannot be modified",
        )


def admin_approve_ownership_request(
    db: Session,
    *,
    request_id: UUID,
    payload: OwnershipRequestApprove,
    actor_user_id: UUID,
) -> PlaceOwnershipRequest:
    """Promote an ownership request into real ownership.

    Slice 5d redesign: the sponsoring org is read off the claim row
    itself (set at submission time via the owner-portal flow). The
    org must be VERIFIED. Admin no longer creates orgs during
    approval — that path moved to /me/organizations + the
    /admin/organizations verify endpoint.

    Two paths supported:
      1. Slice 5b (canonical): the claim has organization_id. We use
         it directly; payload.organization_id is ignored.
      2. Legacy (anonymous public submission): the claim has no
         organization_id. Admin must supply organization_id in the
         body, pointing at an existing VERIFIED org.

    All writes happen in one transaction:
      - resolve org (claim's, then body's)
      - validate org is VERIFIED
      - insert/activate PlaceOwner link (status=ACTIVE)
      - insert/activate OrganizationMember for the requester
      - promote requester User role CONSUMER -> OWNER
      - flip request status to APPROVED
      - log a PlaceEvent (OWNERSHIP_GRANTED) with the actor
    """
    req = _get_request_or_404(db, request_id)
    _assert_not_terminal(req)

    # Pick the org id: claim's wins, body's is the legacy fallback.
    effective_org_id = req.organization_id or payload.organization_id
    if effective_org_id is None:
        raise BadRequestError(
            "OWNERSHIP_APPROVE_NO_ORG",
            "This claim has no sponsoring organization. Ask the owner "
            "to re-file via the owner portal, or provide organization_id "
            "(an existing VERIFIED org) in the request body.",
        )

    org = db.execute(
        select(Organization).where(Organization.id == effective_org_id)
    ).scalar_one_or_none()
    if not org:
        raise NotFoundError("ORGANIZATION_NOT_FOUND", "Organization not found")

    if org.status != OrganizationStatus.VERIFIED.value:
        raise ConflictError(
            "OWNERSHIP_APPROVE_ORG_NOT_VERIFIED",
            f"Sponsoring organization is {org.status}. Verify it at "
            "/admin/organizations before approving the claim.",
        )

    # Upsert PlaceOwner link
    po = db.execute(
        select(PlaceOwner).where(
            PlaceOwner.place_id == req.place_id,
            PlaceOwner.organization_id == org.id,
        )
    ).scalar_one_or_none()
    if po:
        po.status = "ACTIVE"
        po.role = payload.place_owner_role
    else:
        po = PlaceOwner(
            place_id=req.place_id,
            organization_id=org.id,
            role=payload.place_owner_role,
            status="ACTIVE",
        )
        db.add(po)

    # Wire requester into org (if we know who they are)
    if req.requester_user_id is not None:
        requester = db.execute(
            select(User).where(User.id == req.requester_user_id)
        ).scalar_one_or_none()
        if requester:
            member = db.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == org.id,
                    OrganizationMember.user_id == requester.id,
                )
            ).scalar_one_or_none()
            if member:
                member.status = "ACTIVE"
                member.role = payload.member_role
            else:
                db.add(
                    OrganizationMember(
                        organization_id=org.id,
                        user_id=requester.id,
                        role=payload.member_role,
                        status="ACTIVE",
                    )
                )

            # Promote CONSUMER -> OWNER (leave VERIFIER/ADMIN alone)
            if requester.role == UserRole.CONSUMER.value:
                requester.role = UserRole.OWNER.value
                db.add(requester)

    # Flip request status
    req.status = OwnershipRequestStatus.APPROVED.value
    db.add(req)

    # Audit trail on the place
    db.add(
        PlaceEvent(
            place_id=req.place_id,
            event_type=PlaceEventType.OWNERSHIP_GRANTED.value,
            actor_user_id=actor_user_id,
            message=(
                payload.note
                or f"Ownership granted to org {org.name} via request {req.id}"
            ),
        )
    )

    db.commit()
    db.refresh(req)
    return req


def admin_reject_ownership_request(
    db: Session,
    *,
    request_id: UUID,
    payload: OwnershipRequestReject,
    actor_user_id: UUID,
) -> PlaceOwnershipRequest:
    req = _get_request_or_404(db, request_id)
    _assert_not_terminal(req)

    req.status = OwnershipRequestStatus.REJECTED.value
    db.add(req)

    db.add(
        PlaceEvent(
            place_id=req.place_id,
            event_type=PlaceEventType.OWNERSHIP_REQUEST_REJECTED.value,
            actor_user_id=actor_user_id,
            message=payload.reason,
        )
    )

    db.commit()
    db.refresh(req)
    return req


def admin_request_more_evidence(
    db: Session,
    *,
    request_id: UUID,
    payload: OwnershipRequestEvidence,
    actor_user_id: UUID,
) -> PlaceOwnershipRequest:
    req = _get_request_or_404(db, request_id)
    _assert_not_terminal(req)

    # Always overwrite decision_note with the latest instruction —
    # the owner needs the most recent guidance, not the first one.
    # Per-event history still lives on place_events for forensics.
    req.decision_note = payload.note

    if req.status == OwnershipRequestStatus.NEEDS_EVIDENCE.value:
        # Idempotent on status: no fresh event row, but the
        # decision_note refresh above already happened so a second
        # call still updates the owner-visible instruction.
        db.add(req)
        db.commit()
        db.refresh(req)
        return req

    req.status = OwnershipRequestStatus.NEEDS_EVIDENCE.value
    db.add(req)

    db.add(
        PlaceEvent(
            place_id=req.place_id,
            event_type=PlaceEventType.OWNERSHIP_REQUEST_NEEDS_EVIDENCE.value,
            actor_user_id=actor_user_id,
            message=payload.note,
        )
    )

    db.commit()
    db.refresh(req)
    return req
