from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import logging

from app.core.config import settings
from app.core.email import EmailError, send_email
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.modules.admin.users.schemas import UserAdminCreate, UserAdminPatch
from app.modules.auth.invite_repo import mint_invite
from app.modules.users.enums import UserRole
from app.modules.users.models import User


logger = logging.getLogger(__name__)


# Human-readable role copy for the invite email body. Falls back to
# the enum value when a new role lands without a mapped string.
_ROLE_LABELS: dict[UserRole, str] = {
    UserRole.ADMIN: "Trust Halal admin",
    UserRole.VERIFIER: "verifier",
    UserRole.OWNER: "restaurant owner",
    UserRole.CONSUMER: "consumer",
}


@dataclass(frozen=True)
class CreatedUserWithInvite:
    """Result of ``admin_create_user``.

    Bundles the freshly-created ``User`` row with the plaintext invite
    token, pre-baked set-password URL, and expiry timestamp. The router
    flattens these into the HTTP response.
    """

    user: User
    invite_token: str
    invite_url: str
    invite_expires_at: datetime


def _build_invite_url(token_plain: str) -> str:
    """Compose the admin panel's set-password URL for an invite token.

    Kept in one place so env overrides (``ADMIN_PANEL_ORIGIN``) flow
    through a single formatter and the UI doesn't have to redo the
    URL composition.
    """
    origin = settings.ADMIN_PANEL_ORIGIN.rstrip("/")
    query = urlencode({"token": token_plain})
    return f"{origin}/set-password?{query}"


def admin_create_user(
    db: Session,
    payload: UserAdminCreate,
    *,
    actor_user_id: UUID | None = None,
) -> CreatedUserWithInvite:
    """Create a user and mint a single-use invite token for them.

    The new user has no password_hash — they complete onboarding by
    visiting the returned ``invite_url`` and setting one via
    ``POST /auth/set-password``, which burns the token and auto-logs
    them in.

    ``actor_user_id`` is forwarded to ``invite_tokens.created_by_user_id``
    so the audit trail carries "which admin minted this invite." Kept
    optional so seed scripts and tests that don't have a real actor
    can still call the function.
    """
    normalized_email = payload.email.strip().lower()

    existing = db.execute(
        select(User.id).where(func.lower(User.email) == normalized_email)
    ).scalar_one_or_none()
    if existing:
        raise ConflictError("USER_EMAIL_TAKEN", "A user with that email already exists")

    user = User(
        email=normalized_email,
        role=payload.role.value,
        display_name=payload.display_name,
        is_active=True,
    )
    db.add(user)
    # Flush (not commit) so user.id is available for the invite FK
    # while keeping both inserts in one transaction. Any failure in
    # mint_invite rolls back the user row too.
    db.flush()

    invite_row, plaintext = mint_invite(
        db,
        user_id=user.id,
        created_by_user_id=actor_user_id,
    )

    db.commit()
    db.refresh(user)
    db.refresh(invite_row)

    invite_url = _build_invite_url(plaintext)

    # Fire the invite email best-effort: a transactional-email
    # outage shouldn't break the admin's "create user" workflow.
    # The endpoint still returns the invite_url so the admin can
    # copy + paste manually if the inbox didn't get it. Resend
    # delivery failures land in the API logs (and Sentry) for
    # operator follow-up.
    try:
        send_email(
            to=user.email,
            subject="Set up your Trust Halal account",
            template="owner_invite_set_password",
            context={
                "preheader": (
                    "Your single-use sign-in link is inside — expires in "
                    f"{settings.INVITE_TOKEN_TTL_DAYS} day"
                    f"{'' if settings.INVITE_TOKEN_TTL_DAYS == 1 else 's'}."
                ),
                "display_name": user.display_name or "",
                "invite_url": invite_url,
                "role_label": _ROLE_LABELS.get(
                    UserRole(user.role), user.role.lower()
                ),
                "ttl_days": settings.INVITE_TOKEN_TTL_DAYS,
            },
        )
    except EmailError as exc:
        logger.warning(
            "Invite email failed to send (admin can copy invite_url "
            "from the response): %s",
            exc,
            extra={"user_id": str(user.id), "email": user.email},
        )

    return CreatedUserWithInvite(
        user=user,
        invite_token=plaintext,
        invite_url=invite_url,
        invite_expires_at=invite_row.expires_at,
    )


def admin_list_users(
    db: Session,
    *,
    role: UserRole | None = None,
    is_active: bool | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[User]:
    stmt = select(User)
    if role is not None:
        stmt = stmt.where(User.role == role.value)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            (func.lower(User.email).like(like))
            | (func.lower(func.coalesce(User.display_name, "")).like(like))
        )
    stmt = stmt.order_by(User.created_at.desc()).limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def admin_get_user(db: Session, user_id: UUID) -> User:
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user:
        raise NotFoundError("USER_NOT_FOUND", "User not found")
    return user


def admin_patch_user(
    db: Session,
    *,
    user_id: UUID,
    patch: UserAdminPatch,
    actor_user_id: UUID | None = None,
) -> User:
    """Apply a partial update to a user.

    Self-edit guard (when ``actor_user_id == user_id``):
      * Blocks role changes that would actually change the role. An
        admin demoting themselves to CONSUMER would lose admin access
        with no route back in, so the server refuses the request
        explicitly. Sending the SAME role (no-op) is allowed.
      * Blocks ``is_active=False`` on self for the same reason —
        deactivating yourself kills your own session on the next
        request via ``resolve_session``'s active-user filter.
      * ``display_name`` self-edits stay allowed. Nothing about a
        display-name change can lock the actor out.

    ``actor_user_id`` is optional so repo callers that aren't
    HTTP-originated (scripts, tests asserting raw behavior) don't have
    to thread it through. The router always passes it in.
    """
    user = admin_get_user(db, user_id)

    if actor_user_id is not None and actor_user_id == user.id:
        # Actor editing themselves. Gate the dangerous transitions.
        if patch.role is not None and patch.role.value != user.role:
            raise ForbiddenError(
                "SELF_ROLE_CHANGE_FORBIDDEN",
                "Admins can't change their own role. Ask another admin"
                " to do it if a role change is genuinely needed.",
            )
        if patch.is_active is not None and patch.is_active != user.is_active:
            # Only triggers on an actual flip — re-asserting the
            # current state is a no-op and allowed.
            raise ForbiddenError(
                "SELF_DEACTIVATION_FORBIDDEN",
                "Admins can't deactivate their own account. Ask another"
                " admin to do it if you really mean to.",
            )

    if patch.role is not None:
        user.role = patch.role.value
    if patch.display_name is not None:
        user.display_name = patch.display_name
    if patch.is_active is not None:
        user.is_active = patch.is_active

    db.add(user)
    db.commit()
    db.refresh(user)
    return user
