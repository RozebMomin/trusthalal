"""Integration tests for consumer-preferences endpoints (Phase 9d).

Covers:
  * GET  /me/preferences — empty default, populated read-back.
  * PUT  /me/preferences — first save (insert), follow-up save
                            (update), reset semantics (PUT {} clears).
  * Auth:
       - Anonymous → 401
       - Owner / admin / verifier → 403
       - Consumer → 200 on both verbs
  * Validation:
       - Bad enum value → 422
       - Unknown field → 422 (extra="forbid")
"""
from __future__ import annotations

from sqlalchemy import select

from app.modules.consumer_preferences.models import ConsumerPreferences


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_get_preferences_returns_empty_when_none_saved(api, factories, db_session):
    consumer = factories.consumer()

    resp = api.as_user(consumer).get("/me/preferences")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "min_validation_tier": None,
        "min_menu_posture": None,
        "no_pork": None,
        "no_alcohol_served": None,
        "has_certification": None,
        "updated_at": None,
    }


def test_put_preferences_first_save_inserts_and_returns_payload(
    api, factories, db_session
):
    consumer = factories.consumer()

    payload = {
        "min_validation_tier": "CERTIFICATE_ON_FILE",
        "min_menu_posture": "MIXED_SEPARATE_KITCHENS",
        "no_pork": True,
        "no_alcohol_served": True,
        "has_certification": False,
    }
    resp = api.as_user(consumer).put("/me/preferences", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    for key, value in payload.items():
        assert body[key] == value
    assert body["updated_at"] is not None

    # Row landed in the db.
    row = db_session.execute(
        select(ConsumerPreferences).where(
            ConsumerPreferences.user_id == consumer.id
        )
    ).scalar_one()
    assert row.min_validation_tier == "CERTIFICATE_ON_FILE"
    assert row.min_menu_posture == "MIXED_SEPARATE_KITCHENS"
    assert row.no_pork is True


def test_put_preferences_round_trips_via_get(api, factories, db_session):
    consumer = factories.consumer()

    api.as_user(consumer).put(
        "/me/preferences",
        json={
            "min_validation_tier": "TRUST_HALAL_VERIFIED",
            "no_pork": True,
        },
    )

    resp = api.as_user(consumer).get("/me/preferences")
    assert resp.status_code == 200
    body = resp.json()
    assert body["min_validation_tier"] == "TRUST_HALAL_VERIFIED"
    assert body["no_pork"] is True
    # Fields not sent on PUT come back null — full-replace semantics.
    assert body["min_menu_posture"] is None
    assert body["no_alcohol_served"] is None
    assert body["has_certification"] is None


def test_put_preferences_second_save_replaces_full_row(
    api, factories, db_session
):
    consumer = factories.consumer()

    api.as_user(consumer).put(
        "/me/preferences",
        json={
            "min_validation_tier": "SELF_ATTESTED",
            "min_menu_posture": "FULLY_HALAL",
            "no_pork": True,
            "has_certification": True,
        },
    )

    # Second PUT only sends one field — the others should reset to
    # null, not persist from the first call.
    resp = api.as_user(consumer).put(
        "/me/preferences",
        json={"no_alcohol_served": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "min_validation_tier": None,
        "min_menu_posture": None,
        "no_pork": None,
        "no_alcohol_served": True,
        "has_certification": None,
        "updated_at": body["updated_at"],
    }


def test_put_empty_body_clears_everything(api, factories, db_session):
    consumer = factories.consumer()

    api.as_user(consumer).put(
        "/me/preferences",
        json={
            "min_validation_tier": "TRUST_HALAL_VERIFIED",
            "no_pork": True,
        },
    )

    # The "Reset" button on the prefs page is just PUT {}.
    resp = api.as_user(consumer).put("/me/preferences", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert body["min_validation_tier"] is None
    assert body["no_pork"] is None
    assert body["updated_at"] is not None


# ---------------------------------------------------------------------------
# Auth gates
# ---------------------------------------------------------------------------


def test_get_preferences_requires_auth(api):
    resp = api.get("/me/preferences")
    assert resp.status_code == 401


def test_put_preferences_requires_auth(api):
    resp = api.put("/me/preferences", json={})
    assert resp.status_code == 401


def test_get_preferences_403s_for_owner(api, factories):
    owner = factories.owner()
    resp = api.as_user(owner).get("/me/preferences")
    assert resp.status_code == 403


def test_get_preferences_403s_for_admin(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).get("/me/preferences")
    assert resp.status_code == 403


def test_get_preferences_403s_for_verifier(api, factories):
    verifier = factories.verifier()
    resp = api.as_user(verifier).get("/me/preferences")
    assert resp.status_code == 403


def test_put_preferences_403s_for_owner(api, factories):
    owner = factories.owner()
    resp = api.as_user(owner).put("/me/preferences", json={})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_put_preferences_rejects_bad_enum_value(api, factories):
    consumer = factories.consumer()
    resp = api.as_user(consumer).put(
        "/me/preferences",
        json={"min_validation_tier": "NOT_A_TIER"},
    )
    assert resp.status_code == 422


def test_put_preferences_rejects_unknown_field(api, factories):
    consumer = factories.consumer()
    # extra="forbid" — typos shouldn't silently no-op.
    resp = api.as_user(consumer).put(
        "/me/preferences",
        json={"min_validation_tier_typo": "SELF_ATTESTED"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Isolation between users
# ---------------------------------------------------------------------------


def test_preferences_are_scoped_to_caller(api, factories, db_session):
    a = factories.consumer()
    b = factories.consumer()

    api.as_user(a).put(
        "/me/preferences",
        json={"min_validation_tier": "TRUST_HALAL_VERIFIED"},
    )
    api.as_user(b).put(
        "/me/preferences",
        json={"min_validation_tier": "SELF_ATTESTED"},
    )

    resp_a = api.as_user(a).get("/me/preferences").json()
    resp_b = api.as_user(b).get("/me/preferences").json()
    assert resp_a["min_validation_tier"] == "TRUST_HALAL_VERIFIED"
    assert resp_b["min_validation_tier"] == "SELF_ATTESTED"
