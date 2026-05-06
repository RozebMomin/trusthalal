"""Integration tests for verifier-application endpoints (Phase 8a).

Covers:
  * POST /verifier-applications — anonymous + signed-in submit,
    duplicate guards (per-user + per-email).
  * GET  /me/verifier-applications — applicant-self list (scoped).
  * GET  /me/verifier-applications/{id} — read with 404 for other
    users.
  * POST /me/verifier-applications/{id}/withdraw — happy path,
    idempotency, post-decision lock.
  * GET  /admin/verifier-applications — queue list, status filter,
    role gating (consumer / owner / verifier all 403).
  * GET  /admin/verifier-applications/{id} — detail.
  * POST /admin/verifier-applications/{id}/decide — approve flips
    user role + creates VerifierProfile; reject requires note;
    re-decide blocked.
"""
from __future__ import annotations

from sqlalchemy import select

from app.modules.users.enums import UserRole
from app.modules.users.models import User
from app.modules.verifiers.enums import (
    VerifierApplicationStatus,
    VerifierProfileStatus,
)
from app.modules.verifiers.models import (
    VerifierApplication,
    VerifierProfile,
)


# ---------------------------------------------------------------------------
# Public submit
# ---------------------------------------------------------------------------

VALID_PAYLOAD = {
    "applicant_email": "tester@example.com",
    "applicant_name": "Test Applicant",
    "motivation": (
        "I want to help verify halal restaurants in my area because I "
        "spend a lot of time eating out and the existing reviews are "
        "inconsistent."
    ),
    "background": "Active food blogger for 4 years.",
    "social_links": {"instagram": "@testreviewer"},
}


def test_submit_application_anonymous_creates_pending_row(
    api, factories, db_session
):
    resp = api.post("/verifier-applications", json=VALID_PAYLOAD)
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == VerifierApplicationStatus.PENDING.value
    assert body["applicant_email"] == VALID_PAYLOAD["applicant_email"]
    assert body["applicant_user_id"] is None
    assert body["decided_at"] is None

    row = db_session.execute(
        select(VerifierApplication).where(
            VerifierApplication.id == body["id"]
        )
    ).scalar_one()
    assert row.applicant_user_id is None
    assert row.applicant_email == VALID_PAYLOAD["applicant_email"]


def test_submit_application_signed_in_captures_user_id(
    api, factories, db_session
):
    consumer = factories.consumer()
    resp = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["applicant_user_id"] == str(consumer.id)


def test_submit_application_rejects_short_motivation(api):
    payload = {**VALID_PAYLOAD, "motivation": "too short"}
    resp = api.post("/verifier-applications", json=payload)
    assert resp.status_code == 422


def test_submit_application_rejects_unknown_field(api):
    payload = {**VALID_PAYLOAD, "secret_admin_flag": True}
    resp = api.post("/verifier-applications", json=payload)
    assert resp.status_code == 422


def test_submit_application_duplicate_per_user_blocked(
    api, factories, db_session
):
    consumer = factories.consumer()
    first = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    assert first.status_code == 201

    dup = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "VERIFIER_APPLICATION_DUPLICATE"


def test_submit_application_duplicate_per_email_blocked(api):
    """Two anonymous submissions with the same email should collide."""
    first = api.post("/verifier-applications", json=VALID_PAYLOAD)
    assert first.status_code == 201

    dup_payload = {**VALID_PAYLOAD, "applicant_name": "Different Name"}
    dup = api.post("/verifier-applications", json=dup_payload)
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "VERIFIER_APPLICATION_DUPLICATE"


def test_resubmit_after_rejection_allowed(api, factories, db_session):
    """Once an application is REJECTED (terminal but non-blocking),
    the applicant can apply again."""
    consumer = factories.consumer()
    admin = factories.admin()

    create = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    application_id = create.json()["id"]

    api.as_user(admin).post(
        f"/admin/verifier-applications/{application_id}/decide",
        json={
            "decision": "REJECTED",
            "decision_note": "Need more context on prior reviews.",
        },
    )

    resp = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    assert resp.status_code == 201


