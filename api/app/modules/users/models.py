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

    # When the user confirmed control of ``email``. NULL means never.
    #
    # A timestamp rather than a boolean: it answers the same yes/no question
    # and also tells you *when*, which is what you want when investigating an
    # account later. Gates content that carries a business's reputation
    # (reviews, owner replies) via ``require_verified_email``; deliberately
    # does NOT gate browsing, favorites, or sign-in, so signup → value stays
    # uninterrupted for everything that can't hurt anyone.
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @property
    def email_verified(self) -> bool:
        """Convenience for the common boolean read."""
        return self.email_verified_at is not None

    # When this user accepted the terms, and which version they accepted.
    #
    # Both NULL for every account that predates acceptance being recorded.
    # Deliberately not backfilled — stamping an acceptance nobody gave would
    # manufacture evidence of consent, and NULL is what makes the in-app
    # prompt fire for exactly the people who never saw any terms.
    #
    # Version rather than a boolean so a revision re-prompts everyone by
    # bumping app.core.legal.TERMS_VERSION. See that module.
    terms_accepted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    terms_version: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

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