"""Tests for the admin user-list `account_state` decoration and the
`POST /admin/users/{user_id}/resend-invite` endpoint.

State machine recap
-------------------
account_state is derived at read time from (password_hash, is_active,
live invite token):

  * has password + active                 → ACTIVE
  * has password + deactivated            → DEACTIVATED
  * no password + live invite             → INVITE_PENDING
  * no password + no live invite          → INVITE_EXPIRED

The list/get endpoints surface ``account_state`` and
``invite_expires_at`` so the admin UI can render a state pill and
"invite expires in X" copy without a second round-trip.

Resend invite
-------------
``POST /admin/users/{id}/resend-invite`` mints a fresh invite +
revokes the previous live one, sends the invite email best-effort,
and returns the same ``invite_*`` triple the create-user response
uses. It gates on:

  * 404 USER_NOT_FOUND          — id doesn't match any user
  * 409 USER_ALREADY_ONBOARDED  — user already set a password
  * 409 USER_INACTIVE           — user is deactivated
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.password_hashing import hash_password
from app.modules.auth.invite_repo import (
    DEFAULT_PURPOSE_INVITE,
    _hash_token,
    mint_invite,
)
from app.modules.auth.models import InviteToken


# ---------------------------------------------------------------------------
# Helpers — let a test put a user into a specific state without going
# through the HTTP surface (which would complicate the assertion).
# ---------------------------------------------------------------------------


def _set_password(db_session, user) -> None:
    """Give a user a real argon2 hash. Tests don't care about the
    plaintext — just that ``password_hash IS NOT NULL`` for state
    purposes."""
    user.password_hash = hash_password("anything-long-enough-1234")
    db_session.add(user)
    db_session.flush()


def _expire_invites_for(db_session, user_id) -> None:
    """Backdate the user's invite rows so they're all "live? no" in
    the eyes of ``_live_invite_expires_at_for``. Mimics the
    "invite expired without being used" path without waiting 7 days.
    """
    rows = db_session.execute(
        select(InviteToken).where(InviteToken.user_id == user_id)
    ).scalars().all()
    for row in rows:
        row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db_session.add(row)
    db_session.flush()


# ---------------------------------------------------------------------------
# GET /admin/users — account_state surfaced per user
# ---------------------------------------------------------------------------


def test_list_users_decorates_active_user_with_account_state(
    api, factories, db_session
):
    """An admin who has set their password and is active reads ACTIVE.

    The admin themselves is the canonical fully-onboarded row, so the
    test sets their password explicitly and reads their own list row.
    """
    admin = factories.admin()
    _set_password(db_session, admin)
    db_session.commit()

    resp = api.as_user(admin).get("/admin/users")
    assert resp.status_code == 200, resp.text
    rows = {r["id"]: r for r in resp.json()}
    me = rows[str(admin.id)]
    assert me["account_state"] == "ACTIVE"
    assert me["invite_expires_at"] is None


def test_list_users_decorates_deactivated_user(api, factories, db_session):
    """Password set + is_active=False → DEACTIVATED. Mirrors the admin
    detail page's "this account is disabled" state."""
    admin = factories.admin()
    target = factories.user(role="OWNER", is_active=False)
    _set_password(db_session, target)
    db_session.commit()

    resp = api.as_user(admin).get("/admin/users")
    assert resp.status_code == 200, resp.text
    rows = {r["id"]: r for r in resp.json()}
    assert rows[str(target.id)]["account_state"] == "DEACTIVATED"
    assert rows[str(target.id)]["invite_expires_at"] is None


