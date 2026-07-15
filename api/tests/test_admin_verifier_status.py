"""Admin verifier profile management: revoke / suspend / reinstate."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select

from app.modules.users.models import User
from app.modules.verifiers.models import VerifierProfile


def _make_active_verifier(db_session, factories, *, email: str) -> User:
    """A user promoted to VERIFIER with a live ACTIVE profile — the state a
    freshly-approved application produces."""
    u = factories.user(email=email, is_active=True)
    u.role = "VERIFIER"
    db_session.add(u)
    db_session.add(VerifierProfile(user_id=u.id))  # status defaults to ACTIVE
    db_session.commit()
    return u


def test_revoke_drops_role_to_consumer(api, factories, db_session):
    admin = factories.admin()
    v = _make_active_verifier(db_session, factories, email="revoke-me@example.com")

    got = api.as_user(admin).get(f"/admin/verifiers/{v.id}")
    assert got.status_code == 200, got.text
    assert got.json()["status"] == "ACTIVE"

    resp = api.as_user(admin).post(
        f"/admin/verifiers/{v.id}/revoke", json={"note": "testing the pipeline"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "REVOKED"

    db_session.expire_all()
    user = db_session.execute(select(User).where(User.id == v.id)).scalar_one()
    assert user.role == "CONSUMER"


def test_reinstate_restores_verifier_role(api, factories, db_session):
    admin = factories.admin()
    v = _make_active_verifier(db_session, factories, email="reinstate@example.com")

    api.as_user(admin).post(f"/admin/verifiers/{v.id}/revoke", json={})
    resp = api.as_user(admin).post(f"/admin/verifiers/{v.id}/reinstate", json={})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "ACTIVE"

    db_session.expire_all()
    user = db_session.execute(select(User).where(User.id == v.id)).scalar_one()
    assert user.role == "VERIFIER"


def test_suspend_keeps_verifier_role(api, factories, db_session):
    admin = factories.admin()
    v = _make_active_verifier(db_session, factories, email="suspend@example.com")

    resp = api.as_user(admin).post(f"/admin/verifiers/{v.id}/suspend", json={})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "SUSPENDED"

    db_session.expire_all()
    user = db_session.execute(select(User).where(User.id == v.id)).scalar_one()
    # Suspension is a hold, not a demotion — role stays VERIFIER.
    assert user.role == "VERIFIER"


def test_get_missing_profile_404(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).get(f"/admin/verifiers/{uuid4()}")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "VERIFIER_PROFILE_NOT_FOUND"


def test_non_admin_cannot_revoke(api, factories, db_session):
    consumer = factories.consumer()
    v = _make_active_verifier(db_session, factories, email="target@example.com")
    resp = api.as_user(consumer).post(f"/admin/verifiers/{v.id}/revoke", json={})
    assert resp.status_code in (401, 403)
