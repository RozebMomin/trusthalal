from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email import EmailError, send_email
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.modules.admin.users.schemas import UserAdminCreate, UserAdminPatch
from app.modules.auth.invite_repo import (
    DEFAULT_PURPOSE_INVITE,
    mint_invite,
)
from app.modules.auth.models import InviteToken
from app.modules.users.enums import UserAccountState, UserRole
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
class UserWithAccountState:
    """User + derived onboarding state, ready to drop into the
    ``UserAdminRead`` response shape.

    The repo's list / get helpers return this so the router doesn't
    have to re-query for invite metadata or re-compute the state
    machine. ``invite_expires_at`` is non-None exactly when
    ``account_state == INVITE_PENDING``.
    """

    user: User
    account_state: UserAccountState
    invite_expires_at: datetime | None


def _compute_account_state(
    user: User, live_invite_expires_at: datetime | None
) -> UserAccountState:
    """Map ``(password_hash, is_active, live_invite_expires_at)`` →
    ``UserAccountState``. Pure function; no DB.

    State machine:
      * has password + active                 → ACTIVE
      * has password + deactivated            → DEACTIVATED
      * no password + live invite             → INVITE_PENDING
      * no password + no live invite          → INVITE_EXPIRED
    """
    if user.password_hash is not None:
        return (
            UserAccountState.ACTIVE
            if user.is_active
            else UserAccountState.DEACTIVATED
        )
    if live_invite_expires_at is not None:
        return UserAccountState.INVITE_PENDING
    return UserAccountState.INVITE_EXPIRED


def _live_invite_expires_at_for(
    db: Session, user_id: UUID
) -> datetime | None:
    """Return the expiry of the user's MOST RECENT live invite, or
    None when no live invite exists.

    "Live" means: not consumed, not yet expired, purpose=INVITE. Same
    definition the resolve / consume path uses, so the displayed
    state matches what would happen if the recipient clicked the
    link right now.
    """
    row = db.execute(
        select(func.max(InviteToken.expires_at)).where(
            InviteToken.user_id == user_id,
            InviteToken.purpose == DEFAULT_PURPOSE_INVITE,
            InviteToken.consumed_at.is_(None),
            InviteToken.expires_at > func.now(),
        )
    ).scalar_one_or_none()
    return row


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
) -> list[UserWithAccountState]:
    """List users decorated with computed ``account_state``.

    Joins against a per-user subquery for the max live-invite
    expiry — the listing renders the same state machine the
    detail page uses, so any user-row chip pinned to
    ``account_state`` lines up across pages.

    The subquery is filtered to live tokens only (consumed_at IS
    NULL AND expires_at > now()); an old expired invite that
    happens to still sit in the table doesn't bump the user out of
    INVITE_EXPIRED.
    """
    live_invite_subq = (
        select(
            InviteToken.user_id.label("user_id"),
            func.max(InviteToken.expires_at).label("expires_at"),
        )
        .where(
            InviteToken.purpose == DEFAULT_PURPOSE_INVITE,
            InviteToken.consumed_at.is_(None),
            InviteToken.expires_at > func.now(),
        )
        .group_by(InviteToken.user_id)
        .subquery()
    )

    stmt = select(User, live_invite_subq.c.expires_at).outerjoin(
        live_invite_subq, live_invite_subq.c.user_id == User.id
    )
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

    out: list[UserWithAccountState] = []
    for user, invite_expires_at in db.execute(stmt).all():
        out.append(
            UserWithAccountState(
                user=user,
                account_state=_compute_account_state(
                    user, invite_expires_at
                ),
                invite_expires_at=invite_expires_at,
            )
        )
    return out


def admin_get_user(db: Session, user_id: UUID) -> UserWithAccountState:
    """Single-user lookup with the same state decoration as the
    list endpoint. Raises ``NotFoundError`` when the user doesn't
    exist.
    """
    user = db.execute(
        select(User).where(User.id == user_id)
    ).scalar_one_or_none()
    if not user:
        raise NotFoundError("USER_NOT_FOUND", "User not found")
    invite_expires_at = _live_invite_expires_at_for(db, user.id)
    return UserWithAccountState(
        user=user,
        account_state=_compute_account_state(user, invite_expires_at),
        invite_expires_at=invite_expires_at,
    )


@dataclass(frozen=True)
class ResentInvite:
    """Result of ``admin_resend_invite`` — same fields as the
    ``invite_*`` part of ``admin_create_user``'s response so the
    admin UI can reuse its "copy invite URL" widget for both
    paths.
    """

    invite_token: str
    invite_url: str
    invite_expires_at: datetime


def admin_resend_invite(
    db: Session,
    *,
    user_id: UUID,
    actor_user_id: UUID | None = None,
) -> ResentInvite:
    """Mint a fresh invite for an existing user and trigger the
    invite email.

    Gates:
      * Target must exist — 404 otherwise.
      * Target must be active. Deactivated accounts shouldn't get
        fresh invites; reactivate first.
      * Target must not have a password set. Re-inviting a fully-
        onboarded user implies a "reset password" flow, which is
        deliberately a different surface (different email copy,
        different security posture).

    The mint side is identical to ``admin_create_user``'s code path
    — ``mint_invite`` revokes any prior live invite for the same
    user+purpose before inserting the new one, so a re-invite
    always supersedes whatever's outstanding.

    Email send is best-effort: a Resend outage doesn't break the
    admin's "resend invite" action; the response still carries the
    invite_url the admin can hand-deliver.
    """
    user = db.execute(
        select(User).where(User.id == user_id)
    ).scalar_one_or_none()
    if not user:
        raise NotFoundError("USER_NOT_FOUND", "User not found")

    if user.password_hash is not None:
        raise ConflictError(
            "USER_ALREADY_ONBOARDED",
            "This user has already set a password. Use the "
            "password-reset flow instead of re-inviting.",
        )
    if not user.is_active:
        raise ConflictError(
            "USER_INACTIVE",
            "Reactivate the user before re-inviting them.",
        )

    invite_row, plaintext = mint_invite(
        db,
        user_id=user.id,
        created_by_user_id=actor_user_id,
    )
    db.commit()
    db.refresh(invite_row)

    invite_url = _build_invite_url(plaintext)

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
            "Resend-invite email failed (admin can copy invite_url "
            "from the response): %s",
            exc,
            extra={"user_id": str(user.id), "email": user.email},
        )

    return ResentInvite(
        invite_token=plaintext,
        invite_url=invite_url,
        invite_expires_at=invite_row.expires_at,
    )


def admin_patch_user(
    db: Session,
    *,
    user_id: UUID,
    patch: UserAdminPatch,
    actor_user_id: UUID | None = None,
) -> UserWithAccountState:
    """Apply a partial update to a user.

    Returns the user re-decorated with ``account_state`` so the router
    can hand back the same shape as the list/get endpoints — letting
    the admin UI re-render the row's state pill from the PATCH
    response without a follow-up GET.

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
    user = db.execute(
        select(User).where(User.id == user_id)
    ).scalar_one_or_none()
    if not user:
        raise NotFoundError("USER_NOT_FOUND", "User not found")

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

    invite_expires_at = _live_invite_expires_at_for(db, user.id)
    return UserWithAccountState(
        user=user,
        account_state=_compute_account_state(user, invite_expires_at),
        invite_expires_at=invite_expires_at,
    )
