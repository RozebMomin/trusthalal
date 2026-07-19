"""Blocking another diner.

Required by App Store Review Guideline 1.2 for any app with user-generated
content, alongside filtering (we have text moderation), reporting (the report
queue), and published contact information.

## Blocking is not reporting, and the difference is load-bearing

**Reporting** says "staff should look at this" — it escalates, it can end with
content coming down for everyone, and it puts a human in the loop.

**Blocking** says "I don't want to see this person" — it changes nothing for
anyone else, nobody is told, and no moderator ever sees it.

Keeping them separate matters because they fail in opposite directions. Someone
who reports when they meant to block gets no immediate relief and a moderator
gets a non-actionable queue item. Someone who blocks when they meant to report
quietly hides abuse from the only people who could act on it — which is why the
block confirmation points at reporting too.

## One-directional and silent, on purpose

The block hides the blocked person's reviews from the blocker. It does not hide
the blocker's reviews from them, and nobody is notified. A notification would
turn a quiet self-protective act into a confrontation, which is the opposite of
what someone reaching for this button wants.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Sequence
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.exceptions import BadRequestError
from app.db.base import Base


class UserBlock(Base):
    """``blocker`` no longer sees ``blocked``'s content."""

    __tablename__ = "user_blocks"
    __table_args__ = (
        UniqueConstraint(
            "blocker_user_id", "blocked_user_id", name="uq_user_blocks_pair"
        ),
        CheckConstraint(
            "blocker_user_id <> blocked_user_id", name="ck_user_blocks_not_self"
        ),
        Index("ix_user_blocks_blocker", "blocker_user_id"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    blocker_user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    blocked_user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )


def blocked_user_ids(db: Session, *, viewer_id: UUID | None) -> set[UUID]:
    """Authors this viewer has blocked.

    Returns an empty set for anonymous callers rather than making every call
    site branch on "is anyone signed in".
    """
    if viewer_id is None:
        return set()
    return set(
        db.execute(
            select(UserBlock.blocked_user_id).where(
                UserBlock.blocker_user_id == viewer_id
            )
        )
        .scalars()
        .all()
    )


def block_user(db: Session, *, blocker_id: UUID, blocked_id: UUID) -> UserBlock:
    """Block someone. Idempotent — caller owns the commit.

    Blocking twice returns the existing row rather than 409ing. A conflict
    here would be a confusing failure for an action whose entire purpose is
    "make this person go away": the desired state is already true.
    """
    if blocker_id == blocked_id:
        raise BadRequestError(
            "CANNOT_BLOCK_SELF", "You can't block yourself."
        )

    existing = db.execute(
        select(UserBlock).where(
            UserBlock.blocker_user_id == blocker_id,
            UserBlock.blocked_user_id == blocked_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    row = UserBlock(blocker_user_id=blocker_id, blocked_user_id=blocked_id)
    db.add(row)
    db.flush()
    return row


def unblock_user(db: Session, *, blocker_id: UUID, blocked_id: UUID) -> bool:
    """Remove a block. Returns whether one existed. Caller owns the commit."""
    existing = db.execute(
        select(UserBlock).where(
            UserBlock.blocker_user_id == blocker_id,
            UserBlock.blocked_user_id == blocked_id,
        )
    ).scalar_one_or_none()
    if existing is None:
        return False
    db.delete(existing)
    db.flush()
    return True


def list_blocks(db: Session, *, blocker_id: UUID) -> Sequence[UserBlock]:
    """Everyone this user has blocked, newest first.

    Powers the "Blocked people" screen. A block you can't find and undo is a
    trap, not a feature — Apple requires the ability to block, and leaving no
    way back would be its own kind of broken.
    """
    return (
        db.execute(
            select(UserBlock)
            .where(UserBlock.blocker_user_id == blocker_id)
            .order_by(UserBlock.created_at.desc())
        )
        .scalars()
        .all()
    )
