from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user, get_current_user_optional
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
)
from app.core.rate_limit import limiter, user_or_ip_key
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.ownership_requests.models import OwnershipRequestAttachment
from app.modules.ownership_requests.repo import (
    create_ownership_request,
    get_ownership_request,
    list_ownership_requests_for_user,
)
from app.modules.ownership_requests.schemas import (
    MyOwnershipRequestCreate,
    MyOwnershipRequestRead,
    OwnershipRequestAttachmentRead,
    OwnershipRequestCreate,
    OwnershipRequestDetailRead,
    OwnershipRequestRead,
    OwnershipRequestStatusRead,
)
from app.modules.organizations.enums import OrganizationStatus
from app.modules.organizations.repo import get_organization_for_user
from app.modules.places.ingest import ingest_google_place
from app.modules.places.repo import get_place
from app.modules.users.enums import UserRole
from app.modules.users.models import User

router = APIRouter(tags=["ownership-requests"])


@router.post(
    "/places/{place_id}/ownership-requests",
    response_model=OwnershipRequestRead,
    status_code=status.HTTP_201_CREATED,
    summary="Public ownership claim submission (anonymous OK)",
    description=(
        "Public path used by the consumer site or any 'I own this "
        "restaurant, get me on your list' flow. Caller can be "
        "unauthenticated — the contact_name + contact_email + "
        "contact_phone come from the request body. Rejects with "
        "`PLACE_NOT_FOUND` if the place is missing or hard-deleted. "
        "Owners signed into the portal should use `POST /me/ownership-"
        "requests` instead — that path enforces the org-sponsor "
        "requirement and ties claims back to their account."
    ),
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


@router.get(
    "/ownership-requests/{request_id}",
    response_model=OwnershipRequestStatusRead,
    summary="Get an ownership request's status (slim, public)",
    description=(
        "Returns just the status fields — used by the public 'check "
        "the status of my submission' page. The richer detail view "
        "(message, attachments) lives at "
        "`/ownership-requests/{id}/detail` and is access-gated."
    ),
)
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
    summary="Get an ownership request's full detail (admin or requester only)",
    description=(
        "Returns the message body, attached evidence metadata, and "
        "decision context. Visible to ADMIN role or the user who "
        "submitted the request. Other authenticated callers get a 403."
    ),
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
    summary="Owner-portal claim submission (auth required, ties to an org)",
    description=(
        "The authenticated owner-portal path. Differences from the "
        "public submission:\n\n"
        "* `requester_user_id` is set from the session cookie, not the "
        "body.\n"
        "* `contact_name` + `contact_email` are read from the user's "
        "profile.\n"
        "* A sponsoring `organization_id` is REQUIRED (must be "
        "UNDER_REVIEW or VERIFIED).\n"
        "* Two ways to identify the place: `place_id` for an existing "
        "Trust Halal place, or `google_place_id` to ingest from "
        "Google first, then attach the claim. The schema validates "
        "exactly-one-of.\n\n"
        "Duplicate-claim guard: rejects with "
        "`OWNERSHIP_REQUEST_ALREADY_EXISTS` when the same user already "
        "has an active claim against the same place. Rate-limited per-"
        "session at 20/hour."
    ),
)
@limiter.limit("20/hour", key_func=user_or_ip_key)
def submit_my_ownership_request(
    request: Request,
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

    Two ways to identify the place being claimed (the schema enforces
    exactly-one-of):

      * ``place_id`` — a Place already in the Trust Halal catalog.
        Path the owner takes when text-search returns a match.
      * ``google_place_id`` — a place that's only on Google so far.
        We ingest it server-side first (idempotent on the Google ID),
        then create the claim against the resulting Place. The claim
        and ingest don't share a transaction by design — if the claim
        fails, we still keep the ingested Place since admin staff (or
        the same owner on a retry) can use it.

    Contact name + email are pulled from the user's profile rather
    than the request body. ``display_name`` is non-null on signup, but
    we fall back to the email's local-part if it's somehow blank — we
    never want admin staff to see a literally empty contact_name.

    The auth context (``CurrentUser``) is intentionally slim — id +
    role only — so we look up the full User row here for the
    display_name + email fields. Cheap (single PK lookup) and keeps
    the auth context cache-friendly.
    """
    user_row = db.get(User, user.id)
    if user_row is None:
        # The session resolved to a user_id that no longer exists —
        # rare but possible (admin hard-deleted the row mid-session).
        # Treat as unauthenticated rather than 500ing.
        raise UnauthorizedError(
            "INVALID_CREDENTIALS",
            "Your session is no longer valid. Please sign in again.",
        )

    # Resolve + authorize the sponsoring organization. Must:
    #   * Exist.
    #   * Belong to this user (active membership).
    #   * Be at least UNDER_REVIEW. DRAFT orgs can't sponsor claims —
    #     submitting evidence-free claims under a junk DRAFT org
    #     would be a spam vector. The owner has to commit by
    #     submitting their org for review first.
    org = get_organization_for_user(
        db,
        organization_id=payload.organization_id,
        user_id=user.id,
    )
    if org.status not in (
        OrganizationStatus.UNDER_REVIEW.value,
        OrganizationStatus.VERIFIED.value,
    ):
        raise BadRequestError(
            "OWNER_ORGANIZATION_NOT_ELIGIBLE",
            "Submit your organization for review (DRAFT → UNDER_REVIEW) "
            "before filing a claim under it.",
        )

    if payload.google_place_id is not None:
        # Ingest first so we have a place_id to attach the claim to.
        # The ingest is its own transaction (commits internally), so
        # if the subsequent claim creation fails we still keep the
        # newly-ingested place — admin staff or the owner on a retry
        # can still use it. Idempotent on the Google ID, so retries
        # don't dupe.
        ingest_result = ingest_google_place(
            db,
            google_place_id=payload.google_place_id,
            actor_user_id=user.id,
        )
        place = ingest_result.place
    else:
        place = get_place(db, payload.place_id)
        if not place:
            raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    contact_name = (user_row.display_name or "").strip()
    if not contact_name:
        # Belt-and-suspenders: signup enforces a non-empty display_name,
        # but legacy rows pre-dating that rule may exist (admin-invited
        # users who never set one). The local-part of the email is a
        # reasonable fallback — admin can always check the email
        # column for the canonical identity.
        contact_name = user_row.email.split("@", 1)[0] or user_row.email

    req = create_ownership_request(
        db,
        place_id=place.id,
        requester_user_id=user.id,
        contact_name=contact_name,
        contact_email=user_row.email,
        contact_phone=payload.contact_phone,
        message=payload.message,
        organization_id=org.id,
    )
    # The model_validator's from_attributes=True reads place +
    # attachments off the SQLAlchemy relationship — both are
    # lazy=selectin so they're already loaded in this session.
    return MyOwnershipRequestRead.model_validate(req)


@router.get(
    "/me/ownership-requests",
    response_model=list[MyOwnershipRequestRead],
    summary="List the current user's claims (newest first)",
    description=(
        "Powers the owner portal's 'My claims' page and the home "
        "page's recent-claims preview. Pagination via `limit` (≤200, "
        "default 50) and `offset`. Scoped automatically to the "
        "calling user — no cross-user leak even if a stale cache or "
        "URL guesses another id."
    ),
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
    return [MyOwnershipRequestRead.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# /me/ownership-requests/{request_id}/attachments — owner-uploaded evidence
# ---------------------------------------------------------------------------
# The owner portal's claim flow uploads evidence files (utility bills,
# SOS filings, etc.) here. Each file goes to object storage; this
# endpoint records the metadata row and returns it to the caller for
# UI feedback.
#
# Validation lives at the application layer rather than relying on
# upstream HTTP middleware:
#   * Caller must own the parent ownership request.
#   * Per-claim cap (5 files) — checked by counting existing rows
#     before insert.
#   * Per-file size cap (10 MB) — enforced by reading the upload's
#     bytes into memory and checking length. We could stream to
#     storage instead, but at 10 MB the simpler "read it all"
#     approach is fine and matches how the rest of the app handles
#     small uploads.
#   * MIME allow-list — only PDF, PNG, JPEG, HEIC. No video, no
#     archives, no Office docs (which can carry macros). Owners with
#     other formats can convert or contact support.
#
# We deliberately don't update the parent claim's status here. Upload
# is mechanically separate from "submit." The status flips happen via
# admin review or the existing CANCEL path.

# Allow-list of accepted MIME types. Mapping to file extension so the
# storage path carries a readable suffix even though the canonical
# identifier is a UUID. Update as needs grow — but keep tight.
_ALLOWED_MIME_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heif",
}

_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
_MAX_FILES_PER_REQUEST = 5


def _load_owned_request(
    db: Session, *, request_id: UUID, user_id: UUID
):
    """Resolve the request and verify the caller owns it.

    Splits cleanly into NOT_FOUND vs FORBIDDEN responses: an unknown
    UUID gets a 404, a known one belonging to someone else gets a
    403. The latter is admittedly an oracle (you can probe whether
    a UUID exists), but cookie-auth users guessing UUIDs is a
    non-threat — there's no escalation path from "I confirmed this
    UUID exists" to anything actionable.
    """
    req = get_ownership_request(db, request_id)
    if req is None:
        raise NotFoundError(
            "OWNERSHIP_REQUEST_NOT_FOUND", "Ownership request not found"
        )
    if req.requester_user_id != user_id:
        raise ForbiddenError(
            "OWNERSHIP_REQUEST_FORBIDDEN",
            "You do not have access to this ownership request",
        )
    return req


@router.post(
    "/me/ownership-requests/{request_id}/attachments",
    response_model=OwnershipRequestAttachmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Attach evidence to an existing claim",
    description=(
        "Multipart upload of a single supporting file (business "
        "license, lease, sales-tax permit, etc.) — anything tying the "
        "sponsoring organization to this specific restaurant address. "
        "Caps: 5 files per claim, 10 MB per file, MIME allow-list "
        "(PDF / JPEG / PNG / HEIC / HEIF). The claim must belong to "
        "the calling user. Files land in Supabase Storage at "
        "`ownership-requests/<request_id>/<uuid>.<ext>`. Rate-limited "
        "per-session at 60/hour."
    ),
)
@limiter.limit("60/hour", key_func=user_or_ip_key)
def upload_my_ownership_request_attachment(
    request: Request,
    request_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    storage: StorageClient = Depends(get_storage_client),
) -> OwnershipRequestAttachmentRead:
    """Upload a file as evidence on an existing ownership claim.

    Multipart upload. Validates ownership, file count cap, size cap,
    and MIME allow-list. Streams the bytes to object storage at
    ``<bucket>/ownership-requests/<request_id>/<uuid>.<ext>`` and
    inserts the metadata row.

    On any upload failure (storage outage, network error), we surface
    a clean 503 — the file isn't half-recorded; the metadata row
    only writes after the storage upload succeeds.
    """
    req = _load_owned_request(db, request_id=request_id, user_id=user.id)

    # ---- count cap ---------------------------------------------------
    existing_count = len(req.attachments)
    if existing_count >= _MAX_FILES_PER_REQUEST:
        raise ConflictError(
            "ATTACHMENT_LIMIT_REACHED",
            f"You can attach at most {_MAX_FILES_PER_REQUEST} files per claim. "
            "Remove one or contact support if you need to share more.",
        )

    # ---- mime allow-list ---------------------------------------------
    content_type = (file.content_type or "").lower()
    if content_type not in _ALLOWED_MIME_TYPES:
        raise BadRequestError(
            "ATTACHMENT_TYPE_NOT_ALLOWED",
            "Allowed file types: PDF, JPEG, PNG, HEIC. "
            f"Received: {file.content_type or 'unknown'}.",
        )
    extension = _ALLOWED_MIME_TYPES[content_type]

    # ---- read body, enforce size cap --------------------------------
    # Read into memory. 10 MB cap means worst-case ~50 MB resident if
    # five concurrent uploads land at once — fine for the worker
    # process. Streaming to storage in chunks would be more memory-
    # efficient at scale, but adds complexity (chunk-by-chunk size
    # check, partial-upload cleanup) we don't need yet.
    contents = file.file.read()
    size_bytes = len(contents)
    if size_bytes == 0:
        raise BadRequestError(
            "ATTACHMENT_EMPTY",
            "Uploaded file appears to be empty.",
        )
    if size_bytes > _MAX_FILE_SIZE_BYTES:
        raise BadRequestError(
            "ATTACHMENT_TOO_LARGE",
            f"Files must be {_MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB or smaller.",
        )

    # ---- upload to object storage -----------------------------------
    object_uuid = uuid4()
    storage_path = (
        f"ownership-requests/{req.id}/{object_uuid}.{extension}"
    )
    try:
        storage.upload_bytes(
            storage_path, contents, content_type=content_type
        )
    except StorageError as exc:
        # The DB row hasn't been written yet so there's nothing to
        # roll back; the caller sees a clean failure and can retry.
        raise BadRequestError(
            "ATTACHMENT_UPLOAD_FAILED",
            f"Couldn't store the uploaded file. Please try again. ({exc})",
        )

    # ---- record metadata --------------------------------------------
    original_filename = (file.filename or f"upload.{extension}").strip()
    # Truncate to the column's 512-char limit. Pathological filenames
    # over 512 chars are rare; the tail is the least informative part
    # so a head-trim preserves the most readable prefix.
    if len(original_filename) > 512:
        original_filename = original_filename[:512]

    attachment = OwnershipRequestAttachment(
        id=object_uuid,
        request_id=req.id,
        storage_path=storage_path,
        original_filename=original_filename,
        content_type=content_type,
        size_bytes=size_bytes,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return OwnershipRequestAttachmentRead.model_validate(attachment)


@router.get(
    "/me/ownership-requests/{request_id}/attachments",
    response_model=list[OwnershipRequestAttachmentRead],
    summary="List evidence files attached to one of the user's claims",
    description=(
        "Returns metadata only (filename, mime, size). Used by the "
        "owner portal when re-opening a claim's detail page to render "
        "previously-uploaded files. Same ownership gate as the upload "
        "endpoint."
    ),
)
def list_my_ownership_request_attachments(
    request_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[OwnershipRequestAttachmentRead]:
    """List the attachments an owner has uploaded for one of their
    claims. Same auth gate as the upload endpoint.

    Mostly used so the owner portal can render the file list on a
    re-open of the /claim page (e.g. coming back via the claims list
    to add another file). The /my-claims list itself already embeds
    attachments via MyOwnershipRequestRead.
    """
    req = _load_owned_request(db, request_id=request_id, user_id=user.id)
    return [
        OwnershipRequestAttachmentRead.model_validate(a)
        for a in req.attachments
    ]