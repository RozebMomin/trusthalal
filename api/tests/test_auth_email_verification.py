"""Integration tests for email verification.

Covers:
  * Signup (web + mobile) mints a live EMAIL_VERIFICATION token and leaves
    the account unverified until the link is used.
  * POST /auth/verify-email stamps ``email_verified_at``, burns the token,
    and — unlike password reset — does NOT revoke sessions.
  * Reuse / expiry / garbage tokens all reject with the same generic
    VERIFICATION_INVALID.
  * Resend mints a replacement and kills the previous link (the property
    that makes "I lost the email" work), and reports sent=False rather than
    erroring when the address is already confirmed.
  * Completing an admin invite marks the address verified without a second
    round trip.
  * ``require_verified_email`` admits verified users, refuses unverified
    ones with EMAIL_NOT_VERIFIED, and lets ADMINs through regardless.
  * ``/me`` exposes the boolean so clients can prompt before the user
    writes something and gets refused at submit.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select
from starlette.testclient import TestClient

from app.core.auth import CurrentUser, require_verified_email
from app.core.exception_handlers import (
    app_error_handler,
    http_exception_handler,
    validation_error_handler,
)
from app.core.exceptions import AppError
from app.db import deps as db_deps
from app.modules.auth.email_verification import (
    PURPOSE_EMAIL_VERIFICATION,
    build_verify_url,
    is_valid_audience,
    mint_verification_token,
)
from app.modules.auth.invite_repo import mint_invite
from app.modules.auth.models import InviteToken, Session as AuthSession
from app.modules.auth.repo import create_session
from app.modules.users.models import User


def _live_verification_token_for(db_session, user_id):
    return db_session.execute(
        select(InviteToken)
        .where(InviteToken.user_id == user_id)
        .where(InviteToken.purpose == PURPOSE_EMAIL_VERIFICATION)
        .where(InviteToken.consumed_at.is_(None))
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Signup mints, but does not verify
# ---------------------------------------------------------------------------
def test_web_signup_mints_token_and_leaves_account_unverified(api, db_session):
    resp = api.post(
        "/auth/signup",
        json={
            "email": "verify-web@example.com",
            "password": "S3cure-passphrase",
            "display_name": "Web Signup",
            "role": "CONSUMER",
        },
    )
    assert resp.status_code == 200, resp.text

    user = db_session.execute(
        select(User).where(User.email == "verify-web@example.com")
    ).scalar_one()

    # Signed up and signed in, but not yet confirmed — the whole point is
    # that verification doesn't block using the product.
    assert user.email_verified_at is None

    row = _live_verification_token_for(db_session, user.id)
    assert row is not None
    assert row.created_by_user_id is None
    # Days, not the 60-minute reset window.
    delta = row.expires_at - datetime.now(timezone.utc)
    assert timedelta(days=2) < delta < timedelta(days=4)


def test_mobile_signup_mints_token(api, db_session):
    resp = api.post(
        "/auth/mobile/signup",
        json={
            "email": "verify-mobile@example.com",
            "password": "S3cure-passphrase",
            "display_name": "Mobile Signup",
        },
    )
    assert resp.status_code == 200, resp.text

    user = db_session.execute(
        select(User).where(User.email == "verify-mobile@example.com")
    ).scalar_one()
    assert user.email_verified_at is None
    assert _live_verification_token_for(db_session, user.id) is not None


# ---------------------------------------------------------------------------
# Redeeming
# ---------------------------------------------------------------------------
def test_verify_email_stamps_and_burns(api, factories, db_session):
    user = factories.user(email="redeem@example.com")
    _row, plaintext = mint_verification_token(db_session, user_id=user.id)
    db_session.commit()

    resp = api.post("/auth/verify-email", json={"token": plaintext})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == "redeem@example.com"
    assert body["already_verified"] is False

    db_session.expire_all()
    assert db_session.get(User, user.id).email_verified_at is not None
    # Token burned, so the link is single-use.
    assert _live_verification_token_for(db_session, user.id) is None


def test_verify_email_does_not_revoke_sessions(api, factories, db_session):
    """Contrast with reset-password, which deliberately kicks every session.

    Confirming an address isn't a credential change, so signing the user out
    would be gratuitous — and on mobile it would look like a random logout.
    """
    user = factories.user(email="keepsession@example.com")
    session = create_session(db_session, user_id=user.id)
    _row, plaintext = mint_verification_token(db_session, user_id=user.id)
    db_session.commit()

    resp = api.post("/auth/verify-email", json={"token": plaintext})
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    still_live = db_session.get(AuthSession, session.id)
    assert still_live is not None
    assert still_live.revoked_at is None


def test_verify_email_rejects_reuse(api, factories, db_session):
    user = factories.user(email="reuse@example.com")
    _row, plaintext = mint_verification_token(db_session, user_id=user.id)
    db_session.commit()

    first = api.post("/auth/verify-email", json={"token": plaintext})
    assert first.status_code == 200

    second = api.post("/auth/verify-email", json={"token": plaintext})
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "VERIFICATION_INVALID"


def test_verify_email_rejects_expired(api, factories, db_session):
    user = factories.user(email="expired@example.com")
    row, plaintext = mint_verification_token(db_session, user_id=user.id)
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.add(row)
    db_session.commit()

    resp = api.post("/auth/verify-email", json={"token": plaintext})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VERIFICATION_INVALID"
    db_session.expire_all()
    assert db_session.get(User, user.id).email_verified_at is None


def test_verify_email_rejects_garbage(api):
    resp = api.post("/auth/verify-email", json={"token": "x" * 40})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VERIFICATION_INVALID"


def test_verify_email_rejects_inactive_user(api, factories, db_session):
    user = factories.user(email="inactive@example.com", is_active=False)
    _row, plaintext = mint_verification_token(db_session, user_id=user.id)
    db_session.commit()

    resp = api.post("/auth/verify-email", json={"token": plaintext})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VERIFICATION_INVALID"


# ---------------------------------------------------------------------------
# Resend
# ---------------------------------------------------------------------------
def test_resend_invalidates_the_previous_link(api, factories, db_session):
    """The property that makes Resend actually work: one live link at a time."""
    user = factories.user(email="resend@example.com")
    _row, old_plaintext = mint_verification_token(db_session, user_id=user.id)
    db_session.commit()

    api = api.as_user(user.id)
    resp = api.post("/auth/verify-email/resend", json={"audience": "consumer"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"sent": True, "email": "resend@example.com"}

    # The superseded link must be dead, or "resend" would quietly leave two
    # working links in two inboxes.
    stale = api.post("/auth/verify-email", json={"token": old_plaintext})
    assert stale.status_code == 400

    fresh = _live_verification_token_for(db_session, user.id)
    assert fresh is not None


def test_resend_reports_not_sent_when_already_verified(api, factories, db_session):
    user = factories.user(email="alreadyok@example.com")
    user.email_verified_at = datetime.now(timezone.utc)
    db_session.add(user)
    db_session.commit()

    api = api.as_user(user.id)
    resp = api.post("/auth/verify-email/resend", json={})
    assert resp.status_code == 200, resp.text
    # Not an error — the user's intent is already satisfied.
    assert resp.json()["sent"] is False
    assert _live_verification_token_for(db_session, user.id) is None


def test_resend_requires_a_session(api):
    resp = api.post("/auth/verify-email/resend", json={})
    assert resp.status_code == 401


def test_resend_falls_back_on_unknown_audience(api, factories, db_session):
    """An unrecognised audience must not 500 or become an open redirect."""
    user = factories.user(email="badaudience@example.com")
    db_session.commit()

    api = api.as_user(user.id)
    resp = api.post("/auth/verify-email/resend", json={"audience": "evil.com"})
    assert resp.status_code == 200, resp.text
    assert _live_verification_token_for(db_session, user.id) is not None


# ---------------------------------------------------------------------------
# Invite completion implies a reachable inbox
# ---------------------------------------------------------------------------
def test_completing_an_invite_marks_email_verified(api, factories, db_session):
    user = factories.user(email="invited@example.com")
    user.password_hash = None
    db_session.add(user)
    _row, plaintext = mint_invite(
        db_session, user_id=user.id, created_by_user_id=None
    )
    db_session.commit()

    resp = api.post(
        "/auth/set-password",
        json={"token": plaintext, "password": "S3cure-passphrase"},
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    # The single-use secret was delivered to that address, so control is
    # already proven — prompting them again would be theatre.
    assert db_session.get(User, user.id).email_verified_at is not None


# ---------------------------------------------------------------------------
# The gate itself
# ---------------------------------------------------------------------------
@pytest.fixture
def gated_api(db_session):
    """A throwaway app exposing one endpoint behind require_verified_email.

    The dependency isn't mounted on any real route yet (reviews don't exist),
    so this is the only way to exercise it. The handler registrations below
    are load-bearing and easy to forget: a bare ``FastAPI()`` has none of the
    app's error handling, so ``ForbiddenError`` would escape as an unhandled
    exception rather than the ``{"error": {...}}`` envelope the rest of the
    suite asserts on. Mirrors app/main.py.
    """
    app = FastAPI()
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)

    @app.get("/gated")
    def _gated(user: CurrentUser = Depends(require_verified_email)):
        return {"id": str(user.id)}

    def _override_get_db():
        yield db_session

    app.dependency_overrides[db_deps.get_db] = _override_get_db
    with TestClient(app) as client:
        yield client


def test_gate_refuses_unverified(gated_api, factories, db_session):
    user = factories.user(email="gate-no@example.com")
    db_session.commit()

    resp = gated_api.get("/gated", headers={"X-User-Id": str(user.id)})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


def test_gate_admits_verified(gated_api, factories, db_session):
    user = factories.user(email="gate-yes@example.com")
    user.email_verified_at = datetime.now(timezone.utc)
    db_session.add(user)
    db_session.commit()

    resp = gated_api.get("/gated", headers={"X-User-Id": str(user.id)})
    assert resp.status_code == 200, resp.text


def test_gate_lets_admins_through_unverified(gated_api, factories, db_session):
    """An admin without a confirmed address is a provisioning quirk, not a
    trust signal — locking staff out of moderation would be its own outage."""
    admin = factories.admin(email="gate-admin@example.com")
    db_session.commit()
    assert admin.email_verified_at is None

    resp = gated_api.get("/gated", headers={"X-User-Id": str(admin.id)})
    assert resp.status_code == 200, resp.text


def test_gate_requires_a_session(gated_api):
    resp = gated_api.get("/gated")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /me exposure + URL routing
# ---------------------------------------------------------------------------
def test_me_reports_verification_state(api, factories, db_session):
    user = factories.user(email="mestate@example.com")
    db_session.commit()

    api = api.as_user(user.id)
    assert api.get("/me").json()["email_verified"] is False

    user.email_verified_at = datetime.now(timezone.utc)
    db_session.add(user)
    db_session.commit()

    assert api.get("/me").json()["email_verified"] is True


def test_audience_routing():
    assert is_valid_audience("consumer")
    assert is_valid_audience("owner")
    assert is_valid_audience("admin")
    assert not is_valid_audience("https://evil.example.com")

    url = build_verify_url("consumer", "tok123")
    assert "/verify-email?token=tok123" in url
