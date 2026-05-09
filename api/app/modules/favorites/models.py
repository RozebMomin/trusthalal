"""SQLAlchemy model for consumer favorites — places a signed-in
consumer has saved to come back to.

One row per ``(user_id, place_id)`` pair. The composite PK is the
natural unique-by-(user, place) constraint so a duplicate save
collapses to a no-op at the DB layer. ``created_at`` drives newest-
first sort on the consumer favorites listing.

Why a dedicated module instead of cramming this into
``consumer_preferences``: preferences is "default search filters"
(one row per user, full-replace upsert). Favorites is "many-to-many
of users to places" (variable-cardinality, per-row insert / delete).
The two have nothing to do with each other beyond happening to be
consumer-side reads off ``/me``; a shared module would just create
import cycles when the favorites repo grows.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID as PyUUID

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ConsumerFavorite(Base):
    """One row per place a consumer has favorited.

    Composite PK (user_id, place_id) — the constraint layer
    deduplicates so the API surface can be idempotent
    (``POST /me/favorites/{place_id}`` returns 200 if the row
    already existed, 201 if it was newly created).

    Cascade-delete on both FKs: a deleted user shouldn't leave
    orphan favorite rows, and a place that's hard-deleted shouldn't
    leave dangling FKs either. Soft-deleted places (``deleted_at``)
    keep their favorite rows — the listing endpoint can filter
    those out so the consumer doesn't see ghosts, and a future
    "restore" admin action brings them back transparently.
    """

    __tablename__ = "consumer_favorites"
    __table_args__ = {"schema": "app"}

    user_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    place_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        primary_key=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
