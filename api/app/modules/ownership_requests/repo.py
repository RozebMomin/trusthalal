from uuid import UUID

from sqlalchemy import func, select
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
    contact_phone: str | None,
    message: str | None,
) -> PlaceOwnershipRequest:
    normalized_email = contact_email.strip().lower()

    existing = db.execute(
        select(PlaceOwnershipRequest.id)
        .where(PlaceOwnershipRequest.place_id == place_id)
        .where(func.lower(PlaceOwnershipRequest.contact_email) == normalized_email)
        .where(PlaceOwnershipRequest.status.in_([s.value for s in ACTIVE_STATUSES]))
    ).scalar_one_or_none()

    if existing:
        raise ConflictError(
            "OWNERSHIP_REQUEST_ALREADY_EXISTS",
            "An active ownership request already exists for this place and email.",
        )

    req = PlaceOwnershipRequest(
        place_id=place_id,
        requester_user_id=requester_user_id,
        contact_name=contact_name.strip(),
        contact_email=normalized_email,
        contact_phone=(contact_phone.strip() if contact_phone else None),
        message=(message.strip() if message else None),
    )

    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def get_ownership_request(db: Session, request_id: UUID) -> PlaceOwnershipRequest | None:
    stmt = select(PlaceOwnershipRequest).where(PlaceOwnershipRequest.id == request_id)
    return db.execute(stmt).scalar_one_or_none()