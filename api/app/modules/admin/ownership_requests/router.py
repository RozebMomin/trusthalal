from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.admin.ownership_requests.repo import (
    admin_approve_ownership_request,
    admin_create_ownership_request,
    admin_list_ownership_requests,
    admin_reject_ownership_request,
    admin_request_more_evidence,
)
from app.modules.admin.ownership_requests.schemas import (
    OwnershipRequestAdminCreate,
    OwnershipRequestAdminRead,
    OwnershipRequestApprove,
    OwnershipRequestEvidence,
    OwnershipRequestReject,
)
from app.modules.ownership_requests.models import OwnershipRequestAttachment
from app.modules.ownership_requests.repo import get_ownership_request
from app.modules.ownership_requests.schemas import OwnershipRequestAttachmentRead
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/ownership-requests", tags=["admin"])


@router.post(
    "",
    response_model=OwnershipRequestAdminRead,
    status_code=status.HTTP_201_CREATED,
)
def create_ownership_request_admin(
    payload: OwnershipRequestAdminCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OwnershipRequestAdminRead:
    """Create an ownership request on someone's behalf (admin path).

    Use when an admin takes an inbound request by phone, email, or
    in-person and wants to capture it in the system without the
    claimant going through the public submit flow. ``requester_user_id``
    can be null for unauthenticated intakes; set it to a real user id
    when the claimant has an account and you want them to be able to
    see the request later via ``GET /ownership-requests/{id}/detail``.
    """
    return admin_create_ownership_request(db, payload=payload)


@router.get("", response_model=list[OwnershipRequestAdminRead])
def list_ownership_requests(
    status: str | None = Query(default=None, max_length=50),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[OwnershipRequestAdminRead]:
    return admin_list_ownership_requests(db, status=status, limit=limit, offset=offset)


@router.post("/{request_id}/approve", response_model=OwnershipRequestAdminRead)
def approve_ownership_request(
    request_id: UUID,
    payload: OwnershipRequestApprove,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OwnershipRequestAdminRead:
    return admin_approve_ownership_request(
        db,
        request_id=request_id,
        payload=payload,
        actor_user_id=user.id,
    )


@router.post("/{request_id}/reject", response_model=OwnershipRequestAdminRead)
def reject_ownership_request(
    request_id: UUID,
    payload: OwnershipRequestReject,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OwnershipRequestAdminRead:
    return admin_reject_ownership_request(
        db,
        request_id=request_id,
        payload=payload,
        actor_user_id=user.id,
    )


@router.post(
    "/{request_id}/request-evidence",
    response_model=OwnershipRequestAdminRead,
)
def request_more_evidence(
    request_id: UUID,
    payload: OwnershipRequestEvidence,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OwnershipRequestAdminRead:
    return admin_request_more_evidence(
        db,
        request_id=request_id,
        payload=payload,
        actor_user_id=user.id,
    )


# ---------------------------------------------------------------------------
# Evidence viewer — admin-only endpoints to list + sign attachment URLs
# ---------------------------------------------------------------------------
# These endpoints power the admin claim-review UI's "Evidence" section.
# Listing returns the same metadata the owner sees (filename + size +
# upload time); the signed-URL endpoint hands back a short-lived URL
# the admin browser can navigate to for download. We mint a fresh
# signed URL on every click so a copied URL doesn't outlive its
# expiry — keeps the security posture tight.
#
# The signed URL lifetime is intentionally short (60s default). Long
# enough for a click-then-redirect; short enough that a leaked URL is
# moot within seconds. If admin staff ever needs persistent access to
# a file (e.g. for an external escalation), we can add a longer-TTL
# variant or a "download as" endpoint that streams through our API.

# Default signed-URL TTL. Tuned to "long enough for a single click,
# short enough that a stale link doesn't hang around."
_SIGNED_URL_TTL_SECONDS = 60


class _AdminAttachmentSignedUrl(BaseModel):
    """Response shape for the signed-URL endpoint.

    Plain object instead of returning a redirect so the client can
    decide whether to open the URL in a new tab, download with a
    given filename, render an inline preview, etc.
    """

    url: str
    expires_in_seconds: int
    original_filename: str
    content_type: str


@router.get(
    "/{request_id}/attachments",
    response_model=list[OwnershipRequestAttachmentRead],
)
def list_attachments_admin(
    request_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[OwnershipRequestAttachmentRead]:
    """List every file attached to a claim under admin review."""
    req = get_ownership_request(db, request_id)
    if req is None:
        raise NotFoundError(
            "OWNERSHIP_REQUEST_NOT_FOUND", "Ownership request not found"
        )
    return [
        OwnershipRequestAttachmentRead.model_validate(a)
        for a in req.attachments
    ]


@router.get(
    "/{request_id}/attachments/{attachment_id}/url",
    response_model=_AdminAttachmentSignedUrl,
)
def signed_url_for_attachment_admin(
    request_id: UUID,
    attachment_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    storage: StorageClient = Depends(get_storage_client),
) -> _AdminAttachmentSignedUrl:
    """Mint a short-lived signed URL the admin browser can use to
    download or preview an attachment.

    The endpoint takes both ``request_id`` and ``attachment_id`` and
    asserts the attachment belongs to that request. Defends against
    a guessed UUID surfacing files for an unrelated claim.
    """
    attachment = db.execute(
        select(OwnershipRequestAttachment).where(
            OwnershipRequestAttachment.id == attachment_id,
            OwnershipRequestAttachment.request_id == request_id,
        )
    ).scalar_one_or_none()
    if attachment is None:
        raise NotFoundError(
            "ATTACHMENT_NOT_FOUND",
            "No attachment with that id on this ownership request.",
        )

    try:
        url = storage.signed_url(
            attachment.storage_path,
            expires_in_seconds=_SIGNED_URL_TTL_SECONDS,
        )
    except StorageError as exc:
        # Surface a clean code so the admin UI can render
        # "Couldn't generate download link, retry" rather than a 500.
        raise BadRequestError(
            "ATTACHMENT_SIGNED_URL_FAILED",
            f"Couldn't generate a download link for this attachment: {exc}",
        )

    return _AdminAttachmentSignedUrl(
        url=url,
        expires_in_seconds=_SIGNED_URL_TTL_SECONDS,
        original_filename=attachment.original_filename,
        content_type=attachment.content_type,
    )
