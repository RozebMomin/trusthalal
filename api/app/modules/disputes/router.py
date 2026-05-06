"""Consumer-facing dispute endpoints.

Two prefixes share this module:

  * ``POST /places/{place_id}/disputes`` — file a new dispute. The
    place is part of the URL because that's the natural shape from
    a consumer's perspective ("I want to dispute this place").
  * ``/me/disputes/*`` — a reporter's own disputes (list, get,
    withdraw, attachment upload). Mirrors the ``/me/halal-claims``
    shape so frontends share one mental model for "things I filed."

Auth: every endpoint requires a signed-in user. Anonymous disputes
aren't supported by design — accountability matters more than the
small bump in submission volume an anonymous form would generate.
"""
from __future__ import annotations

from io import BytesIO
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.core.exceptions import BadRequestError, ConflictError, NotFoundError
from app.core.rate_limit import limiter, user_or_ip_key
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.disputes.enums import DisputeStatus
from app.modules.disputes.models import ConsumerDispute, ConsumerDisputeAttachment
from app.modules.disputes.repo import (
    file_dispute,
    get_dispute_for_reporter,
    list_disputes_for_reporter,
    withdraw_dispute,
)
from app.modules.disputes.schemas import (
    ConsumerDisputeAttachmentRead,
    ConsumerDisputeCreate,
    ConsumerDisputeReporterRead,
)


# ---------------------------------------------------------------------------
# Attachment validation knobs
# ---------------------------------------------------------------------------
# Photos + PDFs only — disputes attach evidence (a receipt, a photo
# of the menu, a screenshot of an ad). Tighter MIME list than the
# halal-claim uploads because we don't expect spreadsheets / docs
# from consumers.
_ALLOWED_MIME_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heif",
}
_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
_MAX_FILES_PER_DISPUTE = 5


# ---------------------------------------------------------------------------
# Routers — one per URL prefix
# ---------------------------------------------------------------------------

# /places/{place_id}/disputes — the public file path. Tagged under
# "places" so it lives next to the rest of the place surface in the
# OpenAPI docs.
place_disputes_router = APIRouter(prefix="/places", tags=["disputes"])


