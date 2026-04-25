"""SQLAlchemy model for the server-side session store.

A session is the authoritative record of "this browser is logged in as
this user until this time." The cookie we set on the client holds only
the ``id`` — every request resolves it server-side so revocation (by
user logout, password change, or admin action) takes effect immediately.

Deliberately *not* a JWT:
  * Revocation is cheap and instant (UPDATE revoked_at).
  * No encryption-key rotation.
  * No refresh-token dance — ``expires_at`` is the only TTL, and the
    periodic cleanup job drops rows past that point.

If we later need stateless auth (mobile API, service-to-service), we
can add JWT alongside without ripping this out.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Updated on every request that successfully resolves this session.
    # Useful for an admin "revoke anything idle for N days" sweep, and
    # for showing "last seen" on a future sessions-list UI.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class InviteToken(Base):
    """Single-use token for completing an invite or password reset.

    Purpose
    -------
    Admins invite new users via ``POST /admin/users``. The invited user
    has no password yet, and we're explicitly not sending email (that's
    a separate, deferred task). Instead: we mint a token, hand it back
    to the admin as part of the create response, and the admin shares
    the resulting URL however makes sense for their flow (Slack DM,
    1Password, in-person onboarding). The invited user hits the URL,
    picks a password, and lands signed in.

    Security posture
    ----------------
      * Tokens are stored as SHA-256 hashes, not plaintext. A DB leak
        doesn't hand over outstanding invites.
      * Plaintext is shown exactly once — in the API response to the
        admin who created the invite. No re-fetch path.
      * ``expires_at`` enforces a hard TTL (7 days by default). A
        partial unique index on ``(user_id, purpose)`` WHERE
        ``consumed_at IS NULL AND expires_at > now()`` stops a user
        from having two live invites outstanding for the same purpose.
      * ``consumed_at`` makes the token single-use: setting it on
        redeem means the same link can't be replayed.

    Generalized
    -----------
    ``purpose`` lets the same table serve password-reset in a later
    pass. Today we only emit "INVITE" rows; when reset ships it writes
    "PASSWORD_RESET" and everything else (resolve, consume, sweep)
    works unchanged.
    """

    __tablename__ = "invite_tokens"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # SHA-256 hex digest of the plaintext token. 64 chars. We use the
    # bare digest (not argon2) because the plaintext already carries
    # 256 bits of entropy — offline brute-force against a leaked hash
    # isn't tractable, and a fast hash keeps verify cheap enough that
    # the endpoint doesn't become a denial-of-service vector.
    token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )

    # Stored as VARCHAR + CHECK rather than a native enum so adding a
    # new purpose (password reset, email verification) is a CHECK
    # constraint change + app code change, no ALTER TYPE dance.
    purpose: Mapped[str] = mapped_column(
        sa.String(32), nullable=False, server_default=sa.text("'INVITE'")
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # Set on successful redeem. Single-use: any future verify with the
    # same plaintext 400s.
    consumed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # The admin who minted this invite. Non-null today because
    # everything goes through POST /admin/users, but left nullable for
    # the future "user-initiated password reset" path where the actor
    # is the user themselves and bookkeeping actor_user_id = user_id
    # feels wrong.
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="SET NULL"),
        nullable=True,
    )