# ---------------------------------------------------------------------------
# Applicant-self reads
# ---------------------------------------------------------------------------


def test_list_my_applications_scopes_to_caller(api, factories, db_session):
    a = factories.consumer()
    b = factories.consumer()

    api.as_user(a).post("/verifier-applications", json=VALID_PAYLOAD)
    api.as_user(b).post(
        "/verifier-applications",
        json={**VALID_PAYLOAD, "applicant_email": "b@example.com"},
    )

    resp = api.as_user(a).get("/me/verifier-applications")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["applicant_user_id"] == str(a.id)


def test_get_my_application_404s_for_other_user(api, factories, db_session):
    a = factories.consumer()
    b = factories.consumer()
    create = api.as_user(a).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    app_id = create.json()["id"]

    resp = api.as_user(b).get(f"/me/verifier-applications/{app_id}")
    assert resp.status_code == 404


def test_list_my_applications_requires_auth(api):
    resp = api.get("/me/verifier-applications")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Withdraw
# ---------------------------------------------------------------------------


def test_withdraw_pending_application_succeeds(api, factories, db_session):
    consumer = factories.consumer()
    create = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    app_id = create.json()["id"]

    resp = api.as_user(consumer).post(
        f"/me/verifier-applications/{app_id}/withdraw"
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == VerifierApplicationStatus.WITHDRAWN.value


def test_withdraw_idempotent_against_already_withdrawn(
    api, factories, db_session
):
    consumer = factories.consumer()
    create = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    app_id = create.json()["id"]

    api.as_user(consumer).post(
        f"/me/verifier-applications/{app_id}/withdraw"
    )
    second = api.as_user(consumer).post(
        f"/me/verifier-applications/{app_id}/withdraw"
    )
    assert second.status_code == 200


def test_withdraw_blocked_after_admin_decision(api, factories, db_session):
    consumer = factories.consumer()
    admin = factories.admin()
    create = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    app_id = create.json()["id"]

    api.as_user(admin).post(
        f"/admin/verifier-applications/{app_id}/decide",
        json={
            "decision": "REJECTED",
            "decision_note": "No prior reviews.",
        },
    )

    resp = api.as_user(consumer).post(
        f"/me/verifier-applications/{app_id}/withdraw"
    )
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"]
        == "VERIFIER_APPLICATION_NOT_WITHDRAWABLE"
    )


# ---------------------------------------------------------------------------
# Admin queue + role gating
# ---------------------------------------------------------------------------


def test_admin_list_applications_requires_admin(api, factories):
    consumer = factories.consumer()
    owner = factories.owner()
    verifier = factories.verifier()

    assert (
        api.as_user(consumer).get("/admin/verifier-applications").status_code
        == 403
    )
    assert (
        api.as_user(owner).get("/admin/verifier-applications").status_code
        == 403
    )
    assert (
        api.as_user(verifier).get("/admin/verifier-applications").status_code
        == 403
    )


def test_admin_list_applications_returns_rows(api, factories, db_session):
    admin = factories.admin()
    factories.consumer()  # noise: a user with no application

    api.post("/verifier-applications", json=VALID_PAYLOAD)

    resp = api.as_user(admin).get("/admin/verifier-applications")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) >= 1


def test_admin_list_filter_by_status(api, factories, db_session):
    admin = factories.admin()
    consumer = factories.consumer()
    create = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    api.as_user(admin).post(
        f"/admin/verifier-applications/{create.json()['id']}/decide",
        json={
            "decision": "REJECTED",
            "decision_note": "no",
        },
    )

    pending = api.as_user(admin).get(
        "/admin/verifier-applications?status=PENDING"
    )
    rejected = api.as_user(admin).get(
        "/admin/verifier-applications?status=REJECTED"
    )
    assert pending.status_code == 200
    assert rejected.status_code == 200
    assert all(
        r["status"] == VerifierApplicationStatus.PENDING.value
        for r in pending.json()
    )
    assert any(
        r["status"] == VerifierApplicationStatus.REJECTED.value
        for r in rejected.json()
    )


