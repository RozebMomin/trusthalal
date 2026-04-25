from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user_optional
from app.core.exceptions import ForbiddenError, NotFoundError
from app.db.deps import get_db
from app.modules.ownership_requests.repo import create_ownership_request, get_ownership_request
from app.modules.ownership_requests.schemas import OwnershipRequestCreate, OwnershipRequestDetailRead, OwnershipRequestRead, OwnershipRequestStatusRead
from app.modules.places.repo import get_place
from app.modules.users.enums import UserRole

router = APIRouter(tags=["ownership-requests"])


@router.post(
    "/places/{place_id}/ownership-requests",
    response_model=OwnershipRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def submit_ownership_request(
    place_id: UUID,
    payload: OwnershipRequestCreate,
    db: Session = Depends(get_db),
    user: CurrentUser | None = Depends(get_current_user_optional),
) -> OwnershipRequestRead:
    # Validates place exists and is not deleted (your get_place already enforces this)
    place = get_place(db, place_id)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    req = create_ownership_request(
        db,
        place_id=place_id,
        requester_user_id=(user.id if user else None),
        contact_name=payload.contact_name,
        contact_email=str(payload.contact_email),
        contact_phone=payload.contact_phone,
        message=payload.message,
    )
    return req


@router.get("/ownership-requests/{request_id}", response_model=OwnershipRequestStatusRead)
def get_ownership_request_status(
    request_id: UUID,
    db: Session = Depends(get_db),
) -> OwnershipRequestStatusRead:
    req = get_ownership_request(db, request_id)
    if not req:
        raise NotFoundError("OWNERSHIP_REQUEST_NOT_FOUND", "Ownership request not found")
    return req


@router.get(
    "/ownership-requests/{request_id}/detail",
    response_model=OwnershipRequestDetailRead,
)
def get_ownership_request_detail(
    request_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser | None = Depends(get_current_user_optional),
) -> OwnershipRequestDetailRead:
    req = get_ownership_request(db, request_id)
    if not req:
        raise NotFoundError(
            "OWNERSHIP_REQUEST_NOT_FOUND",
            "Ownership request not found",
        )

    # Admin can always view
    if user and user.role == UserRole.ADMIN:
        return req

    # Requester can view their own request
    if user and req.requester_user_id == user.id:
        return req

    raise ForbiddenError(
        "OWNERSHIP_REQUEST_FORBIDDEN",
        "You do not have access to this ownership request",
    )