def test_list_users_decorates_invite_pending(api, factories, db_session):
    """No password + live invite → INVITE_PENDING; expires timestamp
    surfaces so the UI can say "Invite expires in N days"."""
    admin = factories.admin()
    target = factories.user(role="OWNER")
    invite_row, _plain = mint_invite(
        db_session,
        user_id=target.id,
        created_by_user_id=admin.id,
    )
    db_session.commit()

    resp = api.as_user(admin).get("/admin/users")
    assert resp.status_code == 200, resp.text
    rows = {r["id"]: r for r in resp.json()}
    row = rows[str(target.id)]
    assert row["account_state"] == "INVITE_PENDING"
    assert row["invite_expires_at"] is not None
    # Returned timestamp tracks the actual invite row.
    surfaced = datetime.fromisoformat(
        row["invite_expires_at"].replace("Z", "+00:00")
    )
    expected = invite_row.expires_at
    if expected.tzinfo is None:
        expected = expected.replace(tzinfo=timezone.utc)
    # The DB rounds to microseconds; compare with a small tolerance.
    assert abs((surfaced - expected).total_seconds()) < 1


def test_list_users_decorates_invite_expired(api, factories, db_session):
    """No password + no live invite → INVITE_EXPIRED. Covers both
    "invite was never minted" and "invite expired" since the state
    function only checks for LIVE tokens."""
    admin = factories.admin()
    target = factories.user(role="OWNER")
    # No invite minted at all — same INVITE_EXPIRED outcome.
    db_session.commit()

    resp = api.as_user(admin).get("/admin/users")
    assert resp.status_code == 200, resp.text
    rows = {r["id"]: r for r in resp.json()}
    row = rows[str(target.id)]
    assert row["account_state"] == "INVITE_EXPIRED"
    assert row["invite_expires_at"] is None


def test_list_users_ignores_expired_invite_token(
    api, factories, db_session
):
    """A user with ONLY expired invite tokens reads INVITE_EXPIRED,
    not INVITE_PENDING — the "live" subquery filters on
    expires_at > now()."""
    admin = factories.admin()
    target = factories.user(role="OWNER")
    mint_invite(
        db_session, user_id=target.id, created_by_user_id=admin.id
    )
    _expire_invites_for(db_session, target.id)
    db_session.commit()

    resp = api.as_user(admin).get("/admin/users")
    assert resp.status_code == 200, resp.text
    rows = {r["id"]: r for r in resp.json()}
    assert rows[str(target.id)]["account_state"] == "INVITE_EXPIRED"
    assert rows[str(target.id)]["invite_expires_at"] is None


# ---------------------------------------------------------------------------
# GET /admin/users/{id} — same decoration on the detail endpoint
# ---------------------------------------------------------------------------


