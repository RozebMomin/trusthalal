"""Per-user, per-category email opt-outs.

Notifications default ON. A row here = the user unsubscribed from that
category. Transactional categories (claim decisions, disputes) ignore this
table by policy — see ``app.core.notifications.MANDATORY_CATEGORIES``.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NotificationUnsubscribe(Base):
    __tablename__ = "notification_unsubscribes"
    __table_args__ = {"schema": "app"}

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    category: Mapped[str] = mapped_column(String(40), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
