from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Cookie, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.deps import get_db
from app.modules.auth.repo import resolve_session
from app.modules.users.enums import UserRole
from app.modules.users.models import User


# Session cookie name — mirror of SESSION_COOKIE_NAME on the auth
# router side. Duplicated here rather than imported to avoid a cycle
# (auth router imports from core.auth for require_roles).
SESSION_COOKIE_NAME = "tht_session"


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    role: UserRole


def _user_from_session_cookie(db: Session, cookie: str | None) -> CurrentUser | None:
    """Resolve a session cookie to a CurrentUser, or None on any failure.

    Quiet by design — the caller decides what happens when resolution
    fails (401 on required routes, graceful fallthrough on optional
    ones). Any exception path here (malformed UUID, missing row,
    expired session, deactivated user) returns None so the caller sees
    one failure mode.
    """
    if not cookie:
        return None
    try:
        session_id = UUID(cookie)
    except ValueError:
        return None

    resolved = resolve_session(db, session_id=session_id)
    if resolved is None:
        return None
    _, user = resolved
    try:
        role = UserRole(user.role)
    except ValueError:
        return None
    return CurrentUser(id=user.id, role=role)


def _user_from_header(db: Session, x_user_id: str | None) -> CurrentUser | None:
    """Legacy X-User-Id resolution. Kept available for local dev.

    Dev-login flow hands out a user_id that the admin panel sets as
    NEXT_PUBLIC_DEV_ACTOR_ID and ships on every request. Works without
    password hashes, which is convenient for the seed users.

    Prod-like environments should NEVER accept this — callers gate on
    ``settings.ENV == "local"`` before invoking.
    """
    if not x_user_id:
        return None
    try:
        user_id = UUID(x_user_id)
    except ValueError:
        return None
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user:
        return None
    try:
        role = UserRole(user.role)
    except ValueError:
        return None
    return CurrentUser(id=user.id, role=role)


def get_current_user(
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> CurrentUser:
    """Resolve the authenticated user for a request.

    Preference order:
      1. Session cookie (the real auth path).
      2. X-User-Id header — only when both
         ``settings.DEV_HEADER_AUTH_ENABLED`` is True AND no session
         cookie was sent at all. This is test-only plumbing: the
         integration test harness flips the flag on before importing
         the app so factories can impersonate users without a full
         login per request. Production + dev both leave the flag off,
         so anyone crafting an X-User-Id header in those envs gets
         the same 401 as anyone else.

    The "session cookie present but failed" case deliberately does
    NOT fall back — otherwise logout wouldn't actually log anyone out
    while a test harness had the flag on.

    Raises 401 when neither path yields a user.
    """
    current = _user_from_session_cookie(db, session_cookie)
    if (
        current is None
        and session_cookie is None
        and settings.DEV_HEADER_AUTH_ENABLED
    ):
        current = _user_from_header(db, x_user_id)

    if current is None:
        raise HTTPException(
            status_code=401, detail="Not authenticated"
        )
    return current


def get_current_user_optional(
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> CurrentUser | None:
    """Return the current user if resolvable, else None. No 401.

    Used by endpoints that behave differently for authenticated vs
    anonymous callers (the public ownership-request detail view, for
    example).

    Same header-fallback guard as ``get_current_user``: gated on the
    test-only ``DEV_HEADER_AUTH_ENABLED`` flag and suppressed when a
    session cookie was presented (so a revoked session doesn't
    silently re-auth).
    """
    current = _user_from_session_cookie(db, session_cookie)
    if (
        current is None
        and session_cookie is None
        and settings.DEV_HEADER_AUTH_ENABLED
    ):
        current = _user_from_header(db, x_user_id)
    return current


def require_roles(*allowed: UserRole):
    def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return _dep