def test_get_user_returns_account_state(api, factories, db_session):
    """Single-user lookup carries the same fields as the list, so the
    detail page renders the same state pill without a follow-up call."""
    admin = factories.admin()
    target = factories.user(role="OWNER")
    mint_invite(
        db_session, user_id=target.id, created_by_user_id=admin.id
    )
    db_session.commit()

    resp = api.as_user(admin).get(f"/admin/users/{target.id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["account_state"] == "INVITE_PENDING"
    assert body["invite_expires_at"] is not None


def test_user_response_exposes_email_verification(api, factories, db_session):
    """The admin has no other way to see whether an email is confirmed —
    account_state is about invites and passwords, not verification, and a
    user can be ACTIVE with an unconfirmed email (which gates posting
    reviews). Exposed as a timestamp so the operator learns when, not only
    whether.
    """
    from datetime import datetime, timezone

    admin = factories.admin()
    unverified = factories.user(email="unverified@example.com")
    verified = factories.user(email="verified@example.com")
    verified.email_verified_at = datetime(2026, 7, 1, tzinfo=timezone.utc)
    db_session.commit()

    unv = api.as_user(admin).get(f"/admin/users/{unverified.id}").json()
    assert unv["email_verified_at"] is None

    ver = api.as_user(admin).get(f"/admin/users/{verified.id}").json()
    assert ver["email_verified_at"] is not None
    assert ver["email_verified_at"].startswith("2026-07-01")

    # And the list endpoint carries it too, so the shape doesn't diverge.
    listed = api.as_user(admin).get("/admin/users").json()
    rows = listed["items"] if isinstance(listed, dict) else listed
    assert all("email_verified_at" in r for r in rows)


# ---------------------------------------------------------------------------
# POST /admin/users/{id}/resend-invite — happy path
# ---------------------------------------------------------------------------


def test_resend_invite_mints_fresh_token_and_revokes_old(
    api, factories, db_session
):
    """Re-inviting an INVITE_EXPIRED user mints a new live token and
    drops the old expired ones — the partial unique index requires
    only one live row per (user_id, purpose), and even expired rows
    get cleared so the table stays tidy."""
    admin = factories.admin()
    target = factories.user(role="OWNER")
    _old_row, old_plain = mint_invite(
        db_session, user_id=target.id, created_by_user_id=admin.id
    )
    _expire_invites_for(db_session, target.id)
    db_session.commit()

    resp = api.as_user(admin).post(
        f"/admin/users/{target.id}/resend-invite"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["invite_token"], str)
    assert body["invite_token"] != old_plain
    assert body["invite_token"] in body["invite_url"]
    assert "/set-password?token=" in body["invite_url"]
    # Returned expiry is in the future (default TTL ≈ 7 days).
    exp = datetime.fromisoformat(
        body["invite_expires_at"].replace("Z", "+00:00")
    )
    assert exp > datetime.now(timezone.utc) + timedelta(days=1)

    # Exactly one live invite remains — old one was revoked by
    # mint_invite's revoke step.
    live = db_session.execute(
        select(InviteToken).where(
            InviteToken.user_id == target.id,
            InviteToken.consumed_at.is_(None),
            InviteToken.expires_at > datetime.now(timezone.utc),
        )
    ).scalars().all()
    assert len(live) == 1
    assert live[0].token_hash == _hash_token(body["invite_token"])


def test_resend_invite_flips_state_to_invite_pending(
    api, factories, db_session
):
    """An expired-state user should read INVITE_PENDING immediately
    after the resend lands, so the list pill updates without a manual
    refresh."""
    admin = factories.admin()
    target = factories.user(role="OWNER")
    # No invite at all → state starts INVITE_EXPIRED.
    db_session.commit()

    api.as_user(admin).post(
        f"/admin/users/{target.id}/resend-invite"
    )

    resp = api.as_user(admin).get(f"/admin/users/{target.id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["account_state"] == "INVITE_PENDING"


# ---------------------------------------------------------------------------
# POST /admin/users/{id}/resend-invite — gates
# ---------------------------------------------------------------------------


def test_resend_invite_404_for_unknown_user(api, factories):
    """Unknown user id → 404 USER_NOT_FOUND. Matches the rest of the
    admin surface's not-found contract."""
    admin = factories.admin()
    missing_id = "00000000-0000-0000-0000-000000000000"

    resp = api.as_user(admin).post(
        f"/admin/users/{missing_id}/resend-invite"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "USER_NOT_FOUND"


def test_resend_invite_409_when_user_already_onboarded(
    api, factories, db_session
):
    """A user who already has a password_hash shouldn't get a new
    invite — re-inviting them would suggest "set password" UX that
    only fits new users. The proper path is password-reset (which is
    a different surface)."""
    admin = factories.admin()
    target = factories.user(role="OWNER")
    _set_password(db_session, target)
    db_session.commit()

    resp = api.as_user(admin).post(
        f"/admin/users/{target.id}/resend-invite"
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "USER_ALREADY_ONBOARDED"


def test_resend_invite_409_when_user_deactivated(
    api, factories, db_session
):
    """Deactivated users shouldn't receive fresh invites. The
    expected flow is reactivate-first; the resend endpoint forces
    the admin to make that explicit."""
    admin = factories.admin()
    target = factories.user(role="OWNER", is_active=False)
    db_session.commit()

    resp = api.as_user(admin).post(
        f"/admin/users/{target.id}/resend-invite"
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "USER_INACTIVE"


def test_resend_invite_requires_admin(api, factories):
    """Non-admins can't trigger a resend. The endpoint shares the
    same require_roles(ADMIN) gate as the rest of the admin user
    surface."""
    non_admin = factories.owner()
    target = factories.user(role="OWNER")

    resp = api.as_user(non_admin).post(
        f"/admin/users/{target.id}/resend-invite"
    )
    assert resp.status_code in (401, 403)
