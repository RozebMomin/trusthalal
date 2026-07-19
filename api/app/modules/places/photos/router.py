"""HTTP endpoints for owner + consumer place-photo uploads.

Four routes, all under ``/places/{place_id}/photos``:

  * ``POST``   — multipart upload. Auth required; source is
                 derived from the caller's relationship to the
                 place (OWNER if they can manage it, otherwise
                 CONSUMER). Runs SafeSearch + image processing
                 before writing to the bucket.
  * ``GET``    — public list, hero-first.
  * ``PATCH``  — set ``is_hero`` (owner-only) or edit caption
                 (uploader-or-owner).
  * ``DELETE`` — soft delete. Tiered auth: owner can delete any
                 photo on their place; consumer can delete their
                 own; admin can delete anything.

The pipeline order on upload is critical:

  1. Type + size validation. Cheap; reject obvious bad inputs
     before paying for image processing or SafeSearch.
  2. Image processing (HEIC convert + EXIF strip + dimensions).
     CPU-bound, no network round-trip.
  3. SafeSearch via Cloud Vision. Network round-trip, ~300-800ms
     typical. Reject if adult or violence is LIKELY+.
  4. Bucket write. Network round-trip.
  5. DB row insert.

If step 5 fails after step 4 succeeded, the bucket gets an
orphaned object. Acceptable trade-off in alpha — a future cleanup
job can scan for storage paths not referenced by a row. Worse
alternative is the inverse (DB row pointing at non-existent
bytes) which would render as a broken image to consumers.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from app.core.rate_limit import limiter, user_or_ip_key
from app.core.storage import (
    StorageClient,
    StorageError,
    get_photos_storage_client,
)
from app.db.deps import get_db
from app.modules.organizations.deps import assert_can_manage_place
from app.modules.places.enums import PlacePhotoSource
from app.modules.places.models import Place, PlacePhoto
from app.modules.places.photos.processor import (
    ImageProcessingError,
    ProcessedImage,
    process_image,
)
from app.modules.places.photos.repo import (
    MAX_PHOTOS_PER_PLACE,
    clear_hero_for_place,
    count_active_photos_for_place,
    get_photo,
    has_active_hero_for_place,
    list_active_photos_for_place,
    soft_delete_photo,
)
from app.modules.places.photos.safesearch import (
    SafeSearchClient,
    SafeSearchError,
    get_safesearch_client,
)
from app.modules.places.schemas import PlacePhotoRead, PlacePhotoUpdate
from app.modules.users.enums import UserRole
from app.modules.users.models import User


router = APIRouter(prefix="/places", tags=["place-photos"])


# Allowed multipart MIME types. HEIC/HEIF go through pillow-heif
# and come out as JPEG on the storage side; the input is still
# acceptable. Anything outside this set 415s before we run the
# pipeline.
_ALLOWED_INPUT_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}

_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_place_exists(db: Session, place_id: UUID) -> Place:
    """Load a non-deleted place or raise 404. The photo endpoints
    always operate on live places — soft-deleted places shouldn't
    accept new uploads, and the gallery for a deleted place
    shouldn't be reachable."""
    place = db.execute(
        select(Place).where(Place.id == place_id)
    ).scalar_one_or_none()
    if place is None or place.is_deleted:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")
    return place


def _is_admin(user: CurrentUser) -> bool:
    return user.role == UserRole.ADMIN


def _user_can_manage_place(
    db: Session, user: CurrentUser, place_id: UUID
) -> bool:
    """Lightweight wrapper around ``assert_can_manage_place`` that
    returns True/False instead of raising. Used in branches where
    the answer determines source attribution rather than the
    accept/reject of the request itself.
    """
    if _is_admin(user):
        return True
    try:
        assert_can_manage_place(db, user, place_id)
        return True
    except Exception:
        return False


def _build_photo_read(
    photo: PlacePhoto,
    *,
    storage: StorageClient,
    uploader_display_name: str | None,
) -> PlacePhotoRead:
    """Map an ORM row into the consumer-facing read shape.

    Public URL is derived at read time rather than stored on the
    row — the bucket name lives in config and might rotate (e.g.
    a CDN domain swap) without needing to backfill every row.
    """
    return PlacePhotoRead(
        id=photo.id,
        place_id=photo.place_id,
        url=storage.public_url(photo.storage_path),
        source=PlacePhotoSource(photo.source),
        width_px=photo.width_px,
        height_px=photo.height_px,
        caption=photo.caption,
        is_hero=photo.is_hero,
        uploaded_by_display_name=uploader_display_name,
        created_at=photo.created_at,
    )


