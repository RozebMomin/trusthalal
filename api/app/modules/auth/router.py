from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.auth import CurrentUser, get_current_user
from app.core.config import settings
from app.core.exceptions import BadRequestError, ConflictError, UnauthorizedError
from app.core.password_hashing import hash_password, verify_password
from app.core.rate_limit import ip_key, limiter
from app.db.deps import get_db
from app.modules.auth.invite_repo import (
    consume_invite,
    resolve_invite,
)
from app.modules.auth.repo import (
    create_session,
    revoke_all_sessions_for_user,
    revoke_session,
)
from app.modules.auth.schemas import (
    InviteInfoResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    SetPasswordRequest,
    SetPasswordResponse,
    SignupRequest,
    SignupResponse,
)
from app.modules.users.enums import UserRole
from app.modules.users.models import User


# ---------------------------------------------------------------------------
# Session cookie config
# ---------------------------------------------------------------------------
# Cookie name is namespaced so it doesn't collide with anything else on
# the domain (e.g. if the same browser is logged into a dev tool on
# localhost that also sets a "session" cookie).
SESSION_COOKIE_NAME = "tht_session"

# 30 days matches the server-side session TTL (see repo.DEFAULT_SESSION_TTL).
# Browsers will let the cookie expire locally slightly ahead of the
# server's view because of clock skew, which is fine — a "cookie gone"
# response simply redirects to /login, the same as a revoked session.
_SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60


def _redirect_path_for(role: UserRole) -> str:
    """Where the client should land after a successful login.

    Keeping this server-side means the admin panel, a future owner
    dashboard, and any mobile client share one notion of "where does
    an OWNER belong?" — add a new role here, every client picks up
    the right redirect without a release dance.
    """
    if role == UserRole.ADMIN:
        return "/places"
    if role == UserRole.VERIFIER:
        # Verifiers spend most of their time on the halal-claim
        # review queue (/halal-claims). The admin panel
        # ``PANEL_HOME_FOR_ROLE`` agrees, so a verifier login lands
        # them on the same page either way.
        return "/halal-claims"
    if role == UserRole.OWNER:
        # The owner portal lives at its own origin (owner.trusthalal.org)
        # and treats "/" as the home — same routing whether the user
        # just signed up, just logged in, or completed a set-password
        # flow.
        return "/"
    return "/"


def _set_session_cookie(response: Response, session_id: UUID) -> None:
    """Attach the session cookie with safe defaults.

    * HttpOnly — JS can't read it, so XSS can't exfil the cookie.
    * Secure — only sent over HTTPS in non-local envs. We relax this in
      ENV=local so dev-over-http works.
    * SameSite=Lax — sent on top-level navigations so login-then-link
      works, but blocked on cross-site POST (mitigates CSRF without a
      dedicated token).
    """
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=str(session_id),
        max_age=_SESSION_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.ENV != "local",
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

me_router = APIRouter(prefix="/me", tags=["auth"])


