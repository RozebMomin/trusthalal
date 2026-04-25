"""Integration tests for self-service signup.

POST /auth/signup is the public path restaurant owners use to create
their own account before submitting an ownership claim. Tests cover:

  * Happy path → 201/200 with session cookie set, OWNER role, persisted
    user with hashed password and is_active=True.
  * Email collision → 409 EMAIL_TAKEN, idempotent across casing.
  * Password length validation at the Pydantic boundary → 422.
  * display_name is required (matches the User column nullability rule
    we want for owner accounts even though the column itself is
    nullable).
  * Role is always OWNER — extra fields (``role``, ``is_active``, etc.)
    are forbidden at the Pydantic layer so a curious caller can't
    self-promote to ADMIN.
  * The session cookie that signup sets is immediately good for /me.
"""
from __future__ import annotations

from sqlalchemy import select

from app.core.password_hashing import verify_password
from app.modules.users.models import User


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------
def test_signup_creates_owner_and_logs_in(api, db_session):
    """A fresh signup call:
      * persists a User with role=OWNER, hashed password, active flag.
      * returns the LoginResponse-shaped body (user_id, email, role,
        display_name, redirect_path).
      * sets the session cookie so the user is already logged in.
    """
    resp = api.post(
        "/auth/signup",
        json={
            "email": "owner@example.com",
            "password": "s3cure-passphrase",
            "display_name": "Owner One",
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == "owner@example.com"
    assert body["role"] == "OWNER"
    assert body["display_name"] == "Owner One"
    # OWNER lands on the portal home; the owner portal lives at its
    # own origin so "/" is the right redirect.
    assert body["redirect_path"] == "/"
    assert "user_id" in body

    # Auto-login: cookie set means the next request is authenticated.
    assert "tht_session" in resp.cookies

    user = db_session.execute(
        select(User).where(User.email == "owner@example.com")
    ).scalar_one()
    assert user.role == "OWNER"
    assert user.is_active is True
    assert user.password_hash is not None
    assert verify_password("s3cure-passphrase", user.password_hash)
    assert user.display_name == "Owner One"


def test_signup_session_cookie_authenticates_subsequent_requests(api):
    """After signup, /me returns the freshly-created user without any
    further auth dance. Verifies the cookie roundtrip end-to-end."""
    resp = api.post(
        "/auth/signup",
        json={
            "email": "ownerme@example.com",
            "password": "another-good-password",
            "display_name": "Owner Me",
        },
    )
    assert resp.status_code == 200, resp.text

    # Reuse the TestClient cookie jar from the same APIClient so the
    # next call carries the cookie naturally.
    me = api.get("/me")
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["role"] == "OWNER"


def test_signup_strips_display_name_whitespace(api, db_session):
    """Whitespace-only or padded display_name is normalized.
    Helps when a user accidentally hits space at the end of their name
    in the form."""
    resp = api.post(
        "/auth/signup",
        json={
            "email": "trim@example.com",
            "password": "passwordtrim",
            "display_name": "  Owner Trim  ",
        },
    )
    assert resp.status_code == 200, resp.text
    user = db_session.execute(
        select(User).where(User.email == "trim@example.com")
    ).scalar_one()
    assert user.display_name == "Owner Trim"


# ---------------------------------------------------------------------------
# Email collision
# ---------------------------------------------------------------------------
def test_signup_existing_email_returns_409(api, factories):
    """If an email already maps to a user (any role), signup returns
    409 EMAIL_TAKEN with a message the client can show as "sign in
    instead?". The pre-existing account isn't modified."""
    factories.user(email="taken@example.com", is_active=True)

    resp = api.post(
        "/auth/signup",
        json={
            "email": "taken@example.com",
            "password": "doesnotmatter",
            "display_name": "Late Comer",
        },
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["error"]["code"] == "EMAIL_TAKEN"


def test_signup_email_collision_is_case_insensitive(api, factories):
    """ADMIN@example.com vs admin@example.com are the same account
    from a uniqueness standpoint — login already does case-insensitive
    lookup, so signup must too. Otherwise we'd allow a parallel account
    that login could never disambiguate."""
    factories.user(email="MixedCase@Example.com", is_active=True)

    resp = api.post(
        "/auth/signup",
        json={
            "email": "mixedcase@example.com",
            "password": "passwordmixed",
            "display_name": "Lower Case",
        },
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "EMAIL_TAKEN"


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def test_signup_short_password_is_validation_error(api):
    """Min length 8 is enforced at the Pydantic layer — 422 with the
    VALIDATION_ERROR envelope, no DB write."""
    resp = api.post(
        "/auth/signup",
        json={
            "email": "short@example.com",
            "password": "short",  # 5 chars
            "display_name": "Short Pass",
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_signup_missing_display_name_is_validation_error(api):
    """display_name is required. Trust Halal staff need a human-readable
    name when reviewing claims — empty/missing reject."""
    resp = api.post(
        "/auth/signup",
        json={
            "email": "nodisplayname@example.com",
            "password": "passwordnodn",
            "display_name": "",
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_signup_invalid_email_is_validation_error(api):
    """Pydantic's EmailStr rejects malformed emails — 422 with the
    standard envelope."""
    resp = api.post(
        "/auth/signup",
        json={
            "email": "not-an-email",
            "password": "passwordbademail",
            "display_name": "Bad Email",
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_signup_extra_fields_rejected(api):
    """``extra="forbid"`` on SignupRequest means a curious caller can't
    sneak in role=ADMIN or is_active=False overrides. The endpoint
    hard-codes role=OWNER server-side regardless."""
    resp = api.post(
        "/auth/signup",
        json={
            "email": "sneaky@example.com",
            "password": "passwordsneaky",
            "display_name": "Sneaky Owner",
            "role": "ADMIN",
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
