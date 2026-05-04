"""Owner-portal-facing endpoints under ``/me/halal-claims``.

Phase 2 of the halal-trust v2 rebuild. Owner can:

  * Create a draft claim (with sponsoring org + place ownership
    gates).
  * List their own claims.
  * Get a single claim's detail with attachments.
  * Patch the questionnaire while DRAFT.
  * Submit DRAFT → PENDING_REVIEW. Strict questionnaire validation
    runs at this step.
  * Upload evidence files (halal cert / supplier letter / invoice /
    photo / other) — same Supabase Storage shape as the existing
    org and ownership-request attachment endpoints.

Admin review (approve / reject / NEEDS_MORE_INFO) lands in Phase 3.
The profile-derivation service that actually flips the place's
HalalProfile on approval also lands in Phase 3.

Auth: every endpoint requires a logged-in user. Authorization is
enforced in ``halal_claims.repo`` — the route layer is mostly
plumbing.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.core.exceptions import BadRequestError, ConflictError
from app.core.rate_limit import limiter, user_or_ip_key
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.halal_claims.enums import (
    HalalClaimAttachmentType,
    HalalClaimStatus,
)
from app.modules.halal_claims.models import HalalClaimAttachment
from app.modules.halal_claims.repo import (
    create_halal_claim_for_user,
    get_halal_claim_for_user,
    list_halal_claims_for_user,
    patch_halal_claim_for_user,
    submit_halal_claim_for_user,
)
from app.modules.halal_claims.schemas import (
    HalalClaimAttachmentRead,
    MyHalalClaimCreate,
    MyHalalClaimPatch,
    MyHalalClaimRead,
)


router = APIRouter(prefix="/me/halal-claims", tags=["halal-claims"])


# ---------------------------------------------------------------------------
# Attachment validation knobs (lockstep with org / ownership-request uploads)
# ---------------------------------------------------------------------------
_ALLOWED_MIME_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heif",
}
_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
# Tighter than org attachments (10) — a single halal claim shouldn't
# need that many docs (cert + supplier letter + a couple of invoices
# is the typical max). Higher cap encouraged via Phase 3 admin
# request-more-info loop, not a single mega-upload.
_MAX_FILES_PER_CLAIM = 8


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[MyHalalClaimRead])
def list_my_halal_claims(
    limit: int = Query(default=50, gt=0, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[MyHalalClaimRead]:
    """List the caller's halal claims (newest first).

    Powers the owner portal's 'My halal claims' page. Pagination
    capped at 200 — realistic owners won't have anywhere near that
    many; the bound is cheap insurance against a runaway query.
    """
    rows = list_halal_claims_for_user(
        db, user_id=user.id, limit=limit, offset=offset
    )
    return [MyHalalClaimRead.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=MyHalalClaimRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/hour", key_func=user_or_ip_key)
def create_my_halal_claim(
    request: Request,
    payload: MyHalalClaimCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyHalalClaimRead:
    """Create a DRAFT halal claim.

    Authorization gates run in the repo:
      * Caller must be an ACTIVE member of the sponsoring org.
      * Org must be UNDER_REVIEW or VERIFIED (DRAFT/REJECTED orgs
        can't sponsor).
      * Org must have an ACTIVE PlaceOwner row for the place.

    The questionnaire is optional at create — owners typically
    save partial progress across multiple sessions. Validation
    that all required fields are populated runs at submit time.

    Rate-limited per session at 10/hour.
    """
    claim = create_halal_claim_for_user(
        db, user_id=user.id, payload=payload
    )
    return MyHalalClaimRead.model_validate(claim)


@router.get("/{claim_id}", response_model=MyHalalClaimRead)
def get_my_halal_claim(
    claim_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyHalalClaimRead:
    """Single claim detail. 404 on unknown id, 403 on not-yours."""
    claim = get_halal_claim_for_user(
        db, claim_id=claim_id, user_id=user.id
    )
    return MyHalalClaimRead.model_validate(claim)


@router.patch("/{claim_id}", response_model=MyHalalClaimRead)
def patch_my_halal_claim(
    claim_id: UUID,
    patch: MyHalalClaimPatch,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyHalalClaimRead:
    """Update a DRAFT claim's questionnaire.

    Only the structured_response can be changed; place_id and
    organization_id are immutable post-create. Owners who picked
    the wrong values discard the draft and start fresh.

    409 ``HALAL_CLAIM_NOT_EDITABLE`` once the claim leaves DRAFT.
    """
    claim = patch_halal_claim_for_user(
        db, claim_id=claim_id, user_id=user.id, patch=patch
    )
    return MyHalalClaimRead.model_validate(claim)


@router.post(
    "/{claim_id}/submit",
    response_model=MyHalalClaimRead,
)
@limiter.limit("20/hour", key_func=user_or_ip_key)
def submit_my_halal_claim(
    request: Request,
    claim_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyHalalClaimRead:
    """Move DRAFT → PENDING_REVIEW.

    Re-validates the stored questionnaire against the strict shape
    (``HalalQuestionnaireResponse``). Any missing required answers
    return a 400 with the field-level errors under
    ``error.detail`` so the frontend can surface inline validation.

    Idempotent on PENDING_REVIEW (no error, no state change).
    """
    claim = submit_halal_claim_for_user(
        db, claim_id=claim_id, user_id=user.id
    )
    return MyHalalClaimRead.model_validate(claim)


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------


@router.post(
    "/{claim_id}/attachments",
    response_model=HalalClaimAttachmentRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("60/hour", key_func=user_or_ip_key)
def upload_my_halal_claim_attachment(
    request: Request,
    claim_id: UUID,
    file: UploadFile = File(...),
    document_type: HalalClaimAttachmentType = Form(
        default=HalalClaimAttachmentType.OTHER
    ),
    issuing_authority: Optional[str] = Form(default=None),
    certificate_number: Optional[str] = Form(default=None),
    valid_until: Optional[datetime] = Form(default=None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    storage: StorageClient = Depends(get_storage_client),
) -> HalalClaimAttachmentRead:
    """Upload an evidence document for a halal claim.

    Multipart upload with optional metadata fields:

      * ``document_type`` — HALAL_CERTIFICATE | SUPPLIER_LETTER |
        INVOICE | PHOTO | OTHER. Drives admin-side icon + section.
      * ``issuing_authority`` / ``certificate_number`` /
        ``valid_until`` — only meaningful for HALAL_CERTIFICATE,
        nullable for everything else.

    Validation grid mirrors the org + ownership-request endpoints:
    membership / draft-or-pending status, count cap (8 per claim),
    size cap (10 MB), MIME allow-list (PDF / JPEG / PNG / HEIC /
    HEIF). Storage key is
    ``halal-claims/<claim_id>/<uuid>.<ext>``.

    Re-uploading replaces nothing — each upload creates a new row,
    keeping the audit trail intact. Owner can delete drafts'
    attachments via DELETE in a later phase if needed; for now
    the workflow is "discard draft, start fresh."

    Rate-limited per session at 60/hour.
    """
    claim = get_halal_claim_for_user(
        db, claim_id=claim_id, user_id=user.id
    )

    # Editing is allowed during DRAFT (owner is iterating) and
    # NEEDS_MORE_INFO (admin asked for more) — the admin-driven
    # "give me more evidence" workflow needs the upload path open
    # without requiring the owner to flip back to DRAFT.
    if claim.status not in (
        HalalClaimStatus.DRAFT.value,
        HalalClaimStatus.NEEDS_MORE_INFO.value,
    ):
        raise ConflictError(
            "HALAL_CLAIM_NOT_EDITABLE",
            (
                f"Claim is in status {claim.status}; new files can't "
                "be attached. Submit a fresh claim or wait for admin "
                "to request more info."
            ),
        )

    if len(claim.attachments) >= _MAX_FILES_PER_CLAIM:
        raise ConflictError(
            "HALAL_CLAIM_ATTACHMENT_LIMIT_REACHED",
            (
                f"You can attach at most {_MAX_FILES_PER_CLAIM} files "
                "to a halal claim. Remove one or contact support if "
                "you need to share more."
            ),
        )

    content_type = (file.content_type or "").lower()
    if content_type not in _ALLOWED_MIME_TYPES:
        raise BadRequestError(
            "HALAL_CLAIM_ATTACHMENT_TYPE_NOT_ALLOWED",
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
            "HALAL_CLAIM_ATTACHMENT_EMPTY",
            "Uploaded file appears to be empty.",
        )
    if size_bytes > _MAX_FILE_SIZE_BYTES:
        raise BadRequestError(
            "HALAL_CLAIM_ATTACHMENT_TOO_LARGE",
            (
                f"Files must be {_MAX_FILE_SIZE_BYTES // (1024 * 1024)} "
                "MB or smaller."
            ),
        )

    object_uuid = uuid4()
    storage_path = f"halal-claims/{claim.id}/{object_uuid}.{extension}"
    try:
        storage.upload_bytes(
            storage_path, contents, content_type=content_type
        )
    except StorageError as exc:
        # No metadata row yet, so nothing to roll back; the caller
        # gets a clean retry path.
        raise BadRequestError(
            "HALAL_CLAIM_ATTACHMENT_UPLOAD_FAILED",
            f"Couldn't store the uploaded file. Please try again. ({exc})",
        )

    original_filename = (file.filename or f"upload.{extension}").strip()
    if len(original_filename) > 512:
        original_filename = original_filename[:512]

    attachment = HalalClaimAttachment(
        id=object_uuid,
        claim_id=claim.id,
        document_type=document_type.value,
        issuing_authority=issuing_authority,
        certificate_number=certificate_number,
        valid_until=valid_until,
        storage_path=storage_path,
        original_filename=original_filename,
        content_type=content_type,
        size_bytes=size_bytes,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return HalalClaimAttachmentRead.model_validate(attachment)


@router.get(
    "/{claim_id}/attachments",
    response_model=list[HalalClaimAttachmentRead],
)
def list_my_halal_claim_attachments(
    claim_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[HalalClaimAttachmentRead]:
    """List metadata for the claim's evidence files. Bytes are not
    returned — frontends fetch via signed URL (Phase 3 admin endpoint;
    owner re-fetches the claim and reads ``attachments`` instead)."""
    claim = get_halal_claim_for_user(
        db, claim_id=claim_id, user_id=user.id
    )
    return [
        HalalClaimAttachmentRead.model_validate(a) for a in claim.attachments
    ]
