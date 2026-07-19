"""Reports against place photos.

Deliberately a separate table from ``place_review_reports`` rather than a
generalized "reports" table. A photo report has no rating, no reply, and a
different set of reasons; merging them would produce a nullable-everything
super-table and a moderation queue that branches on content type in every
query. Two small focused tables beat one that means different things
depending on which columns happen to be populated.

The flow this exists to support: an owner who dislikes a diner's photo can
**report** it but not delete it — matching Google and Yelp, and mattering more
here because a photo of what someone was actually served is evidence.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Optional

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PhotoReportReason(StrEnum):
    """Why someone flagged a photo.

    ``NOT_THIS_PLACE`` is the most common honest report — people photograph
    the wrong storefront. ``MISLEADING`` is the one that will be abused by
    owners who simply dislike an accurate photo, which is exactly why the
    decision sits with an admin rather than with them.
    """

    NOT_THIS_PLACE = "NOT_THIS_PLACE"
    INAPPROPRIATE = "INAPPROPRIATE"
    MISLEADING = "MISLEADING"
    PERSONAL_INFO = "PERSONAL_INFO"
    COPYRIGHT = "COPYRIGHT"
    OTHER = "OTHER"


class PhotoReportStatus(StrEnum):
    OPEN = "OPEN"
    UPHELD = "UPHELD"
    DISMISSED = "DISMISSED"


class PlacePhotoReport(Base):
    __tablename__ = "place_photo_reports"
    __table_args__ = (
        # One report per person per photo — the report count stays a
        # meaningful triage signal rather than a measure of persistence.
        UniqueConstraint(
            "photo_id", "reporter_user_id", name="uq_photo_reports_photo_reporter"
        ),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    photo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.place_photos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    reporter_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    reason: Mapped[str] = mapped_column(
        sa.Enum(
            PhotoReportReason,
            name="photo_report_reason",
            native_enum=False,
            length=32,
        ),
        nullable=False,
    )
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        sa.Enum(
            PhotoReportStatus,
            name="photo_report_status",
            native_enum=False,
            length=32,
        ),
        nullable=False,
        server_default=text("'OPEN'"),
        index=True,
    )

    resolved_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Shown to the uploader when a photo is taken down, so it's written to
    #: them rather than as an internal note.
    resolution_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
