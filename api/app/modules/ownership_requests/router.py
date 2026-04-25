from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user, get_current_user_optional
from app.core.exceptions import ForbiddenError, NotFoundError
from app.db.deps import get_db
from app.modules.ownership_requests.repo import (
    create_ownership_request,
    get_ownership_request,
    list_ownership_requests_for_user,
)
from app.modules.ownership_requests.schemas import (
    MyOwnershipRequestCreate,
    MyOwnershipRequestRead,
    OwnershipRequestCreate,
    OwnershipRequestDetailRead,
    OwnershipRequestRead,
    OwnershipRequestStatusRead,
)
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


# ---------------------------------------------------------------------------
# /me/ownership-requests — owner-portal-facing claim flow
# ---------------------------------------------------------------------------
# These endpoints power the owner portal's "claim a place" flow. They
# differ from the public ``/places/{place_id}/ownership-requests`` path
# in two ways:
#   1. Authentication is REQUIRED (the cookie identifies the user) so
#      contact_name + contact_email can be auto-filled from the User
#      record. Owners shouldn't have to retype info we already have.
#   2. The list endpoint scopes results to the authenticated user
#      automatically, so a stale cache or URL guess can't surface
#      another user's claim queue.
#
# We intentionally don't role-gate these to OWNER. The signup endpoint
# hard-codes role=OWNER, so in practice every caller IS an OWNER, but
# nothing prevents a hypothetical future flow (e.g. a CONSUMER who
# wants to claim a venue they actually run) from reusing this surface.
# Admin staff have their own /admin/ownership-requests path; if an
# admin happens to also be a restaurant owner and wants to claim
# through here, that's a legitimate use case.


@router.post(
    "/me/ownership-requests",
    response_model=MyOwnershipRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def submit_my_ownership_request(
    payload: MyOwnershipRequestCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyOwnershipRequestRead:
    """Create an ownership claim on behalf of the signed-in user.

    Same downstream effect as the public path: the row goes into
    ``place_ownership_requests`` with status SUBMITTED, the requester
    is linked back to the user, admin staff sees it in the review
    queue. The duplicate-active-claim guard in the repo (same place +
    same email + still-active status) prevents an owner from
    re-submitting while their first attempt is in flight.

    Contact name + email are pulled from the user's profile rather
    than the request body. ``display_name`` is non-null on signup, but
    we fall back to the email's local-part if it's somehow blank — we
    never want admin staff to see a literally empty contact_name.
    """
    place = get_place(db, payload.place_id)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    contact_name = (user.display_name or "").strip()
    if not contact_name:
        # Belt-and-suspenders: signup enforces a non-empty display_name,
        # but legacy rows pre-dating that rule may exist (admin-invited
        # users who never set one). The local-part of the email is a
        # reasonable fallback — admin can always check the email
        # column for the canonical identity.
        contact_name = user.email.split("@", 1)[0] or user.email

    req = create_ownership_request(
        db,
        place_id=payload.place_id,
        requester_user_id=user.id,
        contact_name=contact_name,
        contact_email=user.email,
        contact_phone=payload.contact_phone,
        message=payload.message,
    )
    return MyOwnershipRequestRead.model_validate(
        {
            "id": req.id,
            "place": req.place,
            "status": req.status,
            "message": req.message,
            "created_at": req.created_at,
            "updated_at": req.updated_at,
        }
    )


@router.get(
    "/me/ownership-requests",
    response_model=list[MyOwnershipRequestRead],
)
def list_my_ownership_requests(
    limit: int = Query(default=50, gt=0, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[MyOwnershipRequestRead]:
    """List the signed-in user's claims, newest first.

    The owner portal's home page calls this to render "Recent claims"
    and the /my-claims page to render the full list. Page size caps
    at 200 — the catalog of claims per individual owner is realistic-
    ally tiny, but the bound is cheap insurance against runaway
    queries from a copy-paste of the admin pagination shape.
    """
    rows = list_ownership_requests_for_user(
        db, user_id=user.id, limit=limit, offset=offset
    )
    return [
        MyOwnershipRequestRead.model_validate(
            {
                "id": r.id,
                "place": r.place,
                "status": r.status,
                "message": r.message,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
        )
        for r in rows
    ]