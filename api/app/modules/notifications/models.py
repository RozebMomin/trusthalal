"""Notification preferences + push device registrations.

Two tables:

  * ``notification_unsubscribes`` — per-user, per-category, PER-CHANNEL
    opt-outs. Notifications default ON; a row here = the user opted OUT of
    that category on that channel. Transactional categories ignore this
    table by policy — see ``app.core.notifications.MANDATORY_CATEGORIES``.
    The channel dimension is what lets someone keep the email receipt but
    silence the phone buzz (the most common request once push ships).

  * ``device_tokens`` — Expo push tokens, one row per device per user. The
    same physical device can move between users (shared phone), and one user
    can have many devices, so the natural key is the token itself. Rows are
    pruned when Expo reports ``DeviceNotRegistered``.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NotificationChannel:
    """Delivery channels a notification can be suppressed on."""

    EMAIL = "EMAIL"
    PUSH = "PUSH"


class NotificationUnsubscribe(Base):
    __tablename__ = "notification_unsubscribes"
    __table_args__ = {"schema": "app"}

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    category: Mapped[str] = mapped_column(String(40), primary_key=True)
    # Part of the PK so a user can opt out of PUSH for a category while
    # still receiving EMAIL for it (and vice versa).
    channel: Mapped[str] = mapped_column(
        String(16), primary_key=True, server_default="EMAIL"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DeviceToken(Base):
    """An Expo push token for one install of the mobile app."""

    __tablename__ = "device_tokens"
    __table_args__ = (
        UniqueConstraint("token", name="uq_device_tokens_token"),
        {"schema": "app"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Expo push token, e.g. "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]".
    token: Mapped[str] = mapped_column(String(255), nullable=False)
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Refreshed on every re-register so we can age out stale installs.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
