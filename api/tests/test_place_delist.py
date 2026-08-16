"""Integration tests for place de-listing + the public tombstone.

Covers:
  * POST /admin/places/{id}/delist — reason-required removal for cause
  * POST /admin/places/{id}/relist — reverse it
  * GET /places/{id} — tombstone (200) for a de-listed place vs 404 for
    a plain junk soft-delete
  * GET /places?q=... — de-listed places drop out of search
  * GET /places/{id}/halal-history — DELISTED entry surfaces on the
    consumer timeline; dispute entries carry category + outcome
  * POST /admin/disputes/{id}/resolve with a de-list escalation
"""
from __future__ import annotations

from sqlalchemy import select

from app.modules.disputes.enums import DisputeStatus
from app.modules.halal_profiles.enums import HalalProfileEventType
from app.modules.halal_profiles.models import HalalProfile, HalalProfileEvent
from app.modules.places.models import Place, PlaceEvent


COMPLETE_QUESTIONNAIRE: dict = {
    "questionnaire_version": 1,
    "menu_posture": "FULLY_HALAL",
    "has_pork": False,
    "alcohol_policy": "NONE",
    "alcohol_in_cooking": False,
    "meat_products": [
        {"meat_type": "CHICKEN", "product_name": "Chicken", "slaughter_method": "HAND_CUT"},
        {"meat_type": "BEEF", "product_name": "Beef", "slaughter_method": "HAND_CUT"},
    ],
    "seafood_only": False,
    "has_certification": True,
    "certifying_body_name": "IFANCA",
    "caveats": None,
}


def _approve_claim_for_place(api, factories, db_session):
    """Provision a place with a live HalalProfile (via approved claim)."""
    admin = factories.admin()
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
            "structured_response": COMPLETE_QUESTIONNAIRE,
        },
    )
    claim_id = create_resp.json()["id"]
    api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")
    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={"validation_tier": "SELF_ATTESTED"},
    )
    return admin, owner, place, org


def _profile_event_types(db_session, place_id) -> list[str]:
    return list(
        db_session.execute(
            select(HalalProfileEvent.event_type)
            .join(HalalProfile, HalalProfile.id == HalalProfileEvent.profile_id)
            .where(HalalProfile.place_id == place_id)
            .order_by(HalalProfileEvent.created_at)
        ).scalars().all()
    )


# ---------------------------------------------------------------------------
# De-list / re-list + public read
# ---------------------------------------------------------------------------