# ---------------------------------------------------------------------------
# Admin decide
# ---------------------------------------------------------------------------


def test_admin_approve_promotes_user_and_creates_profile(
    api, factories, db_session
):
    admin = factories.admin()
    consumer = factories.consumer(email="vera@example.com")
    create = api.as_user(consumer).post(
        "/verifier-applications",
        json={**VALID_PAYLOAD, "applicant_email": "vera@example.com"},
    )
    app_id = create.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/verifier-applications/{app_id}/decide",
        json={"decision": "APPROVED"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == VerifierApplicationStatus.APPROVED.value
    assert body["resulting_verifier_profile_id"] is not None
    assert body["decided_by_user_id"] == str(admin.id)

    db_session.expire_all()
    refreshed = db_session.execute(
        select(User).where(User.id == consumer.id)
    ).scalar_one()
    assert refreshed.role == UserRole.VERIFIER.value

    profile = db_session.execute(
        select(VerifierProfile).where(VerifierProfile.user_id == consumer.id)
    ).scalar_one()
    assert profile.status == VerifierProfileStatus.ACTIVE.value


def test_admin_reject_requires_note(api, factories, db_session):
    admin = factories.admin()
    consumer = factories.consumer()
    create = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    app_id = create.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/verifier-applications/{app_id}/decide",
        json={"decision": "REJECTED"},
    )
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"]
        == "VERIFIER_APPLICATION_REJECT_NOTE_REQUIRED"
    )


def test_admin_redecide_blocked(api, factories, db_session):
    admin = factories.admin()
    consumer = factories.consumer(email="re@example.com")
    create = api.as_user(consumer).post(
        "/verifier-applications",
        json={**VALID_PAYLOAD, "applicant_email": "re@example.com"},
    )
    app_id = create.json()["id"]

    api.as_user(admin).post(
        f"/admin/verifier-applications/{app_id}/decide",
        json={"decision": "APPROVED"},
    )
    resp = api.as_user(admin).post(
        f"/admin/verifier-applications/{app_id}/decide",
        json={"decision": "REJECTED", "decision_note": "actually no"},
    )
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"]
        == "VERIFIER_APPLICATION_NOT_DECIDABLE"
    )


def test_admin_approve_blocked_when_no_user_matches(api, factories):
    """Anonymous applicant whose email never gets a Trust Halal
    account → 409 telling admin to ask them to sign up."""
    admin = factories.admin()
    create = api.post(
        "/verifier-applications",
        json={
            **VALID_PAYLOAD,
            "applicant_email": "noaccount@example.com",
        },
    )
    app_id = create.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/verifier-applications/{app_id}/decide",
        json={"decision": "APPROVED"},
    )
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"]
        == "VERIFIER_APPLICATION_USER_MISSING"
    )


def test_admin_approve_blocked_for_owner_role(api, factories, db_session):
    admin = factories.admin()
    owner = factories.owner(email="owns@example.com")
    create = api.post(
        "/verifier-applications",
        json={**VALID_PAYLOAD, "applicant_email": "owns@example.com"},
    )
    resp = api.as_user(admin).post(
        f"/admin/verifier-applications/{create.json()['id']}/decide",
        json={"decision": "APPROVED"},
    )
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"]
        == "VERIFIER_APPLICATION_USER_WRONG_ROLE"
    )


def test_admin_decide_invalid_value_422(api, factories):
    admin = factories.admin()
    consumer = factories.consumer()
    create = api.as_user(consumer).post(
        "/verifier-applications", json=VALID_PAYLOAD
    )
    resp = api.as_user(admin).post(
        f"/admin/verifier-applications/{create.json()['id']}/decide",
        json={"decision": "PENDING"},
    )
    # PENDING is a valid enum value, but the repo guards against it.
    # The schema admits any VerifierApplicationStatus, so the repo
    # check returns the dedicated error.
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"]
        == "VERIFIER_APPLICATION_INVALID_DECISION"
    )
