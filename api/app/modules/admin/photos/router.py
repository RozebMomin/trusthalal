"""Admin moderation for reported place photos.

This surface didn't exist before — ``photos/repo.py`` has supported
``include_deleted=True`` "for admin moderation" and the delete endpoint has
granted admins blanket rights since the photo pipeline shipped, but nothing
ever consumed either. Now that owners can only *report* diner photos rather
than delete them, an admin has to be able to act or the report goes nowhere.

Structurally a near-copy of ``admin/reviews/router.py``: grouped queue,
detail with context, one resolve endpoint taking a verdict plus an action.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.storage import StorageClient, get_photos_storage_client
from app.db.deps import get_db
from app.modules.notifications.events import notify_photo_removed
from app.modules.places.enums import PhotoAttribution, attribution_for
from app.modules.places.models import Place, PlacePhoto
from app.modules.places.photos.repo import get_photo, soft_delete_photo
from app.modules.places.photos.reports import (
    PhotoReportReason,
    PhotoReportStatus,
    PlacePhotoReport,
)
from app.modules.users.enums import UserRole
from app.modules.users.models import User

admin_photos_router = APIRouter(prefix="/admin", tags=["admin-photos"])


class AdminPhotoReportRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    photo_id: UUID
    place_id: UUID
    place_name: Optional[str] = None
    url: str
    attribution: PhotoAttribution
    uploader_display_name: Optional[str] = None
    reasons: list[PhotoReportReason] = Field(default_factory=list)
    report_count: int
    open_report_count: int
    latest_report_at: datetime
    #: True when the reporter manages this place. An owner reporting a diner's
    #: photo of their own restaurant has an obvious interest, and a moderator
    #: should see that without going to check.
    reported_by_owner: bool = False


class AdminPhotoQueueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[AdminPhotoReportRow]
    total: int
    next_offset: Optional[int] = None


class AdminPhotoReportDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    photo_id: UUID
    place_id: UUID
    place_name: Optional[str] = None
    url: str
    attribution: PhotoAttribution
    caption: Optional[str] = None
    uploader_display_name: Optional[str] = None
    uploader_email: Optional[str] = None
    uploader_account_age_days: Optional[int] = None
    is_hero: bool = False
    created_at: datetime
    #: Present when the photo hangs off a review — a plate photo means
    #: something different once you can read what the diner said about it.
    review_id: Optional[UUID] = None
    review_rating: Optional[int] = None
    review_body: Optional[str] = None
    reports: list[dict] = Field(default_factory=list)


class AdminResolvePhotoReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: PhotoReportStatus
    #: True removes the photo (soft delete). Separate from the verdict
    #: because a report can be valid without warranting a takedown.
    remove: bool = False
    #: Shown to the uploader verbatim when the photo comes down.
    resolution_note: Optional[str] = Field(default=None, max_length=2000)


@admin_photos_router.get(
    "/photo-reports",
    response_model=AdminPhotoQueueResponse,
    summary="Reported photos queue",
    description=(
        "Grouped by photo — several complaints about the same image are one "
        "decision, not several. Defaults to open reports."
    ),
)
def list_photo_reports(
    report_status: PhotoReportStatus = Query(
        default=PhotoReportStatus.OPEN, alias="status"
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
    storage: StorageClient = Depends(get_photos_storage_client),
) -> AdminPhotoQueueResponse:
    grouped = (
        select(
            PlacePhotoReport.photo_id,
            func.count(PlacePhotoReport.id).label("n"),
            func.max(PlacePhotoReport.created_at).label("latest"),
        )
        .where(PlacePhotoReport.status == report_status.value)
        .group_by(PlacePhotoReport.photo_id)
        .order_by(func.max(PlacePhotoReport.created_at).desc())
    )
    total = int(
        db.execute(select(func.count()).select_from(grouped.subquery())).scalar_one()
    )
    rows = db.execute(grouped.limit(limit).offset(offset)).all()

    items: list[AdminPhotoReportRow] = []
    for photo_id, n, latest in rows:
        # include_deleted so an already-removed photo still shows its
        # resolved history rather than vanishing from the queue.
        photo = get_photo(db, photo_id=photo_id, include_deleted=True)
        if photo is None:
            continue

        place = db.get(Place, photo.place_id)
        uploader = (
            db.get(User, photo.uploaded_by_user_id)
            if photo.uploaded_by_user_id
            else None
        )
        reports = db.execute(
            select(PlacePhotoReport).where(PlacePhotoReport.photo_id == photo_id)
        ).scalars().all()

        items.append(
            AdminPhotoReportRow(
                photo_id=photo.id,
                place_id=photo.place_id,
                place_name=place.name if place else None,
                url=storage.public_url(photo.storage_path),
                attribution=attribution_for(
                    source=photo.source, review_id=photo.review_id
                ),
                uploader_display_name=uploader.display_name if uploader else None,
                reasons=sorted({r.reason for r in reports}),
                report_count=len(reports),
                open_report_count=len(
                    [r for r in reports if r.status == PhotoReportStatus.OPEN.value]
                ),
                latest_report_at=latest,
                reported_by_owner=_any_reporter_manages_place(
                    db, place_id=photo.place_id, reports=reports
                ),
            )
        )

    return AdminPhotoQueueResponse(
        items=items,
        total=total,
        next_offset=(offset + limit) if (offset + limit) < total else None,
    )


def _any_reporter_manages_place(db: Session, *, place_id: UUID, reports) -> bool:
    from app.modules.organizations.models import OrganizationMember, PlaceOwner

    if not reports:
        return False
    manager_ids = set(
        db.execute(
            select(OrganizationMember.user_id)
            .join(
                PlaceOwner,
                PlaceOwner.organization_id == OrganizationMember.organization_id,
            )
            .where(
                PlaceOwner.place_id == place_id,
                PlaceOwner.status.in_(("ACTIVE", "VERIFIED")),
                OrganizationMember.status == "ACTIVE",
            )
        ).scalars().all()
    )
    return any(r.reporter_user_id in manager_ids for r in reports)


@admin_photos_router.get(
    "/photo-reports/{photo_id}",
    response_model=AdminPhotoReportDetail,
    summary="Reported photo with full context",
)
def get_photo_report(
    photo_id: UUID,
    _admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
    storage: StorageClient = Depends(get_photos_storage_client),
) -> AdminPhotoReportDetail:
    photo = get_photo(db, photo_id=photo_id, include_deleted=True)
    if photo is None:
        raise NotFoundError("PLACE_PHOTO_NOT_FOUND", "Photo not found")

    place = db.get(Place, photo.place_id)
    uploader = (
        db.get(User, photo.uploaded_by_user_id)
        if photo.uploaded_by_user_id
        else None
    )

    age_days: Optional[int] = None
    if uploader is not None and uploader.created_at is not None:
        age_days = (datetime.now(timezone.utc) - uploader.created_at).days

    review_rating = review_body = None
    if photo.review_id is not None:
        from app.modules.reviews.models import PlaceReview

        review = db.get(PlaceReview, photo.review_id)
        if review is not None:
            review_rating, review_body = review.rating, review.body

    reports = db.execute(
        select(PlacePhotoReport)
        .where(PlacePhotoReport.photo_id == photo_id)
        .order_by(PlacePhotoReport.created_at.desc())
    ).scalars().all()

    report_dicts = []
    for r in reports:
        reporter = db.get(User, r.reporter_user_id)
        report_dicts.append(
            {
                "id": str(r.id),
                "reason": r.reason,
                "detail": r.detail,
                "status": r.status,
                "reporter_display_name": reporter.display_name if reporter else None,
                "created_at": r.created_at.isoformat(),
            }
        )

    return AdminPhotoReportDetail(
        photo_id=photo.id,
        place_id=photo.place_id,
        place_name=place.name if place else None,
        url=storage.public_url(photo.storage_path),
        attribution=attribution_for(source=photo.source, review_id=photo.review_id),
        caption=photo.caption,
        uploader_display_name=uploader.display_name if uploader else None,
        uploader_email=uploader.email if uploader else None,
        uploader_account_age_days=age_days,
        is_hero=photo.is_hero,
        created_at=photo.created_at,
        review_id=photo.review_id,
        review_rating=review_rating,
        review_body=review_body,
        reports=report_dicts,
    )


@admin_photos_router.post(
    "/photo-reports/{photo_id}/resolve",
    response_model=AdminPhotoReportDetail,
    summary="Resolve the reports on a photo",
    description=(
        "Closes every open report on the photo. `decision` is the verdict on "
        "the reports; `remove` is what happens to the image — separate, "
        "because a report can be valid without warranting a takedown. A note "
        "is required when removing and is emailed to the uploader verbatim."
    ),
)
def resolve_photo_report(
    photo_id: UUID,
    payload: AdminResolvePhotoReport,
    background: BackgroundTasks,
    admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
    storage: StorageClient = Depends(get_photos_storage_client),
) -> AdminPhotoReportDetail:
    photo = get_photo(db, photo_id=photo_id, include_deleted=True)
    if photo is None:
        raise NotFoundError("PLACE_PHOTO_NOT_FOUND", "Photo not found")

    if payload.remove and not (payload.resolution_note or "").strip():
        raise BadRequestError(
            "MODERATION_NOTE_REQUIRED",
            "Explain why — the uploader is shown this reason.",
        )

    if payload.remove and photo.deleted_at is None:
        # Soft delete: bytes stay in the bucket for audit, and
        # soft_delete_photo clears is_hero so a removed cover doesn't leave
        # the place pointing at a hidden image.
        soft_delete_photo(db, photo=photo)

    now = datetime.now(timezone.utc)
    open_reports = db.execute(
        select(PlacePhotoReport).where(
            PlacePhotoReport.photo_id == photo_id,
            PlacePhotoReport.status == PhotoReportStatus.OPEN.value,
        )
    ).scalars().all()
    for r in open_reports:
        r.status = payload.decision.value
        r.resolved_by_user_id = admin.id
        r.resolved_at = now
        r.resolution_note = payload.resolution_note or None
        db.add(r)

    db.commit()

    track(
        "photo_moderated",
        {
            "photo_id": str(photo_id),
            "decision": payload.decision.value,
            "removed": payload.remove,
            "reports_closed": len(open_reports),
        },
    )

    if payload.remove:
        notify_photo_removed(
            background, db, photo=photo, note=payload.resolution_note
        )

    return get_photo_report(
        photo_id=photo_id, _admin=admin, db=db, storage=storage
    )
