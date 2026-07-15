"""Public + applicant-self + verifier-self endpoints.

Three prefix groups ship from this module:

  * ``/verifier-applications`` — the public submit endpoint.
    Anonymous-OK because community moderators may apply before
    creating a Trust Halal account; their email is captured so admin
    can reach back. Signed-in users get their applicant_user_id
    populated so admin sees the linkage.
  * ``/me/verifier-applications`` — applicant-self reads + the
    withdraw action. Auth required (need a user_id to scope the rows).
  * ``/me/verification-visits`` — verifier-self submit / list / read
    / withdraw + attachment upload (Phase 8b). Gated on the VERIFIER
    role; in addition the repo enforces ``VerifierProfile.status =
    ACTIVE`` so suspended/revoked verifiers can't sneak in new
    visits even if their role hasn't been flipped.

Admin review (``/admin/verifier-applications/*``,
``/admin/verification-visits/*``) lives in its own module under
``app/modules/admin/verifiers``.
"""
from __future__ import annotations

from io import BytesIO
from typing import Optional
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import (
    CurrentUser,
    get_current_user,
    get_current_user_optional,
    require_roles,
)
from app.core.exceptions import BadRequestError, ConflictError, NotFoundError
from app.core.rate_limit import limiter, user_or_ip_key
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.users.enums import UserRole
from app.modules.verifiers.enums import VerificationVisitStatus
from app.modules.verifiers.models import VerificationVisitAttachment
from app.modules.places.models import Place
from app.modules.verifiers.repo import (
    get_application_for_applicant,
    get_public_verifier_by_handle,
    list_applications_for_applicant,
    submit_application,
    withdraw_application,
)
from app.modules.verifiers.schemas import (
    VerificationVisitAttachmentRead,
    VerificationVisitCreate,
    VerificationVisitRead,
    VerifierApplicationCreate,
    VerifierApplicationRead,
    VerifierPublicProfileDetail,
    VerifierPublicVisitPlace,
    VerifierPublicVisitSummary,
)
from app.modules.verifiers.visits_repo import (
    get_visit_for_verifier,
    list_visits_for_verifier,
    submit_visit,
    withdraw_visit,
)


# ---------------------------------------------------------------------------
# Visit attachment knobs
# ---------------------------------------------------------------------------
# Same allow-list and file-count cap as dispute attachments; verifier
# uploads (menu photos, certificate-on-the-wall pictures) are the same
# kind of evidence.
_VISIT_ALLOWED_MIME_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heif",
}
_VISIT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
_VISIT_MAX_FILES = 10  # higher than disputes (5) — visits often want
                       # menu + storefront + kitchen + certificate.


# /verifiers/{handle} — the public verifier profile read.
# Distinct router from the applications one so the OpenAPI grouping
# separates "apply to be a verifier" (a verb) from "look up a
# verifier's public page" (a noun).
public_profile_router = APIRouter(prefix="/verifiers", tags=["verifiers"])


@public_profile_router.get(
    "/{handle}",
    response_model=VerifierPublicProfileDetail,
    summary="Public verifier profile + recent accepted visits",
    description=(
        "Returns the public-facing profile for a verifier whose "
        "``is_public=true`` and ``status=ACTIVE``. Includes their "
        "bio, socials, and the newest ACCEPTED visits (capped at 20). "
        "404 when the handle doesn't resolve to a public + active "
        "verifier, matching the 'don't leak existence' posture used "
        "elsewhere in the API."
    ),
)
def get_public_verifier_profile(
    handle: str,
    db: Session = Depends(get_db),
) -> VerifierPublicProfileDetail:
    result = get_public_verifier_by_handle(db, handle=handle)
    if result is None:
        raise NotFoundError(
            "VERIFIER_PROFILE_NOT_FOUND",
            "Verifier not found.",
        )
    profile, visits, total = result

    # Fetch place summaries for the visits in one shot so we don't
    # N+1 through place lookups.
    place_ids = [v.place_id for v in visits]
    place_rows = (
        db.execute(
            select(Place).where(Place.id.in_(place_ids))
        ).scalars().all()
        if place_ids
        else []
    )
    places_by_id = {p.id: p for p in place_rows}

    return VerifierPublicProfileDetail(
        public_handle=profile.public_handle or "",
        bio=profile.bio,
        social_links=profile.social_links,
        joined_as_verifier_at=profile.joined_as_verifier_at,
        total_accepted_visits=total,
        recent_visits=[
            VerifierPublicVisitSummary(
                id=v.id,
                visited_at=v.visited_at,
                disclosure=v.disclosure,  # type: ignore[arg-type]
                public_review_url=v.public_review_url,
                place=VerifierPublicVisitPlace(
                    id=places_by_id[v.place_id].id,
                    name=places_by_id[v.place_id].name,
                    city=places_by_id[v.place_id].city,
                    region=places_by_id[v.place_id].region,
                ),
            )
            for v in visits
            if v.place_id in places_by_id
        ],
    )


