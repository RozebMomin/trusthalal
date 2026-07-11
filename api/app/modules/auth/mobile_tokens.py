"""Bearer-token auth for the mobile app.

The web apps use the HttpOnly ``tht_session`` cookie, which React
Native cannot reliably persist (no shared cookie jar; HttpOnly is
invisible to JS; iOS drops it across reloads). Mobile therefore gets
a classic two-token scheme:

  * **Access token** — short-lived (1 hour). Sent as
    ``Authorization: Bearer <token>`` on every request.
  * **Refresh token** — long-lived (30 days), single-use. Exchanged at
    ``POST /auth/mobile/refresh`` for a brand-new pair; the old pair
    is revoked atomically (rotation limits the blast radius of a
    leaked refresh token).

Deliberately NOT JWTs. Both tokens are opaque random strings whose
SHA-256 lives in ``app.mobile_tokens`` — the same server-side
resolution model the session store uses, which buys instant
revocation, zero signing-key management, and no new dependency. The
per-request DB lookup is one indexed point read; the cookie path
already pays the identical cost.

Token format: ``tht_ma_<64 hex>`` (access) / ``tht_mr_<64 hex>``
(refresh). The prefix makes leaked tokens greppable and secret-scanner
friendly; the 32 random bytes come from ``secrets``.

Storage is hash-only: a database dump never yields usable tokens.
``pair_id`` groups the two tokens minted together so logout / rotation
can kill both with one UPDATE.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, func, select, update
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, Session as DbSession, mapped_column

from app.db.base import Base
from app.modules.users.models import User

ACCESS_TOKEN_TTL = timedelta(hours=1)
REFRESH_TOKEN_TTL = timedelta(days=30)

_ACCESS_PREFIX = "tht_ma_"
_REFRESH_PREFIX = "tht_mr_"

KIND_ACCESS = "ACCESS"
KIND_REFRESH = "REFRESH"


class MobileToken(Base):
    """One row per issued mobile token (access OR refresh)."""

    __tablename__ = "mobile_tokens"
    __table_args__ = {"schema": "app"}

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("app.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # SHA-256 hex of the raw token. Unique-indexed — this is the lookup
    # key on every authenticated mobile request.
    token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )

    # ACCESS | REFRESH. Plain string + app-level discipline (mirrors
    # the repo's native_enum=False posture) so adding a kind later is
    # a code-only change.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)

    # Groups the access+refresh pair minted together, so revoking a
    # pair (logout, rotation) is one UPDATE on an indexed column.
    pair_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), nullable=False, index=True
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


# ---------------------------------------------------------------------------
# Issue / resolve / rotate / revoke
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int  # access-token TTL in seconds — what clients schedule refresh off


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_token_pair(db: DbSession, *, user_id: UUID) -> TokenPair:
    """Mint a fresh access+refresh pair for ``user_id``.

    Raw tokens are returned exactly once; only hashes persist.
    """
    now = datetime.now(timezone.utc)
    pair_id = uuid.uuid4()

    raw_access = _ACCESS_PREFIX + secrets.token_hex(32)
    raw_refresh = _REFRESH_PREFIX + secrets.token_hex(32)

    db.add(
        MobileToken(
            user_id=user_id,
            token_hash=_hash(raw_access),
            kind=KIND_ACCESS,
            pair_id=pair_id,
            expires_at=now + ACCESS_TOKEN_TTL,
            created_at=now,
        )
    )
    db.add(
        MobileToken(
            user_id=user_id,
            token_hash=_hash(raw_refresh),
            kind=KIND_REFRESH,
            pair_id=pair_id,
            expires_at=now + REFRESH_TOKEN_TTL,
            created_at=now,
        )
    )
    db.commit()

    return TokenPair(
        access_token=raw_access,
        refresh_token=raw_refresh,
        expires_in=int(ACCESS_TOKEN_TTL.total_seconds()),
    )


def _resolve(
    db: DbSession, *, raw_token: str, kind: str, for_update: bool = False
) -> tuple[MobileToken, User] | None:
    """Hash-lookup a live token of ``kind`` and return it with its user.

    None on any failure (unknown, expired, revoked, inactive user) —
    one failure mode, mirroring ``resolve_session``.

    ``for_update`` takes a row lock on the token so concurrent callers
    serialize. The refresh path uses it: without the lock two requests
    replaying the same refresh token could both resolve before either
    revokes, minting two live pairs and defeating single-use rotation.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        select(MobileToken, User)
        .join(User, User.id == MobileToken.user_id)
        .where(MobileToken.token_hash == _hash(raw_token))
    )
    if for_update:
        # Lock only the token row (not the joined user).
        stmt = stmt.with_for_update(of=MobileToken)
    row = db.execute(stmt).first()
    if row is None:
        return None
    token, user = row
    if (
        token.kind != kind
        or token.revoked_at is not None
        or token.expires_at <= now
        or not user.is_active
    ):
        return None
    token.last_used_at = now
    db.flush()
    return token, user


def resolve_access_token(
    db: DbSession, *, raw_token: str
) -> tuple[MobileToken, User] | None:
    """The per-request auth path for ``Authorization: Bearer``."""
    return _resolve(db, raw_token=raw_token, kind=KIND_ACCESS)


def rotate_refresh_token(
    db: DbSession, *, raw_refresh_token: str
) -> tuple[TokenPair, User] | None:
    """Exchange a live refresh token for a brand-new pair.

    Single-use: the presented token's whole pair is revoked in the
    same transaction that mints the replacement. A replayed (already-
    rotated) refresh token resolves to nothing and the caller 401s —
    the client's recovery is a fresh login.
    """
    resolved = _resolve(
        db, raw_token=raw_refresh_token, kind=KIND_REFRESH, for_update=True
    )
    if resolved is None:
        return None
    token, user = resolved
    _revoke_pair(db, pair_id=token.pair_id)
    return issue_token_pair(db, user_id=user.id), user


def revoke_by_refresh_token(db: DbSession, *, raw_refresh_token: str) -> bool:
    """Logout: kill the pair the presented refresh token belongs to.

    Idempotent-friendly — an unknown/expired token returns False and
    the endpoint still responds 204; logout never fails visibly.
    """
    row = db.execute(
        select(MobileToken).where(
            MobileToken.token_hash == _hash(raw_refresh_token),
            MobileToken.kind == KIND_REFRESH,
        )
    ).scalar_one_or_none()
    if row is None:
        return False
    _revoke_pair(db, pair_id=row.pair_id)
    db.commit()
    return True


def revoke_all_mobile_tokens_for_user(db: DbSession, *, user_id: UUID) -> int:
    """Admin / password-change hammer: kill every live mobile token."""
    now = datetime.now(timezone.utc)
    result = db.execute(
        update(MobileToken)
        .where(MobileToken.user_id == user_id, MobileToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.commit()
    return result.rowcount or 0


def _revoke_pair(db: DbSession, *, pair_id: UUID) -> None:
    now = datetime.now(timezone.utc)
    db.execute(
        update(MobileToken)
        .where(MobileToken.pair_id == pair_id, MobileToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.flush()
