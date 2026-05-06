"""Owner-portal-facing endpoints under /me/organizations.

The admin path (``/admin/organizations``) is unchanged — staff can
still create, browse, and edit any org. This surface is what
restaurant owners use to:

  * Create their own organization (DRAFT).
  * Edit name / contact email while still DRAFT or UNDER_REVIEW.
  * Upload supporting documents (articles of organization, business
    filing, EIN letter, utility bill in the entity's name, etc.).
  * Submit the org for admin verification.
  * Review the verification status on their own claims later.

Auth: every endpoint requires a logged-in user. Membership is the
authorization gate — only ACTIVE OrganizationMember rows can read
or modify an org. The signup flow doesn't auto-create an org for
the user; they pick "Add an organization" from the portal when ready.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
)
from app.core.rate_limit import limiter, user_or_ip_key
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.organizations.models import OrganizationAttachment
from app.modules.organizations.repo import (
    create_organization_for_user,
    get_organization_for_user,
    list_organizations_for_user,
    patch_organization_for_user,
    submit_organization_for_review,
)
from app.modules.organizations.schemas import (
    MyOrganizationCreate,
    MyOrganizationPatch,
    MyOrganizationRead,
    OrganizationAttachmentRead,
)


router = APIRouter(prefix="/me/organizations", tags=["organizations"])


# ---------------------------------------------------------------------------
# Upload constraints — kept in lockstep with the claim-attachment endpoint
# ---------------------------------------------------------------------------
# Reusing the storage client and validation shape from
# /me/ownership-requests/{id}/attachments. A future refactor could
# extract the validation into a shared helper; for now duplication is
# clearer than indirection.
_ALLOWED_MIME_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heif",
}
_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
_MAX_FILES_PER_ORG = 10  # higher than per-claim — orgs may need
                         # several docs (filing + license + EIN + ...)


# ---------------------------------------------------------------------------
# Org CRUD
# ---------------------------------------------------------------------------
@router.get(
    "",
    response_model=list[MyOrganizationRead],
    summary="List the current user's organizations",
    description=(
        "Returns every organization the signed-in user is an active "
        "member of, in any status (DRAFT / UNDER_REVIEW / VERIFIED / "
        "REJECTED). Empty list when the user hasn't created or been "
        "added to any org yet."
    ),
)
def list_my_organizations(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[MyOrganizationRead]:
    """List every org the signed-in user is an active member of."""
    rows = list_organizations_for_user(db, user_id=user.id)
    return [MyOrganizationRead.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=MyOrganizationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new draft organization",
    description=(
        "Creates an organization in DRAFT status, owned by the calling "
        "user (auto-joined as OWNER_ADMIN). The org isn't reviewable "
        "by Trust Halal staff yet — the user has to upload supporting "
        "documents and call `POST /me/organizations/{id}/submit` to "
        "move it to UNDER_REVIEW. Rate-limited per-session."
    ),
)
@limiter.limit("10/hour", key_func=user_or_ip_key)
def create_my_organization(
    request: Request,
    payload: MyOrganizationCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyOrganizationRead:
    """Create a new DRAFT organization. The caller is auto-joined as
    OWNER_ADMIN. Status is DRAFT; submit for review separately once
    the user has uploaded supporting documents."""
    org = create_organization_for_user(db, user_id=user.id, payload=payload)
    return MyOrganizationRead.model_validate(org)


@router.get(
    "/{organization_id}",
    response_model=MyOrganizationRead,
    summary="Get one of the current user's organizations",
    description=(
        "Returns full detail including attached supporting documents. "
        "Returns 404 if the organization doesn't exist or 403 if the "
        "calling user isn't an active member."
    ),
)
def get_my_organization(
    organization_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyOrganizationRead:
    """Detail view, including attachments. 404/403 per the lookup
    helper's split."""
    org = get_organization_for_user(
        db, organization_id=organization_id, user_id=user.id
    )
    return MyOrganizationRead.model_validate(org)


