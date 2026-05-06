"""Integration tests for the invite / set-password flow.

Covers:
  * POST /admin/users returns the expected invite shape (token, URL,
    expiry).
  * Invite URL is consumable via GET /auth/invite/{token} without
    burning it.
  * POST /auth/set-password burns the token, sets the password hash,
    and auto-logs the user in via a session cookie.
  * Re-using a consumed token rejects.
  * Expired tokens reject.
  * Invalid tokens reject with the same generic error (no oracle).
  * Re-inviting the same user hard-invalidates the old token.
  * Setting a password for a user who already had one still works
    (we explicitly allow this as a admin-issued recovery path until
    proper password-reset ships).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.password_hashing import verify_password
from app.modules.auth.invite_repo import _hash_token, mint_invite
from app.modules.auth.models import InviteToken
from app.modules.users.models import User


# ---------------------------------------------------------------------------
# Admin create: invite token surfaced in response
# ---------------------------------------------------------------------------
def test_admin_create_user_returns_invite_token_and_url(api, factories):
    """POST /admin/users returns a plaintext token + pre-baked URL.

    Verifies the response contract the admin panel relies on: the
    token is visible here and only here; the URL already points at
    the set-password page with the token as a query arg.
    """
    admin = factories.admin()

    resp = api.as_user(admin).post(
        "/admin/users",
        json={
            "email": "newhire@example.com",
            "role": "VERIFIER",
            "display_name": "New Hire",
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    # Base user fields still present — we didn't break backward compat.
    assert body["email"] == "newhire@example.com"
    assert body["role"] == "VERIFIER"
    assert body["display_name"] == "New Hire"
    assert body["is_active"] is True
    # Invite fields: token is non-empty opaque string, URL embeds it.
    assert isinstance(body["invite_token"], str)
    assert len(body["invite_token"]) >= 16
    assert body["invite_token"] in body["invite_url"]
    assert "/set-password?token=" in body["invite_url"]
    # Expiry is in the future (about 7 days by default).
    exp = datetime.fromisoformat(body["invite_expires_at"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    delta = exp - now
    assert timedelta(days=6) < delta < timedelta(days=8)


def test_admin_create_user_stores_token_hashed(api, factories, db_session):
    """DB holds only the sha256 hash — plaintext is never persisted."""
    admin = factories.admin()
    resp = api.as_user(admin).post(
        "/admin/users",
        json={"email": "hash-check@example.com", "role": "VERIFIER"},
    )
    assert resp.status_code == 201
    plaintext = resp.json()["invite_token"]

    # Look up the row by the hashed value — confirms the hash matches
    # our repo's hashing function AND that the plaintext itself isn't
    # on disk anywhere in this table.
    row = db_session.execute(
        select(InviteToken).where(InviteToken.token_hash == _hash_token(plaintext))
    ).scalar_one_or_none()
    assert row is not None
    # Defensive: make sure the plaintext never landed in any column.
    assert row.token_hash != plaintext

    # created_by_user_id is populated from the actor so the audit
    # trail remembers which admin minted this invite.
    assert row.created_by_user_id == admin.id


def test_admin_create_user_created_without_password_hash(api, factories, db_session):
    """Invited users start with password_hash=NULL.

    This is the whole point of the flow: the user completes onboarding
    by setting a password via the token, not by an admin running
    ``UPDATE users SET password_hash = ...``.
    """
    admin = factories.admin()
    resp = api.as_user(admin).post(
        "/admin/users",
        json={"email": "nopass@example.com", "role": "CONSUMER"},
    )
    assert resp.status_code == 201

    user_id = resp.json()["id"]
    user = db_session.execute(
        select(User).where(User.id == user_id)
    ).scalar_one()
    assert user.password_hash is None


# ---------------------------------------------------------------------------
# GET /auth/invite/{token}: prefetch
# ---------------------------------------------------------------------------
def test_get_invite_info_returns_email_without_consuming_token(
    api, factories, db_session
):
    """The landing page uses this to show "Set password for X@Y" — it
    must NOT burn the token, otherwise the user's POST would 400."""
    admin = factories.admin()
    create = api.as_user(admin).post(
        "/admin/users",
        json={
            "email": "prefetch@example.com",
            "role": "OWNER",
            "display_name": "Pre Fetch",
        },
    )
    token = create.json()["invite_token"]

    info = api.get(f"/auth/invite/{token}")
    assert info.status_code == 200, info.text
    body = info.json()
    assert body["email"] == "prefetch@example.com"
    assert body["display_name"] == "Pre Fetch"

    # Token is still unconsumed in the DB.
    row = db_session.execute(
        select(InviteToken).where(InviteToken.token_hash == _hash_token(token))
    ).scalar_one()
    assert row.consumed_at is None