# /verifier-applications — public submit. Tagged separately from the
# /me/* surface so the OpenAPI grouping reads naturally.
public_router = APIRouter(
    prefix="/verifier-applications", tags=["verifier-applications"]
)


@public_router.post(
    "",
    response_model=VerifierApplicationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a verifier application",
    description=(
        "Open a verifier application. Anonymous-OK: applicants may "
        "submit before creating an account, so the form captures "
        "applicant_email + applicant_name independently of any "
        "session. When a session is present, the applicant's user_id "
        "is recorded for admin context. Rate-limited (5/hour per "
        "user-or-IP) to keep noise out of the admin queue."
    ),
)
@limiter.limit("5/hour", key_func=user_or_ip_key)
def submit_verifier_application(
    request: Request,
    payload: VerifierApplicationCreate,
    db: Session = Depends(get_db),
    user: Optional[CurrentUser] = Depends(get_current_user_optional),
) -> VerifierApplicationRead:
    application = submit_application(
        db,
        payload=payload,
        applicant_user_id=user.id if user is not None else None,
    )
    return VerifierApplicationRead.model_validate(application)


# /me/verifier-applications — applicant-self prefix.
me_router = APIRouter(
    prefix="/me/verifier-applications", tags=["verifier-applications"]
)


@me_router.get(
    "",
    response_model=list[VerifierApplicationRead],
    summary="List the applicant's own verifier applications",
    description=(
        "Newest-first, includes every status — PENDING, APPROVED, "
        "REJECTED, WITHDRAWN — so the applicant can read their full "
        "history. Pagination capped at 50; realistic applicants will "
        "have a single-digit count of rows."
    ),
)
def list_my_verifier_applications(
    limit: int = Query(default=20, gt=0, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[VerifierApplicationRead]:
    rows = list_applications_for_applicant(
        db, applicant_user_id=user.id, limit=limit, offset=offset
    )
    return [VerifierApplicationRead.model_validate(r) for r in rows]


@me_router.get(
    "/{application_id}",
    response_model=VerifierApplicationRead,
    summary="Get one of the applicant's verifier applications",
    description=(
        "Applicant-self read. 404 on unknown id and on rows owned by "
        "a different user — same posture as the rest of the /me/* "
        "surface, no existence-leak."
    ),
)
def get_my_verifier_application(
    application_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> VerifierApplicationRead:
    row = get_application_for_applicant(
        db, application_id=application_id, applicant_user_id=user.id
    )
    return VerifierApplicationRead.model_validate(row)


@me_router.post(
    "/{application_id}/withdraw",
    response_model=VerifierApplicationRead,
    summary="Withdraw a pending verifier application",
    description=(
        "Pull a PENDING application before admin acts on it. "
        "Idempotent against already-WITHDRAWN. Returns 409 once "
        "admin has APPROVED or REJECTED — the decision is final on "
        "the applicant side."
    ),
)
def withdraw_my_verifier_application(
    application_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> VerifierApplicationRead:
    row = withdraw_application(
        db, application_id=application_id, applicant_user_id=user.id
    )
    return VerifierApplicationRead.model_validate(row)


# ---------------------------------------------------------------------------
# /me/verification-visits — verifier-self surface
# ---------------------------------------------------------------------------

me_visits_router = APIRouter(
    prefix="/me/verification-visits", tags=["verifier-visits"]
)


@me_visits_router.post(
    "",
    response_model=VerificationVisitRead,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a verification visit",
    description=(
        "Verifier files a site-visit record. The structured findings "
        "shape mirrors the owner's halal-claim questionnaire so admin "
        "review can diff them. Status starts as SUBMITTED; admin "
        "moves it from there. Rate-limited 30/hour per verifier — "
        "high-throughput shouldn't be a thing here."
    ),
)
@limiter.limit("30/hour", key_func=user_or_ip_key)
def submit_verification_visit(
    request: Request,
    payload: VerificationVisitCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.VERIFIER)),
) -> VerificationVisitRead:
    visit = submit_visit(
        db, payload=payload, verifier_user_id=user.id
    )
    return VerificationVisitRead.model_validate(visit)


@me_visits_router.get(
    "",
    response_model=list[VerificationVisitRead],
    summary="List the verifier's own visits",
    description=(
        "Newest-first, optional status filter. Pagination capped at "
        "100. Includes WITHDRAWN rows — verifiers should be able to "
        "see their full history."
    ),
)
def list_my_verification_visits(
    status_filter: VerificationVisitStatus | None = Query(
        default=None,
        alias="status",
        description="Filter by status. Omit for all statuses.",
    ),
    limit: int = Query(default=50, gt=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.VERIFIER)),
) -> list[VerificationVisitRead]:
    rows = list_visits_for_verifier(
        db,
        verifier_user_id=user.id,
        status=status_filter,
        limit=limit,
        offset=offset,
    )
    return [VerificationVisitRead.model_validate(r) for r in rows]


@me_visits_router.get(
    "/{visit_id}",
    response_model=VerificationVisitRead,
    summary="Get one of the verifier's visits",
    description=(
        "Read with ownership check — 404 (not 403) on visits filed "
        "by another verifier so we don't leak existence."
    ),
)
def get_my_verification_visit(
    visit_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.VERIFIER)),
) -> VerificationVisitRead:
    visit = get_visit_for_verifier(
        db, visit_id=visit_id, verifier_user_id=user.id
    )
    return VerificationVisitRead.model_validate(visit)