@router.patch(
    "/{organization_id}",
    response_model=MyOrganizationRead,
    summary="Edit an organization (DRAFT or UNDER_REVIEW only)",
    description=(
        "Update name and/or contact email. Allowed while the org is "
        "still in DRAFT or UNDER_REVIEW; verified or rejected orgs are "
        "immutable from this surface (admin support handles those "
        "cases). Returns `NO_FIELDS` when the patch wouldn't change "
        "anything — clients typically no-op silently on that code."
    ),
)
def patch_my_organization(
    organization_id: UUID,
    patch: MyOrganizationPatch,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyOrganizationRead:
    """Edit name / contact email. Allowed only while DRAFT or
    UNDER_REVIEW. NO_FIELDS surfaces when nothing meaningfully
    changed; clients can no-op silently or surface a friendly toast."""
    org = patch_organization_for_user(
        db,
        organization_id=organization_id,
        user_id=user.id,
        patch=patch,
    )
    return MyOrganizationRead.model_validate(org)


@router.post(
    "/{organization_id}/submit",
    response_model=MyOrganizationRead,
    summary="Submit an organization for admin review (DRAFT → UNDER_REVIEW)",
    description=(
        "Moves the org from DRAFT to UNDER_REVIEW and queues it for "
        "Trust Halal staff. Idempotent if already UNDER_REVIEW. "
        "Requires at least one supporting document attached so admin "
        "has something to verify against — fails with "
        "`ORGANIZATION_NO_ATTACHMENTS` otherwise. Rate-limited per-"
        "session."
    ),
)
@limiter.limit("10/hour", key_func=user_or_ip_key)
def submit_my_organization(
    request: Request,
    organization_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyOrganizationRead:
    """Move DRAFT → UNDER_REVIEW. Idempotent if already
    UNDER_REVIEW. Requires at least one uploaded attachment so admin
    staff has something to verify against."""
    org = submit_organization_for_review(
        db, organization_id=organization_id, user_id=user.id
    )
    return MyOrganizationRead.model_validate(org)


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------
@router.post(
    "/{organization_id}/attachments",
    response_model=OrganizationAttachmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a supporting document for an organization",
    description=(
        "Multipart upload. Validates membership, per-org count cap "
        "(10 files), per-file size cap (10 MB), and a MIME allow-list "
        "(PDF / JPEG / PNG / HEIC / HEIF). The file goes to Supabase "
        "Storage at `organizations/<org_id>/<uuid>.<ext>`; the metadata "
        "row only writes after the storage upload succeeds. Editing is "
        "locked once the org leaves DRAFT/UNDER_REVIEW. Rate-limited "
        "per-session at 60/hour."
    ),
)
@limiter.limit("60/hour", key_func=user_or_ip_key)
def upload_organization_attachment(
    request: Request,
    organization_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    storage: StorageClient = Depends(get_storage_client),
) -> OrganizationAttachmentRead:
    """Upload a supporting document for an org under review.

    Same validation grid as the claim-attachment endpoint:
      * Caller must be an active member of the org.
      * Per-org count cap (10).
      * Per-file size cap (10 MB).
      * MIME allow-list (PDF / JPEG / PNG / HEIC / HEIF).

    File goes to ``organizations/<organization_id>/<uuid>.<ext>`` in
    the configured Supabase bucket. Storage failure rolls back
    cleanly: the metadata row only writes after the upload succeeds.

    Editing is only allowed while DRAFT or UNDER_REVIEW; once admin
    has signed off the org becomes audit-immutable and additional
    uploads reject. Verified orgs that genuinely need new docs go
    through admin support today.
    """
    org = get_organization_for_user(
        db, organization_id=organization_id, user_id=user.id
    )

    # Lock down editing once admin has reviewed.
    if org.status not in ("DRAFT", "UNDER_REVIEW"):
        raise ConflictError(
            "OWNER_ORGANIZATION_NOT_EDITABLE",
            f"Organizations with status {org.status} can no longer accept "
            "new files. Contact Trust Halal support if you need a change.",
        )

    if len(org.attachments) >= _MAX_FILES_PER_ORG:
        raise ConflictError(
            "ORGANIZATION_ATTACHMENT_LIMIT_REACHED",
            f"You can attach at most {_MAX_FILES_PER_ORG} files to an "
            "organization. Remove one or contact support if you need "
            "to share more.",
        )

    content_type = (file.content_type or "").lower()
    if content_type not in _ALLOWED_MIME_TYPES:
        raise BadRequestError(
            "ORGANIZATION_ATTACHMENT_TYPE_NOT_ALLOWED",
            "Allowed file types: PDF, JPEG, PNG, HEIC. "
            f"Received: {file.content_type or 'unknown'}.",
        )
    extension = _ALLOWED_MIME_TYPES[content_type]

    contents = file.file.read()
    size_bytes = len(contents)
    if size_bytes == 0:
        raise BadRequestError(
            "ORGANIZATION_ATTACHMENT_EMPTY",
            "Uploaded file appears to be empty.",
        )
    if size_bytes > _MAX_FILE_SIZE_BYTES:
        raise BadRequestError(
            "ORGANIZATION_ATTACHMENT_TOO_LARGE",
            f"Files must be {_MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB "
            "or smaller.",
        )

    object_uuid = uuid4()
    storage_path = f"organizations/{org.id}/{object_uuid}.{extension}"
    try:
        storage.upload_bytes(
            storage_path, contents, content_type=content_type
        )
    except StorageError as exc:
        raise BadRequestError(
            "ORGANIZATION_ATTACHMENT_UPLOAD_FAILED",
            f"Couldn't store the uploaded file. Please try again. ({exc})",
        )

    original_filename = (file.filename or f"upload.{extension}").strip()
    if len(original_filename) > 512:
        original_filename = original_filename[:512]

    attachment = OrganizationAttachment(
        id=object_uuid,
        organization_id=org.id,
        storage_path=storage_path,
        original_filename=original_filename,
        content_type=content_type,
        size_bytes=size_bytes,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return OrganizationAttachmentRead.model_validate(attachment)


@router.get(
    "/{organization_id}/attachments",
    response_model=list[OrganizationAttachmentRead],
    summary="List attachments on an organization",
    description=(
        "Returns the supporting-document metadata (filename, mime, "
        "size, storage path). Does NOT issue signed URLs — the owner "
        "portal already has the org detail in cache; this endpoint is "
        "primarily for admin tooling and tests."
    ),
)
def list_organization_attachments(
    organization_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[OrganizationAttachmentRead]:
    """List the attachments on one of your organizations."""
    org = get_organization_for_user(
        db, organization_id=organization_id, user_id=user.id
    )
    return [
        OrganizationAttachmentRead.model_validate(a)
        for a in org.attachments
    ]