@place_disputes_router.post(
    "/{place_id}/disputes",
    response_model=ConsumerDisputeReporterRead,
    status_code=status.HTTP_201_CREATED,
    summary="File a dispute on a place",
    description=(
        "Signed-in consumers report that a place's halal profile is "
        "wrong (pork served, alcohol present, slaughter method "
        "incorrect, etc.). Filing flips the place's halal profile "
        "into a DISPUTED state, visible to consumers as a "
        "'conflicting reports' badge until admin resolves. "
        "Rate-limited at 10/hour per user."
    ),
)
@limiter.limit("10/hour", key_func=user_or_ip_key)
def file_place_dispute(
    request: Request,
    place_id: UUID,
    payload: ConsumerDisputeCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ConsumerDisputeReporterRead:
    """Create a new dispute against the given place."""
    dispute = file_dispute(
        db,
        place_id=place_id,
        reporter_user_id=user.id,
        payload=payload,
    )
    return ConsumerDisputeReporterRead.model_validate(dispute)


# /me/disputes — the reporter-self prefix. Tagged the same way for
# the OpenAPI grouping; the URL distinction is enough.
me_disputes_router = APIRouter(prefix="/me/disputes", tags=["disputes"])


@me_disputes_router.get(
    "",
    response_model=list[ConsumerDisputeReporterRead],
    summary="List the reporter's own disputes",
    description=(
        "Newest-first list of disputes filed by the signed-in user. "
        "Pagination capped at 200 — realistic reporters will have "
        "single-digit dispute counts; the bound is cheap insurance "
        "against runaway queries."
    ),
)
def list_my_disputes(
    limit: int = Query(default=50, gt=0, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[ConsumerDisputeReporterRead]:
    rows = list_disputes_for_reporter(
        db, reporter_user_id=user.id, limit=limit, offset=offset
    )
    return [ConsumerDisputeReporterRead.model_validate(r) for r in rows]


@me_disputes_router.get(
    "/{dispute_id}",
    response_model=ConsumerDisputeReporterRead,
    summary="Get one of the reporter's disputes",
    description=(
        "Reporter-self view with attachments. 404 on unknown id; "
        "403 if the id exists but belongs to another user."
    ),
)
def get_my_dispute(
    dispute_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ConsumerDisputeReporterRead:
    dispute = get_dispute_for_reporter(
        db, dispute_id=dispute_id, reporter_user_id=user.id
    )
    return ConsumerDisputeReporterRead.model_validate(dispute)


@me_disputes_router.post(
    "/{dispute_id}/withdraw",
    response_model=ConsumerDisputeReporterRead,
    summary="Withdraw an OPEN dispute",
    description=(
        "Reporter pulls back a dispute they've filed. Only OPEN "
        "disputes can be withdrawn — once admin or owner has "
        "engaged with it, the dispute is locked from the consumer "
        "side. Withdraws clear the place's DISPUTED badge if no "
        "other active disputes remain."
    ),
)
def withdraw_my_dispute(
    dispute_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ConsumerDisputeReporterRead:
    dispute = withdraw_dispute(
        db, dispute_id=dispute_id, reporter_user_id=user.id
    )
    return ConsumerDisputeReporterRead.model_validate(dispute)


@me_disputes_router.post(
    "/{dispute_id}/attachments",
    response_model=ConsumerDisputeAttachmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload evidence to a dispute",
    description=(
        "Multipart upload. Allowed only while the dispute is OPEN — "
        "once admin starts reviewing, the evidence set is frozen. "
        "MIME allow-list (PDF / JPEG / PNG / HEIC / HEIF), 10 MB "
        "per file, 5 files per dispute. Storage key is "
        "`disputes/{dispute_id}/{uuid}.{ext}`."
    ),
)
@limiter.limit("30/hour", key_func=user_or_ip_key)
def upload_my_dispute_attachment(
    request: Request,
    dispute_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    storage: StorageClient = Depends(get_storage_client),
) -> ConsumerDisputeAttachmentRead:
    dispute = get_dispute_for_reporter(
        db, dispute_id=dispute_id, reporter_user_id=user.id
    )

    if dispute.status != DisputeStatus.OPEN.value:
        raise ConflictError(
            "CONSUMER_DISPUTE_NOT_EDITABLE",
            (
                f"Dispute is in status {dispute.status}; new evidence "
                "can't be attached."
            ),
        )

    if len(dispute.attachments) >= _MAX_FILES_PER_DISPUTE:
        raise ConflictError(
            "CONSUMER_DISPUTE_ATTACHMENT_LIMIT_REACHED",
            (
                f"You can attach at most {_MAX_FILES_PER_DISPUTE} "
                "files to a dispute."
            ),
        )

    content_type = (file.content_type or "").lower()
    if content_type not in _ALLOWED_MIME_TYPES:
        raise BadRequestError(
            "CONSUMER_DISPUTE_ATTACHMENT_TYPE_NOT_ALLOWED",
            (
                "Allowed file types: PDF, JPEG, PNG, HEIC. "
                f"Received: {file.content_type or 'unknown'}."
            ),
        )
    extension = _ALLOWED_MIME_TYPES[content_type]

    contents = file.file.read()
    size_bytes = len(contents)
    if size_bytes == 0:
        raise BadRequestError(
            "CONSUMER_DISPUTE_ATTACHMENT_EMPTY",
            "Uploaded file appears to be empty.",
        )
    if size_bytes > _MAX_FILE_SIZE_BYTES:
        raise BadRequestError(
            "CONSUMER_DISPUTE_ATTACHMENT_TOO_LARGE",
            (
                f"Files must be {_MAX_FILE_SIZE_BYTES // (1024 * 1024)} "
                "MB or smaller."
            ),
        )

    object_uuid = uuid4()
    storage_path = f"disputes/{dispute.id}/{object_uuid}.{extension}"
    try:
        storage.upload_bytes(
            storage_path, contents, content_type=content_type
        )
    except StorageError as exc:
        raise BadRequestError(
            "CONSUMER_DISPUTE_ATTACHMENT_UPLOAD_FAILED",
            f"Couldn't store the uploaded file. Please try again. ({exc})",
        )

    original_filename = (file.filename or f"upload.{extension}").strip()
    if len(original_filename) > 512:
        original_filename = original_filename[:512]

    attachment = ConsumerDisputeAttachment(
        id=object_uuid,
        dispute_id=dispute.id,
        storage_path=storage_path,
        original_filename=original_filename,
        content_type=content_type,
        size_bytes=size_bytes,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return ConsumerDisputeAttachmentRead.model_validate(attachment)


# Compose: each prefix gets its own router; main.py includes both.
__all__ = ["place_disputes_router", "me_disputes_router"]
