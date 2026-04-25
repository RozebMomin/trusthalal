from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    role: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        server_default=text("'CONSUMER'"),
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    # Argon2id hash produced by ``app.core.password_hashing.hash_password``.
    # Nullable because:
    #   * pre-auth seed users exist with no password (they authenticate
    #     via dev-login only in local env);
    #   * invited users start without a hash and set one via the
    #     set-password-token flow.
    # A non-null hash is the precondition for ``POST /auth/login``.
    password_hash: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # If you later add verification_events / claims, you can relationship() back from there.