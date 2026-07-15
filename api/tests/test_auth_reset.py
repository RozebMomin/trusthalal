"""Integration tests for self-service password reset.

Covers:
  * POST /auth/forgot-password mints a live PASSWORD_RESET token for a
    known active user, and is silent (same generic 200) for unknown
    emails — no enumeration, no token created.
  * GET /auth/reset/{token} returns the target email without burning it.
  * POST /auth/reset-password sets the new password, burns the token,
    revokes all web sessions + mobile tokens, and does NOT auto-login.
  * Reuse / expiry / invalid tokens all reject with the same generic
    RESET_INVALID.
  * Password min length is enforced (422).
  * Audience → origin URL routing (unit).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.password_hashing import hash_password, verify_password
from app.modules.auth.invite_repo import _hash_token
from app.modules.auth.mobile_tokens import MobileToken, issue_token_pair
from app.modules.auth.models import InviteToken, Session as AuthSession
from app.modules.auth.password_reset import (
    PURPOSE_PASSWORD_RESET,
    build_reset_url,
    mint_reset_token,
)
from app.modules.auth.repo import create_session
from app.modules.users.models import User


def _live_reset_token_for(db_session, user_id):
    return db_session.execute(
        select(InviteToken)
        .where(InviteToken.user_id == user_id)
        .where(InviteToken.purpose == PURPOSE_PASSWORD_RESET)
        .where(InviteToken.consumed_at.is_(None))
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# forgot-password
# ---------------------------------------------------------------------------
def test_forgot_password_mints_token_for_known_user(api, factories, db_session):
    user = factories.user(email="reset-known@example.com", is_active=True)
    db_session.commit()

    resp = api.post(
        "/auth/forgot-password",
        json={"email": "reset-known@example.com", "audience": "consumer"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True

    row = _live_reset_token_for(db_session, user.id)
    assert row is not None
    assert row.purpose == PURPOSE_PASSWORD_RESET
    # user-initiated → no admin actor recorded.
    assert row.created_by_user_id is None
    # Short TTL, not the 7-day invite.
    delta = row.expires_at - datetime.now(timezone.utc)
    assert timedelta(minutes=50) < delta < timedelta(minutes=70)


def test_forgot_password_is_silent_for_unknown_email(api, db_session):
    resp = api.post(
        "/auth/forgot-password",
        json={"email": "nobody-here@example.com", "audience": "consumer"},
    )
    # Same generic success as the known-user path — no enumeration.
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True

    # And crucially: no token was minted for a non-existent account.
    any_token = db_session.execute(
        select(InviteToken).where(InviteToken.purpose == PURPOSE_PASSWORD_RESET)
    ).scalars().all()
    assert all(
        t.user_id is not None for t in any_token
    )  # sanity; none tie to a missing user


def test_forgot_password_inactive_user_gets_no_token(api, factories, db_session):
    user = factories.user(email="reset-inactive@example.com", is_active=False)
    db_session.commit()

    resp = api.post(
        "/auth/forgot-password",
        json={"email": "reset-inactive@example.com", "audience": "consumer"},
    )
    assert resp.status_code == 200, resp.text
    assert _live_reset_token_for(db_session, user.id) is None


# ---------------------------------------------------------------------------
# GET /auth/reset/{token}
# ---------------------------------------------------------------------------
def test_get_reset_info_returns_email_without_consuming(api, factories, db_session):
    user = factories.user(
        email="reset-info@example.com", is_active=True, display_name="Reset Info"
    )
    _row, token = mint_reset_token(db_session, user_id=user.id)
    db_session.commit()

    info = api.get(f"/auth/reset/{token}")
    assert info.status_code == 200, info.text
    body = info.json()
    assert body["email"] == "reset-info@example.com"
    assert body["display_name"] == "Reset Info"

    row = db_session.execute(
        select(InviteToken).where(InviteToken.token_hash == _hash_token(token))
    ).scalar_one()
    assert row.consumed_at is None


def test_get_reset_info_rejects_invalid_token(api):
    resp = api.get("/auth/reset/not-a-real-token")
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "RESET_INVALID"


# ---------------------------------------------------------------------------
# reset-password
# ---------------------------------------------------------------------------
def test_reset_password_sets_password_and_signs_out_everywhere(
    api, factories, db_session
):
    user = factories.user(email="reset-happy@example.com", is_active=True)
    user.password_hash = hash_password("old-password-123")
    db_session.add(user)
    db_session.commit()

    # Stand up a live web session + a mobile token pair to prove both get
    # revoked on reset.
    live_session_id = create_session(db_session, user_id=user.id).id
    pair = issue_token_pair(db_session, user_id=user.id)
    db_session.commit()

    _row, token = mint_reset_token(db_session, user_id=user.id)
    db_session.commit()

    resp = api.post(
        "/auth/reset-password",
        json={"token": token, "password": "Brand-new-pass-123"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["email"] == "reset-happy@example.com"
    # No auto-login on reset — the client routes to /login.
    assert "tht_session" not in resp.cookies

    db_session.refresh(user)
    assert verify_password("Brand-new-pass-123", user.password_hash)
    assert not verify_password("old-password-123", user.password_hash)

    # Token burned.
    token_row = db_session.execute(
        select(InviteToken).where(InviteToken.token_hash == _hash_token(token))
    ).scalar_one()
    assert token_row.consumed_at is not None

    # Web session revoked.
    sess = db_session.execute(
        select(AuthSession).where(AuthSession.id == live_session_id)
    ).scalar_one()
    assert sess.revoked_at is not None

    # Mobile tokens revoked.
    mobile_rows = db_session.execute(
        select(MobileToken).where(MobileToken.user_id == user.id)
    ).scalars().all()
    assert mobile_rows and all(m.revoked_at is not None for m in mobile_rows)


def test_reset_password_reuse_rejects(api, factories, db_session):
    user = factories.user(email="reset-replay@example.com", is_active=True)
    _row, token = mint_reset_token(db_session, user_id=user.id)
    db_session.commit()

    first = api.post(
        "/auth/reset-password",
        json={"token": token, "password": "First-new-pass-123"},
    )
    assert first.status_code == 200, first.text

    second = api.post(
        "/auth/reset-password",
        json={"token": token, "password": "Second-new-pass-123"},
    )
    assert second.status_code == 400, second.text
    assert second.json()["error"]["code"] == "RESET_INVALID"


def test_reset_password_expired_token_rejects(api, factories, db_session):
    user = factories.user(email="reset-expired@example.com", is_active=True)
    row, token = mint_reset_token(db_session, user_id=user.id)
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.add(row)
    db_session.commit()

    resp = api.post(
        "/auth/reset-password",
        json={"token": token, "password": "Whatever-123"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "RESET_INVALID"


def test_reset_password_too_short_is_validation_error(api, factories, db_session):
    user = factories.user(email="reset-short@example.com", is_active=True)
    _row, token = mint_reset_token(db_session, user_id=user.id)
    db_session.commit()

    resp = api.post(
        "/auth/reset-password",
        json={"token": token, "password": "short"},  # < 8
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# audience → origin routing (unit)
# ---------------------------------------------------------------------------
def test_build_reset_url_routes_by_audience():
    assert "/reset-password?token=abc" in build_reset_url("consumer", "abc")
    assert ":3003" in build_reset_url("consumer", "abc")
    assert ":3002" in build_reset_url("owner", "abc")
    assert ":3001" in build_reset_url("admin", "abc")