@me_router.get(
    "",
    response_model=MeResponse,
    summary="Current authenticated user",
    description=(
        "Resolves the session cookie to the user's id, role, display "
        "name, and email. Frontends call this on every page load to "
        "decide what to render — it's the source of truth for 'am I "
        "signed in?' and 'what role am I?'."
    ),
)
def get_me(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeResponse:
    """Who the cookie says you are.

    Returns id + role + display_name + email so frontends can render
    "Signed in as <name>" without a second roundtrip. We pull
    display_name + email from the User row rather than caching them
    on ``CurrentUser`` — keeps the auth context dataclass slim and
    means a profile rename takes effect on the next /me call instead
    of after a re-login.

    The session→user resolution already happened in
    ``get_current_user``; if the row is gone by the time we look it
    up here (rare, but possible if admin hard-deleted between
    middleware and handler), surface a 401 so the client clears the
    cookie and redirects to /login rather than seeing a 500.
    """
    user_row = db.get(User, user.id)
    if user_row is None:
        raise UnauthorizedError(
            "INVALID_CREDENTIALS",
            "Your session is no longer valid. Please sign in again.",
        )
    return MeResponse(
        id=user_row.id,
        role=UserRole(user_row.role),
        display_name=user_row.display_name,
        email=user_row.email,
    )


auth_router = APIRouter(prefix="/auth", tags=["auth"])


@auth_router.post(
    "/login",
    response_model=LoginResponse,
    summary="Sign in with email and password",
    description=(
        "Sets the `tht_session` HttpOnly cookie on success. Returns the "
        "user id, role, display name, and a `redirect_path` (server-"
        "controlled landing page per role). Failures collapse to a "
        "single generic `INVALID_CREDENTIALS` 401 to avoid email "
        "enumeration. Rate-limited per-IP at 10/min and 100/hour."
    ),
)
@limiter.limit("10/minute", key_func=ip_key)
@limiter.limit("100/hour", key_func=ip_key)
def login(
    request: Request,
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """Email + password login. Sets the session cookie on success.

    Security notes:
      * Single generic error ("Invalid email or password") on any
        failure path — no user enumeration. The ``UnauthorizedError``
        wrapper keeps the error code stable for client-side branching
        without leaking which of email/password/active/has-password
        failed.
      * Password verification runs even when the user isn't found, to
        keep timing roughly similar. We do this with a dummy hash that
        matches the cost of a real one.
    """
    normalized_email = payload.email.strip().lower()
    user = db.execute(
        select(User).where(func.lower(User.email) == normalized_email)
    ).scalar_one_or_none()

    # Verify password against either the real hash or a dummy string of
    # similar cost, so the response time doesn't leak "this email
    # exists / doesn't." Dummy is a known-valid argon2 hash of the
    # string "dummy" — we never actually compare against the dummy
    # result, this is just to keep the clock honest.
    hash_to_check = (
        user.password_hash
        if (user and user.password_hash)
        else _DUMMY_HASH
    )
    password_ok = verify_password(payload.password, hash_to_check)

    # Order of the guard matters: do the generic reject before any
    # state-specific code path so the failure mode doesn't reveal
    # internals. ``is_active`` checked last so password-ok but
    # deactivated users hit the same generic error.
    if not user or not user.password_hash or not password_ok or not user.is_active:
        raise UnauthorizedError(
            "INVALID_CREDENTIALS",
            "Invalid email or password.",
        )

    session = create_session(db, user_id=user.id)
    _set_session_cookie(response, session.id)

    role = UserRole(user.role)
    return LoginResponse(
        user_id=user.id,
        email=user.email,
        role=role,
        display_name=user.display_name,
        redirect_path=_redirect_path_for(role),
    )


@auth_router.post(
    "/signup",
    response_model=SignupResponse,
    summary="Self-service signup (role hard-coded to OWNER)",
    description=(
        "Public path used by the owner portal. Creates a User with "
        "role=OWNER and immediately sets the session cookie so the "
        "client can land on the post-login home with no second round "
        "trip. On a duplicate email returns `EMAIL_TAKEN` so the UI "
        "can deep-link to /login. Promotion to ADMIN/VERIFIER stays an "
        "admin-only operation. Rate-limited per-IP at 5/min, 20/hour."
    ),
)
@limiter.limit("5/minute", key_func=ip_key)
@limiter.limit("20/hour", key_func=ip_key)
def signup(
    request: Request,
    payload: SignupRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> SignupResponse:
    """Self-service signup for restaurant owners.

    Trust Halal staff don't mint OWNER accounts by hand — owners create
    their own login and then submit ownership claims, which staff
    review. The trust gate is the human-reviewed claim downstream, not
    the signup itself, so this endpoint is intentionally light:

      * No email verification (deliberate; revisit if abuse warrants it).
      * Role is hard-coded to OWNER. Promotion to ADMIN/VERIFIER stays
        an admin-only operation via the user CRUD endpoints.
      * Email is normalized (trim + lower) before the uniqueness check
        and persisted in the original casing — same posture as login,
        which compares case-insensitively.

    On collision we surface ``EMAIL_TAKEN`` rather than a generic 4xx
    so the client can show a useful "this email is already registered,
    sign in instead?" message. That's a small enumeration tradeoff —
    an attacker can probe email addresses — but the mitigation cost
    (forcing a verify-by-email flow) outweighs the marginal disclosure
    here. Login itself remains a black box.
    """
    normalized_email = payload.email.strip().lower()

    existing = db.execute(
        select(User).where(func.lower(User.email) == normalized_email)
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(
            "EMAIL_TAKEN",
            "An account with that email already exists. Try signing in instead.",
        )

    display_name = payload.display_name.strip()

    user = User(
        email=payload.email.strip(),
        display_name=display_name,
        password_hash=hash_password(payload.password),
        role=UserRole.OWNER.value,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Auto-login: same cookie shape as /auth/login's happy path so the
    # client can treat the response identically.
    session = create_session(db, user_id=user.id)
    _set_session_cookie(response, session.id)

    role = UserRole(user.role)
    return SignupResponse(
        user_id=user.id,
        email=user.email,
        role=role,
        display_name=user.display_name,
        redirect_path=_redirect_path_for(role),
    )


@auth_router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Invalidate the current session and clear the cookie",
    description=(
        "Idempotent — returns 204 even if the session was already "
        "revoked or the cookie is missing. The browser drops the "
        "cookie either way, so surfacing failures here would only "
        "confuse 'sign out' UX."
    ),
)
@limiter.limit("30/minute", key_func=ip_key)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> None:
    """Invalidate the current session + clear the cookie.

    Idempotent: no cookie / malformed cookie / already-revoked session
    all 204 cleanly. The client is losing the cookie either way, so
    surfacing errors would only confuse "sign out" UX.
    """
    if session_cookie:
        try:
            session_id = UUID(session_cookie)
            revoke_session(db, session_id=session_id)
        except (ValueError, Exception):
            # Malformed cookie shouldn't block logout — we still want
            # the browser to drop it.
            pass

    _clear_session_cookie(response)
    return None


@auth_router.get(
    "/invite/{token}",
    response_model=InviteInfoResponse,
    summary="Look up an invite token's target email",
    description=(
        "Pre-fetched by the admin panel's set-password page so the "
        "form can render 'Set your password for foo@example.com' "
        "before the user submits. Does NOT consume the token — that "
        "happens in `POST /auth/set-password`. Invalid / expired / "
        "already-used tokens all collapse to a single generic "
        "`INVITE_INVALID` to avoid token-state oracling."
    ),
)
@limiter.limit("30/minute", key_func=ip_key)
def get_invite_info(
    request: Request,
    token: str,
    db: Session = Depends(get_db),
) -> InviteInfoResponse:
    """Prefetch an invite so the set-password page can show context.

    Returns the invited user's email + display_name so the UI can
    render "Set your password for rozebm@example.com" before the
    user submits. Does NOT consume the token — that happens in
    ``POST /auth/set-password``.

    Failure modes all land on the same generic 400 to avoid becoming
    an oracle: invalid, expired, and already-consumed tokens are
    indistinguishable from the outside. The client just sees
    INVITE_INVALID and tells the user the link needs replacing.
    """
    invite = resolve_invite(db, token_plain=token)
    if invite is None:
        raise BadRequestError(
            "INVITE_INVALID",
            "This invite link is invalid, expired, or already used."
            " Ask an admin to send you a fresh one.",
        )

    user = db.execute(
        select(User).where(User.id == invite.user_id)
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        # FK is CASCADE on the token side, so a missing user here
        # means the row was deleted between mint and fetch (rare).
        # An inactive user shouldn't complete an invite either —
        # admin already revoked them.
        raise BadRequestError(
            "INVITE_INVALID",
            "This invite link is invalid, expired, or already used."
            " Ask an admin to send you a fresh one.",
        )

    return InviteInfoResponse(
        email=user.email,
        display_name=user.display_name,
    )


@auth_router.post(
    "/set-password",
    response_model=SetPasswordResponse,
    summary="Burn an invite token, set the user's password, sign them in",
    description=(
        "Single transaction: resolves the invite token, hashes the new "
        "password with argon2id, marks the token consumed, revokes any "
        "other outstanding sessions for this user, and mints a fresh "
        "session cookie. Used by the admin onboarding flow and as the "
        "'reset password' path (admin re-issues an invite). Rate-"
        "limited per-IP."
    ),
)
@limiter.limit("10/minute", key_func=ip_key)
@limiter.limit("50/hour", key_func=ip_key)
def set_password_with_invite(
    request: Request,
    payload: SetPasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> SetPasswordResponse:
    """Burn an invite token + set the user's password + sign them in.

    Single transaction:
      1. Resolve the token (same generic failure surface as
         ``get_invite_info``).
      2. Hash the new password with argon2id and set it on the user.
      3. Mark the token consumed.
      4. Revoke every other outstanding session for this user (covers
         the "re-invite after lost password" case: any live sessions
         for the old password are kicked out — the user only wants
         the freshly-made one).
      5. Create a new session + set the cookie.

    Anyone who has a valid invite can set the password, by design —
    that's the whole point. We don't require re-auth with the old
    password because in the invite flow there may be no old password
    at all.
    """
    invite = resolve_invite(db, token_plain=payload.token)
    if invite is None:
        raise BadRequestError(
            "INVITE_INVALID",
            "This invite link is invalid, expired, or already used."
            " Ask an admin to send you a fresh one.",
        )

    user = db.execute(
        select(User).where(User.id == invite.user_id)
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise BadRequestError(
            "INVITE_INVALID",
            "This invite link is invalid, expired, or already used."
            " Ask an admin to send you a fresh one.",
        )

    # Hash + persist the password.
    user.password_hash = hash_password(payload.password)
    db.add(user)

    # Burn the token before committing so the whole thing rolls back
    # together if anything downstream throws.
    consume_invite(db, token=invite)

    # Kick anyone else who may be in as this user — relevant on the
    # "I forgot my password, admin issued a new invite" path where
    # the admin had to deactivate and reactivate. Cheap insurance.
    revoke_all_sessions_for_user(db, user_id=user.id)

    db.commit()
    db.refresh(user)

    # Auto-login: same cookie shape as /auth/login's happy path.
    session = create_session(db, user_id=user.id)
    _set_session_cookie(response, session.id)

    role = UserRole(user.role)
    return SetPasswordResponse(
        user_id=user.id,
        email=user.email,
        role=role,
        display_name=user.display_name,
        redirect_path=_redirect_path_for(role),
    )


# ``/auth/dev-login`` lived here previously — a shortcut that looked
# up a user by email and returned their id so callers could set
# ``X-User-Id`` on subsequent requests. With real auth in place and the
# header fallback gated behind ``DEV_HEADER_AUTH_ENABLED`` (off outside
# tests), the shortcut was both unused and a sharp edge — anyone who
# flipped that flag back on in production could impersonate anyone.
# Removed entirely rather than kept-behind-another-flag to reduce blast
# radius. Password-based login covers the "let me sign in as a seed
# user" workflow (set their password once with
# ``hash_password`` + UPDATE, then sign in normally).


# Pre-computed argon2 hash of an arbitrary dummy string. Used in the
# login flow to make timing similar between "user doesn't exist" and
# "user exists but password wrong." Never compared against anything the
# user types — we just run ``verify_password`` to consume CPU.
_DUMMY_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=2$"
    "AAAAAAAAAAAAAAAAAAAAAA$"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
)


# Backwards compatibility: main.py imports `router` from this module and mounts
# it. Re-export `me_router` as `router` and add `/auth` routes alongside.
router = APIRouter()
router.include_router(me_router)
router.include_router(auth_router)