def _resolve_uploader_display_names(
    db: Session, photos: list[PlacePhoto]
) -> dict[UUID, str | None]:
    """Batch-fetch uploader display names so the gallery doesn't
    N+1 on User reads. Returns {user_id: display_name | None}.
    """
    user_ids = {p.uploaded_by_user_id for p in photos if p.uploaded_by_user_id}
    if not user_ids:
        return {}
    rows = db.execute(
        select(User.id, User.display_name).where(User.id.in_(user_ids))
    ).all()
    return {row[0]: row[1] for row in rows}


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


#: Small on purpose. Three photos is enough to show a plate, a menu board and
#: a certificate; beyond that a review becomes an album and the moderation
#: surface grows for no extra signal to the reader.
MAX_PHOTOS_PER_REVIEW = 3


def _ensure_own_review(db: Session, *, review_id: UUID, place_id: UUID, user: CurrentUser):
    """Validate that this review is the caller's, on this place, and not full.

    404 rather than 403 for someone else's review — same
    existence-non-disclosure posture the rest of the codebase uses.
    """
    from app.modules.reviews.models import PlaceReview  # local: avoids a cycle

    review = db.get(PlaceReview, review_id)
    if review is None or review.author_user_id != user.id or review.place_id != place_id:
        raise NotFoundError("REVIEW_NOT_FOUND", "That review doesn't exist.")

    attached = db.execute(
        select(func.count(PlacePhoto.id)).where(
            PlacePhoto.review_id == review_id,
            PlacePhoto.deleted_at.is_(None),
        )
    ).scalar_one()
    if int(attached) >= MAX_PHOTOS_PER_REVIEW:
        raise ConflictError(
            "REVIEW_PHOTO_LIMIT_REACHED",
            f"A review can have at most {MAX_PHOTOS_PER_REVIEW} photos.",
        )
    return review



