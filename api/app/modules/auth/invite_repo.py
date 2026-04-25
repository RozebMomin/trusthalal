"""Invite / set-password token repo.

Four operations, all thin wrappers around SQLAlchemy:

  * ``mint_invite`` — creates the DB row and returns the plaintext
    token. Called from the admin user-create path. Plaintext is never
    stored: only the SHA-256 hash goes into ``token_hash``.
  * ``resolve_invite`` — looks up a row by plaintext token. Filters
    out expired/consumed rows. Used by both the GET info path and the
    POST consume path.
  * ``consume_invite`` — marks the row as consumed. Caller is
    responsible for doing the password update in the same transaction.
  * ``revoke_live_invites_for`` — hard-deletes outstanding
    (non-consumed) invites for a user+purpose combo so a re-invite
    doesn't trip the partial unique index. Not a soft delete: the old
    token is meant to be unusable immediately and audit already lives
    in the user's event history.

Why hash the plaintext at rest? A leaked DB dump would otherwise let
an attacker complete any outstanding invite (e.g. seed an admin
account for themselves). Hashing keeps the leak cost bounded to
"rotate these users' passwords" instead of "anyone can claim an
unconsumed invite."

Why SHA-256 and not argon2id? The plaintext carries 256 bits of
entropy (``secrets.token_urlsafe(32)`` → 43 base64 chars). Offline
brute-force against that hash is not tractable, and a fast hash keeps
the verify endpoint cheap — useful because GET /auth/invite/{token}
is anonymous and therefore a potential DoS target. Password hashes
use argon2 because user-chosen passwords typically have 30-50 bits of
entropy and need the computational cost to be safe.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, delete, select
from sqlalchemy.orm import Session as DbSession

from app.core.config import settings
from app.modules.auth.models import InviteToken


# ---------------------------------------------------------------------------
# Token generation + hashing
# ---------------------------------------------------------------------------

# 32 bytes → 43 URL-safe base64 characters. Plenty of entropy.
# ``secrets.token_urlsafe`` uses the OS CSPRNG; no separate seeding
# needed.
_TOKEN_BYTES = 32


def _hash_token(token_plain: str) -> str:
    """Return the SHA-256 hex digest of ``token_plain``.

    Deterministic so we can look up the row by hashing whatever the
    client sent and querying the hash column directly.
    """
    return hashlib.sha256(token_plain.encode("utf-8")).hexdigest()


def _generate_token() -> str:
    """Fresh URL-safe random token."""
    return secrets.token_urlsafe(_TOKEN_BYTES)


# ---------------------------------------------------------------------------
# Mint / revoke
# ---------------------------------------------------------------------------

DEFAULT_PURPOSE_INVITE = "INVITE"


def revoke_live_invites_for(
    db: DbSession, *, user_id: UUID, purpose: str = DEFAULT_PURPOSE_INVITE
) -> int:
    """Hard-delete unconsumed invites for a user+purpose combo.

    Needed before minting a replacement token because the partial
    unique index ``ix_invite_tokens_user_id_live`` permits only one
    live row per (user_id, purpose). Without this, a re-invite would
    IntegrityError.

    Soft-delete (``consumed_at = now()``) was considered and rejected:
    a consumed-but-unused token is meaningless and muddies the audit
    trail. Hard delete keeps the table meaning "tokens someone might
    still want to redeem, or just did."
    """
    result = db.execute(
        delete(InviteToken).where(
            and_(
                InviteToken.user_id == user_id,
                InviteToken.purpose == purpose,
                InviteToken.consumed_at.is_(None),
            )
        )
    )
    return result.rowcount or 0


def mint_invite(
    db: DbSession,
    *,
    user_id: UUID,
    created_by_user_id: UUID | None,
    purpose: str = DEFAULT_PURPOSE_INVITE,
    ttl: timedelta | None = None,
) -> tuple[InviteToken, str]:
    """Create an invite row and return ``(row, plaintext_token)``.

    Any pre-existing live invite for the same user+purpose is revoked
    first — a re-invite replaces the previous link. This is
    intentional: the admin's expectation is "send this person a new
    link," not "both links work."

    The plaintext token is returned alongside the ORM object so the
    caller can embed it in the response; it's never stored anywhere
    the caller can't see.
    """
    # Clear the partial-unique slot before inserting.
    revoke_live_invites_for(db, user_id=user_id, purpose=purpose)

    plaintext = _generate_token()
    ttl = ttl if ttl is not None else timedelta(days=settings.INVITE_TOKEN_TTL_DAYS)
    row = InviteToken(
        user_id=user_id,
        token_hash=_hash_token(plaintext),
        purpose=purpose,
        expires_at=datetime.now(timezone.utc) + ttl,
        created_by_user_id=created_by_user_id,
    )
    db.add(row)
    db.flush()
    return row, plaintext


# ---------------------------------------------------------------------------
# Resolve / consume
# ---------------------------------------------------------------------------


def resolve_invite(
    db: DbSession,
    *,
    token_plain: str,
    purpose: str = DEFAULT_PURPOSE_INVITE,
) -> Optional[InviteToken]:
    """Return the live invite matching ``token_plain``, else None.

    "Live" means: exists, not consumed, not expired. The caller treats
    every None the same way — a generic 404/400 with no
    discriminating error message — so an attacker can't distinguish
    "invalid token" from "expired" from "already used."
    """
    now = datetime.now(timezone.utc)
    row = db.execute(
        select(InviteToken)
        .where(InviteToken.token_hash == _hash_token(token_plain))
        .where(InviteToken.purpose == purpose)
        .where(InviteToken.consumed_at.is_(None))
        .where(InviteToken.expires_at > now)
    ).scalar_one_or_none()
    return row


def consume_invite(db: DbSession, *, token: InviteToken) -> None:
    """Mark the token consumed. Caller owns the commit.

    Intentionally takes the already-resolved row rather than a
    plaintext string: this is the "I just verified it, now burn it"
    call, and re-verifying here would be wasteful plus racy.
    """
    token.consumed_at = datetime.now(timezone.utc)
    db.add(token)
    db.flush()
