from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError
from app.modules.ownership_requests.enums import OwnershipRequestStatus
from app.modules.ownership_requests.models import PlaceOwnershipRequest

ACTIVE_STATUSES = (
    OwnershipRequestStatus.SUBMITTED,
    OwnershipRequestStatus.NEEDS_EVIDENCE,
    OwnershipRequestStatus.UNDER_REVIEW,
)

def create_ownership_request(
    db: Session,
    *,
    place_id: UUID,
    requester_user_id: UUID | None,
    contact_name: str,
    contact_email: str,
    message: str | None,
    organization_id: UUID | None = None,
    skip_duplicate_check: bool = False,
) -> PlaceOwnershipRequest:
    """Persist a claim row.

    ``organization_id`` is optional for backwards compatibility with
    callers that pre-date slice 5b (the public
    ``POST /places/{place_id}/ownership-requests`` path and the admin
    create-on-behalf path). New owner-portal callers always supply
    one — validation that the org belongs to the user lives in the
    /me/* handler, not here.

    Duplicate-prevention scope is the **place**: if any active claim
    (SUBMITTED / UNDER_REVIEW / NEEDS_EVIDENCE) exists for the place,
    a new claim from anyone else is rejected with
    ``OWNERSHIP_REQUEST_ALREADY_EXISTS``. This keeps the admin queue
    free of competing duplicates — staff finishes the open one first,
    and a second legitimate claimant can re-submit after the first
    decision lands. The admin "create on behalf of someone" path
    bypasses this guard via ``skip_duplicate_check=True`` so staff
    can still record an inbound intake even while another claim is
    in flight.
    """
    normalized_email = contact_email.strip().lower()

    if not skip_duplicate_check:
        existing = db.execute(
            select(PlaceOwnershipRequest.id)
            .where(PlaceOwnershipRequest.place_id == place_id)
            .where(
                PlaceOwnershipRequest.status.in_(
                    [s.value for s in ACTIVE_STATUSES]
                )
            )
        ).scalar_one_or_none()

        if existing:
            raise ConflictError(
                "OWNERSHIP_REQUEST_ALREADY_EXISTS",
                "An ownership claim is already pending review for this "
                "place. Wait for the current claim to be decided before "
                "submitting another.",
            )

    req = PlaceOwnershipRequest(
        place_id=place_id,
        requester_user_id=requester_user_id,
        organization_id=organization_id,
        contact_name=contact_name.strip(),
        contact_email=normalized_email,
        message=(message.strip() if message else None),
    )

    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def get_ownership_request(db: Session, request_id: UUID) -> PlaceOwnershipRequest | None:
    stmt = select(PlaceOwnershipRequest).where(PlaceOwnershipRequest.id == request_id)
    return db.execute(stmt).scalar_one_or_none()


def list_ownership_requests_for_user(
    db: Session, *, user_id: UUID, limit: int = 50, offset: int = 0
) -> list[PlaceOwnershipRequest]:
    """Return every claim where the requester is ``user_id``.

    Sort: created_at DESC so the most recent submission shows up at
    the top of the user's "My claims" list. Doesn't filter by status —
    the user wants to see approved + rejected + in-flight all in one
    place, with the status badge differentiating them in the UI.

    The model's ``place`` relationship is lazy="selectin" so the join
    happens on the next access; no explicit eager-load needed here.
    """
    stmt = (
        select(PlaceOwnershipRequest)
        .where(PlaceOwnershipRequest.requester_user_id == user_id)
        .order_by(PlaceOwnershipRequest.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.execute(stmt).scalars().all())


def resubmit_ownership_request_for_review(
    db: Session,
    *,
    req: PlaceOwnershipRequest,
) -> PlaceOwnershipRequest:
    """Owner-driven resubmission of a claim that was bounced back to
    NEEDS_EVIDENCE. Flips status to UNDER_REVIEW so the admin queue
    picks it up again.

    Allowed only from NEEDS_EVIDENCE — any other status is a 409
    with ``OWNERSHIP_REQUEST_NOT_RESUBMITTABLE``. Caller is
    responsible for the ownership check (the /me/ handler does that
    via _load_owned_request before invoking this).

    Doesn't clear ``decision_note``: keeps the most recent admin
    instruction visible until admin acts again, which makes the
    audit trail clearer ("admin asked for X; owner uploaded files
    + resubmitted; admin then…").
    """
    from app.modules.places.enums import PlaceEventType
    from app.modules.places.models import PlaceEvent

    if req.status != OwnershipRequestStatus.NEEDS_EVIDENCE.value:
        raise ConflictError(
            "OWNERSHIP_REQUEST_NOT_RESUBMITTABLE",
            "Only claims in NEEDS_EVIDENCE can be resubmitted. "
            f"This claim is currently {req.status}.",
        )

    req.status = OwnershipRequestStatus.UNDER_REVIEW.value
    db.add(req)

    db.add(
        PlaceEvent(
            place_id=req.place_id,
            event_type=PlaceEventType.OWNERSHIP_REQUEST_RESUBMITTED.value,
            actor_user_id=req.requester_user_id,
            message="Owner resubmitted the claim for review",
        )
    )

    db.commit()
    db.refresh(req)
    return req