@me_visits_router.post(
    "/{visit_id}/withdraw",
    response_model=VerificationVisitRead,
    summary="Withdraw a SUBMITTED visit",
    description=(
        "Pull a SUBMITTED visit before admin acts on it. Idempotent "
        "against already-WITHDRAWN. Returns 409 once admin moved the "
        "visit to UNDER_REVIEW or beyond — at that point the "
        "decision channel is the only path forward."
    ),
)
def withdraw_my_verification_visit(
    visit_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.VERIFIER)),
) -> VerificationVisitRead:
    visit = withdraw_visit(
        db, visit_id=visit_id, verifier_user_id=user.id
    )
    return VerificationVisitRead.model_validate(visit)


@me_visits_router.post(
    "/{visit_id}/attachments",
    response_model=VerificationVisitAttachmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload evidence to a verification visit",
    description=(
        "Multipart upload. Allowed only while the visit is SUBMITTED "
        "— once admin starts reviewing, the evidence set is frozen. "
        "MIME allow-list (PDF / JPEG / PNG / HEIC / HEIF), 10 MB per "
        "file, 10 files per visit. Storage key is "
        "`verification_visits/{visit_id}/{uuid}.{ext}`."
    ),
)
@limiter.limit("60/hour", key_func=user_or_ip_key)
def upload_verification_visit_attachment(
    request: Request,
    visit_id: UUID,
    file: UploadFile = File(...),
    caption: str | None = Form(default=None, max_length=120),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.VERIFIER)),
    storage: StorageClient = Depends(get_storage_client),
) -> VerificationVisitAttachmentRead:
    visit = get_visit_for_verifier(
        db, visit_id=visit_id, verifier_user_id=user.id
    )

    if visit.status != VerificationVisitStatus.SUBMITTED.value:
        raise ConflictError(
            "VERIFICATION_VISIT_NOT_EDITABLE",
            (
                f"Visit is in status {visit.status}; new evidence "
                "can't be attached."
            ),
        )

    if len(visit.attachments) >= _VISIT_MAX_FILES:
        raise ConflictError(
            "VERIFICATION_VISIT_ATTACHMENT_LIMIT_REACHED",
            (
                f"You can attach at most {_VISIT_MAX_FILES} files "
                "to a visit."
            ),
        )

    content_type = (file.content_type or "").lower()
    if content_type not in _VISIT_ALLOWED_MIME_TYPES:
        raise BadRequestError(
            "VERIFICATION_VISIT_ATTACHMENT_TYPE_NOT_ALLOWED",
            (
                "Allowed file types: PDF, JPEG, PNG, HEIC. "
                f"Received: {file.content_type or 'unknown'}."
            ),
        )
    extension = _VISIT_ALLOWED_MIME_TYPES[content_type]

    contents = file.file.read()
    size_bytes = len(contents)
    if size_bytes == 0:
        raise BadRequestError(
            "VERIFICATION_VISIT_ATTACHMENT_EMPTY",
            "Uploaded file appears to be empty.",
        )
    if size_bytes > _VISIT_MAX_FILE_SIZE_BYTES:
        raise BadRequestError(
            "VERIFICATION_VISIT_ATTACHMENT_TOO_LARGE",
            (
                f"Files must be {_VISIT_MAX_FILE_SIZE_BYTES // (1024 * 1024)} "
                "MB or smaller."
            ),
        )

    object_uuid = uuid4()
    storage_path = (
        f"verification_visits/{visit.id}/{object_uuid}.{extension}"
    )
    try:
        storage.upload_bytes(
            storage_path, contents, content_type=content_type
        )
    except StorageError as exc:
        raise BadRequestError(
            "VERIFICATION_VISIT_ATTACHMENT_UPLOAD_FAILED",
            f"Couldn't store the uploaded file. Please try again. ({exc})",
        )

    original_filename = (file.filename or f"upload.{extension}").strip()
    if len(original_filename) > 512:
        original_filename = original_filename[:512]

    clean_caption = (caption or "").strip() or None

    attachment = VerificationVisitAttachment(
        id=object_uuid,
        visit_id=visit.id,
        storage_path=storage_path,
        original_filename=original_filename,
        content_type=content_type,
        size_bytes=size_bytes,
        caption=clean_caption,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return VerificationVisitAttachmentRead.model_validate(attachment)


__all__ = ["public_router", "me_router", "me_visits_router"]