def test_get_invite_info_rejects_invalid_token(api):
    """Garbage token → generic INVITE_INVALID, no discrimination."""
    resp = api.get("/auth/invite/not-a-real-token")
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "INVITE_INVALID"


# ---------------------------------------------------------------------------
# POST /auth/set-password: happy path + lockdown cases
# ---------------------------------------------------------------------------
def test_set_password_consumes_token_and_logs_user_in(
    api, factories, db_session
):
    """The happy path: a valid token + a new password → 200 with a
    session cookie set, token marked consumed, password_hash populated.
    """
    admin = factories.admin()
    create = api.as_user(admin).post(
        "/admin/users",
        json={"email": "happy@example.com", "role": "VERIFIER"},
    )
    token = create.json()["invite_token"]
    user_id = create.json()["id"]

    resp = api.post(
        "/auth/set-password",
        json={"token": token, "password": "s3cure-passphrase"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user_id"] == user_id
    assert body["email"] == "happy@example.com"
    assert body["role"] == "VERIFIER"
    # VERIFIER lands on /halal-claims per _redirect_path_for.
    assert body["redirect_path"] == "/halal-claims"

    # Session cookie set so the browser is already logged in.
    assert "tht_session" in resp.cookies

    # DB state: token burned, password populated.
    token_row = db_session.execute(
        select(InviteToken).where(InviteToken.token_hash == _hash_token(token))
    ).scalar_one()
    assert token_row.consumed_at is not None

    user = db_session.execute(
        select(User).where(User.id == user_id)
    ).scalar_one()
    assert user.password_hash is not None
    assert verify_password("s3cure-passphrase", user.password_hash)


def test_set_password_reuse_rejects(api, factories):
    """A consumed token can't be replayed — second call 400s."""
    admin = factories.admin()
    create = api.as_user(admin).post(
        "/admin/users",
        json={"email": "replay@example.com", "role": "CONSUMER"},
    )
    token = create.json()["invite_token"]

    first = api.post(
        "/auth/set-password",
        json={"token": token, "password": "first-password-123"},
    )
    assert first.status_code == 200, first.text

    second = api.post(
        "/auth/set-password",
        json={"token": token, "password": "second-password-123"},
    )
    assert second.status_code == 400, second.text
    assert second.json()["error"]["code"] == "INVITE_INVALID"


def test_set_password_expired_token_rejects(api, factories, db_session):
    """An expired token is indistinguishable from invalid/consumed —
    same generic 400. Simulated by backdating ``expires_at``.
    """
    user = factories.user(email="expired@example.com", is_active=True)
    # Mint a token directly so we can tamper with expiry without
    # going through the HTTP path.
    row, plaintext = mint_invite(
        db_session, user_id=user.id, created_by_user_id=None
    )
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.add(row)
    db_session.commit()

    resp = api.post(
        "/auth/set-password",
        json={"token": plaintext, "password": "somepassword"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "INVITE_INVALID"


def test_set_password_invalid_token_rejects(api):
    """Plainly wrong token → generic 400 (no enumeration)."""
    resp = api.post(
        "/auth/set-password",
        json={
            "token": "definitely-not-a-valid-token-string-abcdef",
            "password": "anythingreally",
        },
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "INVITE_INVALID"


def test_set_password_too_short_is_validation_error(api, factories):
    """Password min length is enforced at the Pydantic layer, not the
    repo — short passwords 422 with the standard VALIDATION_ERROR
    envelope."""
    admin = factories.admin()
    create = api.as_user(admin).post(
        "/admin/users",
        json={"email": "shortpass@example.com", "role": "CONSUMER"},
    )
    token = create.json()["invite_token"]

    resp = api.post(
        "/auth/set-password",
        json={"token": token, "password": "short"},  # 5 chars
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# Re-invite: minting a new invite replaces the old one
# ---------------------------------------------------------------------------
def test_re_invite_invalidates_previous_token(api, factories, db_session):
    """If an admin invites the same email twice (after the first
    person lost the link), the OLD token must stop working. Otherwise
    we have two live links floating around for the same account —
    annoying at best, exploitable at worst if the first link was
    leaked."""
    admin = factories.admin()

    first = api.as_user(admin).post(
        "/admin/users",
        json={"email": "re-invite@example.com", "role": "CONSUMER"},
    )
    assert first.status_code == 201
    first_token = first.json()["invite_token"]

    # First invite worked: sanity check the prefetch.
    assert api.get(f"/auth/invite/{first_token}").status_code == 200

    # Second invite (in the prod flow this would be a dedicated
    # re-invite endpoint — here we piggyback on the create path by
    # hand-editing the email conflict out of the way). For the test,
    # easier to hit the create path directly by deleting the user
    # row is overkill — instead mint a replacement manually via the
    # repo to simulate a hypothetical re-invite endpoint.
    user_id = first.json()["id"]
    _row, second_token = mint_invite(
        db_session, user_id=user_id, created_by_user_id=admin.id
    )
    db_session.commit()

    # Old token now 400s.
    old = api.get(f"/auth/invite/{first_token}")
    assert old.status_code == 400
    assert old.json()["error"]["code"] == "INVITE_INVALID"

    # New token works.
    new = api.get(f"/auth/invite/{second_token}")
    assert new.status_code == 200


# ---------------------------------------------------------------------------
# Re-setting a password for an existing user
# ---------------------------------------------------------------------------
def test_set_password_overwrites_existing_hash(api, factories, db_session):
    """A user who already has a password can still complete an invite
    — the new hash replaces the old one. This is deliberate: it gives
    admins a recovery path ("I forgot my password, please re-invite
    me") until proper password-reset self-service ships.

    All existing sessions for the user are revoked as part of the
    flow, so a compromised-session scenario also gets a clean slate.
    """
    from app.modules.auth.repo import create_session

    user = factories.user(email="preexisting@example.com", is_active=True)
    from app.core.password_hashing import hash_password
    user.password_hash = hash_password("old-password-123")
    db_session.add(user)
    db_session.commit()

    # Stand up a live session for the user — we assert it gets
    # revoked by the set-password path.
    live_session = create_session(db_session, user_id=user.id)
    live_session_id = live_session.id

    _row, token = mint_invite(
        db_session, user_id=user.id, created_by_user_id=None
    )
    db_session.commit()

    resp = api.post(
        "/auth/set-password",
        json={"token": token, "password": "new-password-123"},
    )
    assert resp.status_code == 200, resp.text

    db_session.refresh(user)
    assert verify_password("new-password-123", user.password_hash)
    assert not verify_password("old-password-123", user.password_hash)

    # Prior session is revoked.
    from app.modules.auth.models import Session as AuthSession
    old = db_session.execute(
        select(AuthSession).where(AuthSession.id == live_session_id)
    ).scalar_one()
    assert old.revoked_at is not None