def test_delist_returns_tombstone_on_public_read(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()
    db_session.commit()

    resp = api.as_user(admin).post(
        f"/admin/places/{place.id}/delist",
        json={"reason": "NOT_HALAL", "note": "Verifier confirmed pork on the grill."},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["delist_reason"] == "NOT_HALAL"

    # Public read: tombstone, not 404.
    pub = api.get(f"/places/{place.id}")
    assert pub.status_code == 200, pub.text
    body = pub.json()
    assert body["is_deleted"] is True
    assert body["delist_reason"] == "NOT_HALAL"
    assert body["delisted_at"] is not None
    assert body["halal_profile"] is None


def test_junk_soft_delete_still_404s(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()
    db_session.commit()

    # Plain soft-delete (no delist reason) — the junk/duplicate path.
    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}", json={"reason": "duplicate listing"}
    )
    assert resp.status_code == 204, resp.text

    pub = api.get(f"/places/{place.id}")
    assert pub.status_code == 404, pub.text


def test_relist_restores_public_read(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()
    db_session.commit()

    api.as_user(admin).post(
        f"/admin/places/{place.id}/delist", json={"reason": "PERMANENTLY_CLOSED"}
    )
    relist = api.as_user(admin).post(f"/admin/places/{place.id}/relist", json={})
    assert relist.status_code == 200, relist.text
    assert relist.json()["delist_reason"] is None

    pub = api.get(f"/places/{place.id}")
    assert pub.status_code == 200, pub.text
    assert pub.json()["is_deleted"] is False
    assert pub.json()["delist_reason"] is None


def test_relist_non_delisted_conflicts(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()
    db_session.commit()

    resp = api.as_user(admin).post(f"/admin/places/{place.id}/relist", json={})
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_DELISTED"


def test_delist_requires_reason(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()
    db_session.commit()

    resp = api.as_user(admin).post(f"/admin/places/{place.id}/delist", json={})
    assert resp.status_code == 422, resp.text


def test_delisted_place_excluded_from_search(api, factories, db_session):
    admin = factories.admin()
    place = factories.place(name="Zzql Unique Delist Diner")
    db_session.commit()

    before = api.get("/places", params={"q": "Zzql Unique Delist"})
    assert any(r["id"] == str(place.id) for r in before.json())

    api.as_user(admin).post(
        f"/admin/places/{place.id}/delist", json={"reason": "NOT_HALAL"}
    )
    after = api.get("/places", params={"q": "Zzql Unique Delist"})
    assert all(r["id"] != str(place.id) for r in after.json())


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------


def test_delist_writes_timeline_events(api, factories, db_session):
    admin, _, place, _ = _approve_claim_for_place(api, factories, db_session)

    api.as_user(admin).post(
        f"/admin/places/{place.id}/delist", json={"reason": "NOT_HALAL", "note": "secret"}
    )
    db_session.expire_all()

    # Profile timeline (consumer-facing) got a DELISTED row.
    assert HalalProfileEventType.DELISTED.value in _profile_event_types(
        db_session, place.id
    )

    # Public history endpoint surfaces it — de-listed places still serve history.
    hist = api.get(f"/places/{place.id}/halal-history")
    assert hist.status_code == 200, hist.text
    delisted = [e for e in hist.json() if e["event_type"] == "DELISTED"]
    assert delisted, hist.text
    # Public-safe: reason label present, the free-text note is NOT leaked.
    assert "secret" not in (delisted[0]["description"] or "")


def test_dispute_shows_in_history_on_unprofiled_place(api, factories, db_session):
    """A dispute against an unclaimed place (no halal profile) must still
    appear on the public trust history — sourced from the dispute row, not
    profile events."""
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()  # no claim -> no halal profile
    db_session.commit()

    filed = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={"disputed_attribute": "PORK_SERVED", "description": "Pork on the grill."},
    )
    dispute_id = filed.json()["id"]
    api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={"decision": "RESOLVED_UPHELD"},
    )

    hist = api.get(f"/places/{place.id}/halal-history")
    assert hist.status_code == 200, hist.text
    types = [e["event_type"] for e in hist.json()]
    assert "DISPUTE_OPENED" in types
    resolved = [e for e in hist.json() if e["event_type"] == "DISPUTE_RESOLVED"]
    assert resolved, hist.text
    assert resolved[0]["dispute_category"] == "PORK_SERVED"
    assert resolved[0]["dispute_outcome"] == "UPHELD"


def test_dispute_resolved_event_carries_category_and_outcome(
    api, factories, db_session
):
    admin, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer = factories.consumer()
    db_session.commit()

    filed = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={"disputed_attribute": "PORK_SERVED", "description": "Pork on the buffet."},
    )
    dispute_id = filed.json()["id"]
    api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={"decision": "RESOLVED_UPHELD"},
    )

    hist = api.get(f"/places/{place.id}/halal-history").json()
    resolved = [e for e in hist if e["event_type"] == "DISPUTE_RESOLVED"]
    assert resolved, hist
    assert resolved[0]["dispute_category"] == "PORK_SERVED"
    assert resolved[0]["dispute_outcome"] == "UPHELD"


# ---------------------------------------------------------------------------
# De-list escalation from dispute resolution
# ---------------------------------------------------------------------------


def test_resolve_with_delist_escalation(api, factories, db_session):
    admin, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer = factories.consumer()
    db_session.commit()

    filed = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={"disputed_attribute": "MENU_POSTURE_INCORRECT", "description": "Not halal at all."},
    )
    dispute_id = filed.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={
            "decision": "RESOLVED_UPHELD",
            "delist": {"reason": "NOT_HALAL", "note": "Verifier confirmed."},
        },
    )
    assert resp.status_code == 200, resp.text

    # Place is now a tombstone.
    pub = api.get(f"/places/{place.id}")
    assert pub.status_code == 200
    assert pub.json()["delist_reason"] == "NOT_HALAL"


def test_delist_escalation_rejected_on_dismiss(api, factories, db_session):
    admin, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer = factories.consumer()
    db_session.commit()

    filed = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={"disputed_attribute": "OTHER", "description": "Some concern here."},
    )
    dispute_id = filed.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={
            "decision": "RESOLVED_DISMISSED",
            "admin_decision_note": "Owner provided the certificate.",
            "delist": {"reason": "NOT_HALAL"},
        },
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "DISPUTE_DELIST_REQUIRES_UPHELD"
    # Dispute was not resolved, place not removed.
    pub = api.get(f"/places/{place.id}")
    assert pub.status_code == 200
    assert pub.json()["is_deleted"] is False
