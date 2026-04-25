"""Session repo.

Centralizes every write to ``app.sessions`` so the auth flow never
touches the table directly. Three core paths:

  * ``create_session`` — new login, returns the row.
  * ``resolve_session`` — read-only lookup by id. Filters out expired
    and revoked rows; bumps ``last_seen_at`` when found. Callers get
    back a tuple of (Session, User) so a single round-trip covers
    "who is this request" without a second query.
  * ``revoke_session`` — logout or admin action. Idempotent.

Plus a utility for the periodic cleanup that drops expired rows so
the table doesn't grow forever.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, delete, select, update
from sqlalchemy.orm import Session as DbSession

from app.modules.auth.models import Session
from app.modules.users.models import User


# Default session lifetime. 30 days feels right for an admin panel —
# long enough that admins don't get logged out mid-week, short enough
# that a stolen cookie has a bounded blast radius. Adjustable per-call
# if we ever want shorter sessions for high-privilege actions.
DEFAULT_SESSION_TTL = timedelta(days=30)


def create_session(
    db: DbSession,
    *,
    user_id: UUID,
    ttl: timedelta = DEFAULT_SESSION_TTL,
) -> Session:
    """Insert a new session for ``user_id`` with a fresh expiry."""
    now = datetime.now(timezone.utc)
    session = Session(
        user_id=user_id,
        expires_at=now + ttl,
        created_at=now,
        last_seen_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def resolve_session(
    db: DbSession, *, session_id: UUID
) -> tuple[Session, User] | None:
    """Look up a session by id and return the associated user.

    Returns None when:
      * the session doesn't exist,
      * ``revoked_at`` is set (logout or admin kill),
      * ``expires_at`` is in the past,
      * the owning user row is inactive.

    On success, the session's ``last_seen_at`` is bumped to now — the
    mutation is cheap and lets an admin UI show accurate "last seen"
    info without a separate tracking mechanism. Commit is deferred to
    the caller via ``flush`` to keep this function cooperative with
    the request transaction.
    """
    now = datetime.now(timezone.utc)
    row = db.execute(
        select(Session, User)
        .join(User, User.id == Session.user_id)
        .where(Session.id == session_id)
        .where(Session.revoked_at.is_(None))
        .where(Session.expires_at > now)
        .where(User.is_active.is_(True))
    ).one_or_none()
    if row is None:
        return None
    session, user = row

    # Bump last_seen_at. Small write on the hot path but lets us answer
    # "how recently has this session been used?" without extra
    # tracking. Committed by the surrounding request/response cycle.
    session.last_seen_at = now
    db.add(session)
    db.flush()

    return session, user


def revoke_session(db: DbSession, *, session_id: UUID) -> None:
    """Mark a session revoked. Idempotent — already-revoked rows are
    left alone and no error is raised.

    Useful for: user-initiated logout, admin "kill their sessions"
    action, and post-password-change blanket revocation (see
    ``revoke_all_sessions_for_user``).
    """
    now = datetime.now(timezone.utc)
    db.execute(
        update(Session)
        .where(Session.id == session_id)
        .where(Session.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.commit()


def revoke_all_sessions_for_user(
    db: DbSession, *, user_id: UUID
) -> int:
    """Revoke every active session for a user. Returns the count.

    The right thing to do on password change, role demotion, or
    account deactivation — kicks the user out everywhere they're
    signed in. Doesn't delete rows so the audit trail survives.
    """
    now = datetime.now(timezone.utc)
    result = db.execute(
        update(Session)
        .where(Session.user_id == user_id)
        .where(Session.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.commit()
    return result.rowcount or 0


def cleanup_expired_sessions(db: DbSession, *, before: datetime | None = None) -> int:
    """Hard-delete expired session rows so the table doesn't grow forever.

    Meant to be called from a periodic job (cron, scheduler). Passing
    an explicit ``before`` makes it testable deterministically; default
    uses wall clock.

    Returns the number of rows deleted.
    """
    cutoff = before if before is not None else datetime.now(timezone.utc)
    result = db.execute(
        delete(Session).where(Session.expires_at < cutoff)
    )
    db.commit()
    return result.rowcount or 0