@router.post(
    "/{place_id}/photos",
    response_model=PlacePhotoRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a place photo",
    description=(
        "Multipart upload for owner or consumer photos of a place. "
        "Auth required. Source is derived from the caller's "
        "relationship to the place: active OWNER_ADMIN/MANAGER on "
        "the owning org → OWNER, anyone else → CONSUMER. Pipeline "
        "runs HEIC→JPEG conversion, EXIF strip, dimension extract, "
        "and Cloud Vision SafeSearch BEFORE bytes hit the bucket. "
        "Returns 422 on SafeSearch reject, 415 on bad MIME, 413 on "
        "size, 409 on per-place cap (75 photos)."
    ),
)
@limiter.limit("30/hour", key_func=user_or_ip_key)
def upload_place_photo(
    request: Request,
    place_id: UUID,
    file: UploadFile = File(...),
    # Attach this photo to one of the caller's reviews. A review photo IS a
    # place photo that happens to belong to a review — same table, so it
    # inherits SafeSearch, EXIF strip, soft-delete and the gallery for free,
    # rather than growing a parallel pipeline that would need all four again.
    review_id: Optional[UUID] = Form(default=None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    storage: StorageClient = Depends(get_photos_storage_client),
    safesearch: SafeSearchClient = Depends(get_safesearch_client),
) -> PlacePhotoRead:
    place = _ensure_place_exists(db, place_id)

    # Review attachment is validated first: it's a pure DB check, and there's
    # no point paying for image processing + a Vision round-trip on a photo
    # we're going to refuse anyway.
    review = None
    if review_id is not None:
        review = _ensure_own_review(db, review_id=review_id, place_id=place.id, user=user)

    # Pre-flight: cap, MIME, size — cheap rejections before we pay
    # for the image pipeline + SafeSearch.
    if count_active_photos_for_place(db, place_id=place.id) >= MAX_PHOTOS_PER_PLACE:
        raise ConflictError(
            "PLACE_PHOTO_LIMIT_REACHED",
            (
                f"This place already has {MAX_PHOTOS_PER_PLACE} photos. "
                "Owners can delete older ones to make room."
            ),
        )

    declared_type = (file.content_type or "").lower()
    if declared_type not in _ALLOWED_INPUT_MIME:
        raise BadRequestError(
            "PLACE_PHOTO_TYPE_NOT_ALLOWED",
            (
                "Allowed photo types: JPEG, PNG, WebP, HEIC. "
                f"Received: {file.content_type or 'unknown'}."
            ),
        )

    raw_bytes = file.file.read()
    size_bytes = len(raw_bytes)
    if size_bytes == 0:
        raise BadRequestError(
            "PLACE_PHOTO_EMPTY",
            "Uploaded photo appears to be empty.",
        )
    if size_bytes > _MAX_FILE_SIZE_BYTES:
        raise BadRequestError(
            "PLACE_PHOTO_TOO_LARGE",
            (
                f"Photos must be {_MAX_FILE_SIZE_BYTES // (1024 * 1024)} "
                "MB or smaller."
            ),
        )

    # CPU-bound: HEIC convert + EXIF strip + dimensions. Wrap in
    # try/except to translate Pillow errors into a clean 422.
    try:
        processed: ProcessedImage = process_image(
            raw_bytes, source_content_type=declared_type
        )
    except ImageProcessingError as exc:
        raise BadRequestError(
            "PLACE_PHOTO_INVALID_IMAGE",
            (
                "We couldn't read this photo. Please try a different "
                f"image. ({exc})"
            ),
        )

    # Network: SafeSearch. Errors here are operational (Vision
    # outage, key not configured), not user errors — surface a 503
    # via the BadRequestError envelope so the client retries
    # rather than treating the photo as bad.
    try:
        safesearch_result = safesearch.evaluate(processed.bytes_)
    except SafeSearchError as exc:
        raise BadRequestError(
            "PLACE_PHOTO_SCAN_UNAVAILABLE",
            (
                "Couldn't scan this photo for content safety. Please "
                f"try again in a moment. ({exc})"
            ),
        )
    if not safesearch_result.passes:
        # Generic message — don't leak which axis flagged so a
        # determined attacker can't fine-tune to the threshold.
        raise BadRequestError(
            "PLACE_PHOTO_INAPPROPRIATE_CONTENT",
            (
                "This photo doesn't meet our content guidelines. "
                "Please choose a different photo."
            ),
        )

    # Source attribution. _user_can_manage_place is a soft check —
    # any authenticated user can upload, the answer just decides
    # the source bucket.
    is_owner = _user_can_manage_place(db, user, place.id)
    source = (
        PlacePhotoSource.OWNER if is_owner else PlacePhotoSource.CONSUMER
    )

    # Bucket write. Storage path uses a fresh UUID so the same
    # underlying bytes can be re-uploaded without collision.
    photo_id = uuid4()
    storage_path = f"{place.id}/{photo_id}.{processed.extension}"
    try:
        storage.upload_bytes(
            storage_path,
            processed.bytes_,
            content_type=processed.content_type,
        )
    except StorageError as exc:
        raise BadRequestError(
            "PLACE_PHOTO_UPLOAD_FAILED",
            (
                "Couldn't store the uploaded photo. Please try "
                f"again. ({exc})"
            ),
        )

    # Auto-promote the first photo on a place to hero. Without this,
    # the typical owner flow ("upload one photo and call it done")
    # leaves the place with photos in its gallery but ``hero_photo_url
    # = null`` on the search-result card — which renders the gradient
    # placeholder despite the place HAVING a photo. Promotion only
    # happens when there's no existing hero, so an owner who has
    # already curated their hero doesn't get clobbered by a new
    # upload from a consumer.
    # A review photo never becomes the hero. The cover image on a search card
    # is the restaurant's shopfront; a diner's plate photo attached to a
    # two-star review is not that, and auto-promoting it would let any
    # reviewer choose how the place is represented across the product.
    auto_hero = review is None and not has_active_hero_for_place(
        db, place_id=place.id
    )

    photo = PlacePhoto(
        id=photo_id,
        place_id=place.id,
        review_id=review.id if review is not None else None,
        uploaded_by_user_id=user.id,
        source=source.value,
        storage_path=storage_path,
        content_type=processed.content_type,
        size_bytes=len(processed.bytes_),
        width_px=processed.width_px,
        height_px=processed.height_px,
        is_hero=auto_hero,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)

    # ``CurrentUser`` is a thin {id, role} record — display_name lives
    # on ``User``, fetched here. Same pattern as the PATCH endpoint
    # below: one tiny scalar SELECT instead of teaching CurrentUser to
    # carry the field across every auth path. Falls back to None if
    # the row is missing (shouldn't happen, but defensive).
    uploader_display_name = db.execute(
        select(User.display_name).where(User.id == user.id)
    ).scalar_one_or_none()

    return _build_photo_read(
        photo,
        storage=storage,
        uploader_display_name=uploader_display_name,
    )


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


@router.get(
    "/{place_id}/photos",
    response_model=list[PlacePhotoRead],
    summary="List photos for a place",
    description=(
        "Public read of all non-deleted photos for a place. "
        "Hero-first, then newest-first. The place detail page "
        "uses this to render the gallery; the search-result card "
        "uses the embedded ``hero_photo_url`` on PlaceSearchResult "
        "instead, since cards only need the cover image."
    ),
)
def list_place_photos(
    place_id: UUID,
    db: Session = Depends(get_db),
    storage: StorageClient = Depends(get_photos_storage_client),
) -> list[PlacePhotoRead]:
    _ensure_place_exists(db, place_id)
    photos = list_active_photos_for_place(db, place_id=place_id)
    display_names = _resolve_uploader_display_names(db, photos)
    return [
        _build_photo_read(
            p,
            storage=storage,
            uploader_display_name=display_names.get(p.uploaded_by_user_id),
        )
        for p in photos
    ]


# ---------------------------------------------------------------------------
# Patch
# ---------------------------------------------------------------------------


@router.patch(
    "/{place_id}/photos/{photo_id}",
    response_model=PlacePhotoRead,
    summary="Edit a place photo (set hero / caption)",
    description=(
        "Two independently optional fields. ``is_hero`` is "
        "owner-only (admins also pass): setting true atomically "
        "clears the previous hero on the same place. ``caption`` "
        "is editable by the uploader OR an owner of the place."
    ),
)
def patch_place_photo(
    place_id: UUID,
    photo_id: UUID,
    body: PlacePhotoUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    storage: StorageClient = Depends(get_photos_storage_client),
) -> PlacePhotoRead:
    _ensure_place_exists(db, place_id)
    photo = get_photo(db, photo_id=photo_id)
    if photo is None or photo.place_id != place_id:
        raise NotFoundError("PLACE_PHOTO_NOT_FOUND", "Photo not found")

    is_owner_or_admin = _user_can_manage_place(db, user, place_id)
    is_uploader = (
        photo.uploaded_by_user_id is not None
        and photo.uploaded_by_user_id == user.id
    )

    if body.is_hero is not None:
        # Hero mutation is owner-only. Consumers patching their
        # own photo can edit caption but not promote it.
        if not is_owner_or_admin:
            raise ForbiddenError(
                "PLACE_PHOTO_HERO_OWNER_ONLY",
                "Only the place's owner can set or unset the hero photo.",
            )
        if body.is_hero is True:
            # Atomic swap: clear current hero (if any) before
            # marking this one. The partial unique index would
            # reject the UPDATE otherwise.
            clear_hero_for_place(db, place_id=place_id)
            photo.is_hero = True
        else:
            photo.is_hero = False

    if body.caption is not None:
        if not (is_owner_or_admin or is_uploader):
            raise ForbiddenError(
                "PLACE_PHOTO_CAPTION_FORBIDDEN",
                (
                    "Only the photo's uploader or the place's owner "
                    "can edit a caption."
                ),
            )
        # Empty string clears; non-empty replaces. Pydantic has
        # already enforced max_length.
        photo.caption = body.caption or None

    db.add(photo)
    db.commit()
    db.refresh(photo)

    uploader_display_name = None
    if photo.uploaded_by_user_id:
        row = db.execute(
            select(User.display_name).where(User.id == photo.uploaded_by_user_id)
        ).scalar_one_or_none()
        uploader_display_name = row

    return _build_photo_read(
        photo,
        storage=storage,
        uploader_display_name=uploader_display_name,
    )


# ---------------------------------------------------------------------------
# Delete (soft)
# ---------------------------------------------------------------------------


@router.delete(
    "/{place_id}/photos/{photo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a place photo",
    description=(
        "Tiered authorization: admin can delete anything; the "
        "place's owner can delete any photo on their place; the "
        "uploader can delete their own. Soft delete leaves bytes "
        "in the bucket for admin restore."
    ),
)
def delete_place_photo(
    place_id: UUID,
    photo_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    _ensure_place_exists(db, place_id)
    photo = get_photo(db, photo_id=photo_id)
    if photo is None or photo.place_id != place_id:
        raise NotFoundError("PLACE_PHOTO_NOT_FOUND", "Photo not found")

    is_owner_or_admin = _user_can_manage_place(db, user, place_id)
    is_uploader = (
        photo.uploaded_by_user_id is not None
        and photo.uploaded_by_user_id == user.id
    )

    if not (is_owner_or_admin or is_uploader):
        raise ForbiddenError(
            "PLACE_PHOTO_DELETE_FORBIDDEN",
            (
                "You don't have permission to delete this photo. "
                "Only the uploader, the place's owner, or an admin "
                "can delete."
            ),
        )

    soft_delete_photo(db, photo=photo)
    db.commit()
