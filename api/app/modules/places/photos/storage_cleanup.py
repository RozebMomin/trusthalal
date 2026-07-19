"""Deferred deletion of storage objects.

## The problem

A photo lives in two places: a row in ``place_photos`` and bytes in a
Supabase bucket. Removing both atomically isn't possible — one is a database
transaction and the other is an HTTP call — so something has to give.

Today the bytes always give, in two different ways:

  * **Soft delete** (``soft_delete_photo``) sets ``deleted_at`` and leaves the
    object. That's deliberate — it makes admin restore a one-column update —
    but nothing ever comes back for the bytes.
  * **Hard delete via cascade.** ``place_photos.review_id`` is
    ``ON DELETE CASCADE``, so deleting a review takes its photo rows with it
    at the database level. No application code runs, so nothing can even
    *know* what to clean up: once the row is gone, the storage path is gone
    with it.

The second case is the sharper one. It isn't a failure path — it's what
happens every time a diner withdraws a review with photos.

## The shape of the fix

An outbox. Before a row disappears we record its storage path in
``storage_orphans``; a data-ops job drains the table and deletes from the
bucket. Recording the intent is transactional with the row's removal, and
the actual delete retries until it succeeds.

Soft-deleted photos aren't enqueued here. They're still restorable, so the
sweeper finds them separately once they're past a retention window — see
``internal-tools/data-ops`` for the job.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy import DateTime, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db.base import Base


class StorageOrphan(Base):
    """A bucket object whose owning row is gone or going.

    Deliberately carries no foreign key: the whole point is that it outlives
    the row it came from. It's a to-do list for the storage layer, not a
    relation.
    """

    __tablename__ = "storage_orphans"
    __table_args__ = (
        # The drain query: unpurged, oldest first.
        Index(
            "ix_storage_orphans_pending",
            "purged_at",
            "created_at",
        ),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    #: Which bucket the path is in. Stored rather than assumed — there are
    #: two (public photos, private evidence) and a future third shouldn't
    #: silently delete from the wrong one.
    bucket: Mapped[str] = mapped_column(String(128), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)

    #: Why it was orphaned. Free text, for operators reading the table when
    #: something looks wrong — not a discriminator anything branches on.
    reason: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    purged_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Last failure, kept so a permanently-stuck row is visible rather than
    #: silently retried forever.
    purge_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


def enqueue_orphans(
    db: Session, *, bucket: str, storage_paths: Iterable[str], reason: str
) -> int:
    """Record objects to delete later. Caller owns the commit.

    Flushed, not committed, so it lands in the same transaction as whatever
    removed the row. If that transaction rolls back, so does the intent to
    delete — which is right: the bytes are still referenced.
    """
    count = 0
    for path in storage_paths:
        if not path:
            continue
        db.add(
            StorageOrphan(bucket=bucket, storage_path=path, reason=reason)
        )
        count += 1
    if count:
        db.flush()
    return count
