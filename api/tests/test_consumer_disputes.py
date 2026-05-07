"""Integration tests for the consumer-dispute flow.

Phase 7 of the halal-trust v2 rebuild. Covers:

  * POST /places/{place_id}/disputes — file
  * GET /me/disputes (+ /{id}) — reporter views
  * POST /me/disputes/{id}/withdraw
  * POST /me/disputes/{id}/attachments — evidence upload
  * GET /admin/disputes (+ /{id}) — admin queue + detail
  * POST /admin/disputes/{id}/resolve — uphold / dismiss
  * POST /admin/disputes/{id}/request-owner-reconciliation
  * GET /admin/disputes/{id}/attachments + /url — signed URL flow

Profile-state side effects are pinned alongside the lifecycle —
filing a dispute on a place that has a HalalProfile flips the
profile's `dispute_state` to DISPUTED and writes a
`HalalProfileEvent`; resolution / withdrawal flips it back to NONE
once no other active disputes remain. These are the "did the audit
trail land" assertions that future contributors will lean on when
refactoring the workflow.
"""
from __future__ import annotations

from io import BytesIO

import pytest
from sqlalchemy import select

from app.core.storage import get_storage_client
from app.modules.disputes.enums import DisputeStatus, DisputedAttribute
from app.modules.disputes.models import ConsumerDispute
from app.modules.halal_profiles.enums import (
    HalalProfileDisputeState,
    HalalProfileEventType,
)
from app.modules.halal_profiles.models import HalalProfile, HalalProfileEvent
from app.modules.places.models import PlaceEvent


# ---------------------------------------------------------------------------
# Storage fake — matches the shape used elsewhere in the test suite.
# ---------------------------------------------------------------------------
class _FakeStorageClient:
    bucket = "evidence-test"

    def __init__(self) -> None:
        self.uploaded: dict[str, tuple[bytes, str]] = {}
        self.signed_urls: list[tuple[str, int]] = []
        self.deleted: list[str] = []

    def upload_bytes(self, path: str, data: bytes, *, content_type: str) -> None:
        self.uploaded[path] = (data, content_type)

    def signed_url(self, path: str, *, expires_in_seconds: int) -> str:
        self.signed_urls.append((path, expires_in_seconds))
        return f"https://fake-storage.local/{self.bucket}/{path}?token=stub"

    def delete_object(self, path: str) -> None:  # pragma: no cover
        self.deleted.append(path)


@pytest.fixture
def fake_storage():
    from app.main import app as fastapi_app

    fake = _FakeStorageClient()
    fastapi_app.dependency_overrides[get_storage_client] = lambda: fake
    try:
        yield fake
    finally:
        fastapi_app.dependency_overrides.pop(get_storage_client, None)


# A complete questionnaire that satisfies the strict shape — used
# only in the `_approve_claim_for_place` helper to materialize a
# HalalProfile so we can assert dispute_state transitions.
COMPLETE_QUESTIONNAIRE: dict = {
    "questionnaire_version": 1,
    "menu_posture": "FULLY_HALAL",
    "has_pork": False,
    "alcohol_policy": "NONE",
    "alcohol_in_cooking": False,
    "meat_products": [
        {
            "meat_type": "CHICKEN",
            "product_name": "Chicken",
            "slaughter_method": "ZABIHAH",
        },
        {
            "meat_type": "BEEF",
            "product_name": "Beef",
            "slaughter_method": "ZABIHAH",
        },
    ],
    "seafood_only": False,
    "has_certification": True,
    "certifying_body_name": "IFANCA",
    "caveats": None,
}


def _approve_claim_for_place(api, factories, db_session):
    """Helper: provision a place + verified org + owner + admin,
    submit a halal claim, approve it. Returns
    ``(admin, owner, place, org)``. Used by tests that need a place
    with a live HalalProfile (so they can assert dispute_state
    transitions).
    """
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


def _profile_state_for(db_session, place_id) -> str | None:
    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place_id)
    ).scalar_one_or_none()
    return profile.dispute_state if profile else None


def _place_event_types(db_session, place_id) -> list[str]:
    return list(
        db_session.execute(
            select(PlaceEvent.event_type)
            .where(PlaceEvent.place_id == place_id)
            .order_by(PlaceEvent.created_at)
        )
        .scalars()
        .all()
    )


def _profile_event_types(db_session, place_id) -> list[str]:
    rows = db_session.execute(
        select(HalalProfileEvent.event_type)
        .join(HalalProfile, HalalProfile.id == HalalProfileEvent.profile_id)
        .where(HalalProfile.place_id == place_id)
        .order_by(HalalProfileEvent.created_at)
    ).scalars().all()
    return list(rows)


# ---------------------------------------------------------------------------
# Consumer file path
# ---------------------------------------------------------------------------


def test_file_dispute_happy_path_no_profile(api, factories, db_session):
    """A consumer can dispute a place that has no halal profile yet.
    The dispute lands but no profile-state flip happens (there's no
    profile to flip)."""
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()

    resp = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "ALCOHOL_PRESENT",
            "description": "Saw a full bar in the back when I visited.",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == DisputeStatus.OPEN.value
    assert body["disputed_attribute"] == DisputedAttribute.ALCOHOL_PRESENT.value
    assert body["place_id"] == str(place.id)

    # No profile, so no profile_state to assert. Place trail still
    # captures the DISPUTE_OPENED row.
    assert "DISPUTE_OPENED" in _place_event_types(db_session, place.id)


def test_file_dispute_flips_profile_state_when_profile_exists(
    api, factories, db_session
):
    _, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer = factories.consumer()
    db_session.commit()

    assert _profile_state_for(db_session, place.id) == HalalProfileDisputeState.NONE.value

    resp = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "PORK_SERVED",
            "description": "Found pork on the buffet line during my visit.",
        },
    )
    assert resp.status_code == 201, resp.text

    db_session.expire_all()
    assert (
        _profile_state_for(db_session, place.id)
        == HalalProfileDisputeState.DISPUTED.value
    )
    profile_events = _profile_event_types(db_session, place.id)
    assert HalalProfileEventType.DISPUTE_OPENED.value in profile_events
    place_events = _place_event_types(db_session, place.id)
    assert "DISPUTE_OPENED" in place_events


def test_file_dispute_404s_unknown_place(api, factories, db_session):
    consumer = factories.consumer()
    db_session.commit()
    resp = api.as_user(consumer).post(
        "/places/00000000-0000-0000-0000-000000000000/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Some description that's at least ten characters.",
        },
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


def test_file_dispute_404s_soft_deleted_place(api, factories, db_session):
    consumer = factories.consumer()
    place = factories.place()
    place.is_deleted = True
    db_session.commit()
    resp = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "PLACE_CLOSED",
            "description": "Restaurant has been closed for months now.",
        },
    )
    assert resp.status_code == 404


def test_file_dispute_rejects_short_description(api, factories, db_session):
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    resp = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "too short",  # 9 chars; min_length=10
        },
    )
    assert resp.status_code == 422


def test_file_dispute_duplicate_blocked(api, factories, db_session):
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    payload = {
        "disputed_attribute": "PORK_SERVED",
        "description": "Saw pork on the menu when I visited last week.",
    }
    first = api.as_user(consumer).post(
        f"/places/{place.id}/disputes", json=payload
    )
    assert first.status_code == 201
    dup = api.as_user(consumer).post(
        f"/places/{place.id}/disputes", json=payload
    )
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "CONSUMER_DISPUTE_DUPLICATE"


def test_file_dispute_different_attribute_allowed_same_place(
    api, factories, db_session
):
    """Duplicate guard scopes per (place, attribute) — a consumer can
    file separate disputes for separate attributes on the same place."""
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    a = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "PORK_SERVED",
            "description": "Pork on the menu, clearly labeled.",
        },
    )
    assert a.status_code == 201
    b = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "ALCOHOL_PRESENT",
            "description": "Also there's a full bar I missed first time.",
        },
    )
    assert b.status_code == 201


# ---------------------------------------------------------------------------
# Reporter views
# ---------------------------------------------------------------------------


def test_list_my_disputes_scopes_to_caller(api, factories, db_session):
    consumer_a = factories.consumer()
    consumer_b = factories.consumer()
    place = factories.place()
    db_session.commit()

    api.as_user(consumer_a).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "PORK_SERVED",
            "description": "Reporter A sees pork on the buffet.",
        },
    )
    api.as_user(consumer_b).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "ALCOHOL_PRESENT",
            "description": "Reporter B notices wine pairings on the menu.",
        },
    )

    resp_a = api.as_user(consumer_a).get("/me/disputes")
    assert resp_a.status_code == 200
    assert len(resp_a.json()) == 1
    assert resp_a.json()[0]["disputed_attribute"] == "PORK_SERVED"

    resp_b = api.as_user(consumer_b).get("/me/disputes")
    assert len(resp_b.json()) == 1
    assert resp_b.json()[0]["disputed_attribute"] == "ALCOHOL_PRESENT"


def test_get_my_dispute_403s_other_users_dispute(api, factories, db_session):
    consumer_a = factories.consumer()
    consumer_b = factories.consumer()
    place = factories.place()
    db_session.commit()
    create_resp = api.as_user(consumer_a).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Reporter A files a description here.",
        },
    )
    dispute_id = create_resp.json()["id"]
    resp = api.as_user(consumer_b).get(f"/me/disputes/{dispute_id}")
    assert resp.status_code == 403


def test_get_my_dispute_404s_unknown(api, factories, db_session):
    consumer = factories.consumer()
    db_session.commit()
    resp = api.as_user(consumer).get(
        "/me/disputes/00000000-0000-0000-0000-000000000000"
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Withdraw
# ---------------------------------------------------------------------------


def test_withdraw_open_dispute_clears_profile_state(api, factories, db_session):
    _, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer = factories.consumer()
    db_session.commit()

    create_resp = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "ALCOHOL_PRESENT",
            "description": "Filed and then changed my mind on this.",
        },
    )
    dispute_id = create_resp.json()["id"]
    db_session.expire_all()
    assert (
        _profile_state_for(db_session, place.id)
        == HalalProfileDisputeState.DISPUTED.value
    )

    resp = api.as_user(consumer).post(f"/me/disputes/{dispute_id}/withdraw")
    assert resp.status_code == 200
    assert resp.json()["status"] == DisputeStatus.WITHDRAWN.value

    db_session.expire_all()
    # No other active disputes — badge clears.
    assert (
        _profile_state_for(db_session, place.id)
        == HalalProfileDisputeState.NONE.value
    )
    # DISPUTE_RESOLVED rows on both audit surfaces.
    assert (
        HalalProfileEventType.DISPUTE_RESOLVED.value
        in _profile_event_types(db_session, place.id)
    )
    assert "DISPUTE_RESOLVED" in _place_event_types(db_session, place.id)


def test_withdraw_keeps_badge_when_other_disputes_active(
    api, factories, db_session
):
    """If a second consumer also has an OPEN dispute on the same
    place, withdrawing the first should NOT clear the DISPUTED badge."""
    _, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer_a = factories.consumer()
    consumer_b = factories.consumer()
    db_session.commit()

    a_resp = api.as_user(consumer_a).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "PORK_SERVED",
            "description": "Reporter A — saw pork on the menu.",
        },
    )
    dispute_a_id = a_resp.json()["id"]
    api.as_user(consumer_b).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "ALCOHOL_PRESENT",
            "description": "Reporter B — full bar in operation.",
        },
    )

    api.as_user(consumer_a).post(f"/me/disputes/{dispute_a_id}/withdraw")
    db_session.expire_all()

    # Reporter B's dispute is still OPEN — badge stays on.
    assert (
        _profile_state_for(db_session, place.id)
        == HalalProfileDisputeState.DISPUTED.value
    )


def test_withdraw_blocked_after_admin_reviewing(api, factories, db_session):
    """Once admin moves the dispute to OWNER_RECONCILING (or further),
    the consumer can no longer withdraw."""
    admin, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer = factories.consumer()
    db_session.commit()

    create_resp = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "MENU_POSTURE_INCORRECT",
            "description": "Place advertises fully halal but it's mixed.",
        },
    )
    dispute_id = create_resp.json()["id"]
    api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/request-owner-reconciliation",
        json={"admin_decision_note": "Owner please file reconciliation."},
    )

    resp = api.as_user(consumer).post(f"/me/disputes/{dispute_id}/withdraw")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONSUMER_DISPUTE_NOT_WITHDRAWABLE"


# ---------------------------------------------------------------------------
# Attachment upload
# ---------------------------------------------------------------------------


def test_upload_dispute_attachment_happy_path(
    api, factories, db_session, fake_storage
):
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()

    create_resp = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Reporting a thing with photo evidence.",
        },
    )
    dispute_id = create_resp.json()["id"]

    upload = api.as_user(consumer).post(
        f"/me/disputes/{dispute_id}/attachments",
        files={
            "file": (
                "menu.jpg",
                BytesIO(b"\xff\xd8\xff fake jpeg bytes"),
                "image/jpeg",
            )
        },
    )
    assert upload.status_code == 201, upload.text
    body = upload.json()
    assert body["original_filename"] == "menu.jpg"
    assert body["dispute_id"] == dispute_id
    assert len(fake_storage.uploaded) == 1


def test_upload_dispute_attachment_rejects_disallowed_mime(
    api, factories, db_session, fake_storage
):
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    dispute_id = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Description that's clearly long enough.",
        },
    ).json()["id"]

    resp = api.as_user(consumer).post(
        f"/me/disputes/{dispute_id}/attachments",
        files={"file": ("doc.txt", BytesIO(b"not a photo"), "text/plain")},
    )
    assert resp.status_code == 400
    assert (
        resp.json()["error"]["code"]
        == "CONSUMER_DISPUTE_ATTACHMENT_TYPE_NOT_ALLOWED"
    )


def test_upload_dispute_attachment_blocked_after_resolution(
    api, factories, db_session, fake_storage
):
    admin, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer = factories.consumer()
    db_session.commit()

    dispute_id = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Original report description here.",
        },
    ).json()["id"]
    api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={
            "decision": "RESOLVED_DISMISSED",
            "admin_decision_note": "Insufficient evidence.",
        },
    )

    resp = api.as_user(consumer).post(
        f"/me/disputes/{dispute_id}/attachments",
        files={
            "file": (
                "after-the-fact.jpg",
                BytesIO(b"\xff\xd8\xff bytes"),
                "image/jpeg",
            )
        },
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONSUMER_DISPUTE_NOT_EDITABLE"


# ---------------------------------------------------------------------------
# Admin review surface
# ---------------------------------------------------------------------------


def test_admin_list_disputes_filters_by_status(api, factories, db_session):
    admin = factories.admin()
    consumer = factories.consumer()
    place_a = factories.place()
    place_b = factories.place()
    db_session.commit()

    api.as_user(consumer).post(
        f"/places/{place_a.id}/disputes",
        json={
            "disputed_attribute": "PORK_SERVED",
            "description": "Reporter sees pork at place A here.",
        },
    )
    b_resp = api.as_user(consumer).post(
        f"/places/{place_b.id}/disputes",
        json={
            "disputed_attribute": "ALCOHOL_PRESENT",
            "description": "Reporter sees alcohol at place B too.",
        },
    )
    api.as_user(consumer).post(
        f"/me/disputes/{b_resp.json()['id']}/withdraw"
    )

    open_only = api.as_user(admin).get("/admin/disputes?status=OPEN")
    assert open_only.status_code == 200
    open_ids = {row["id"] for row in open_only.json()}
    assert b_resp.json()["id"] not in open_ids  # withdrawn excluded


def test_admin_list_disputes_filters_by_place(api, factories, db_session):
    admin = factories.admin()
    consumer = factories.consumer()
    place_a = factories.place()
    place_b = factories.place()
    db_session.commit()
    api.as_user(consumer).post(
        f"/places/{place_a.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Reporter A on place A here please.",
        },
    )
    api.as_user(consumer).post(
        f"/places/{place_b.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Reporter A on place B as well today.",
        },
    )
    resp = api.as_user(admin).get(f"/admin/disputes?place_id={place_a.id}")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["place_id"] == str(place_a.id)


def test_admin_can_get_single_dispute_with_reporter_id(
    api, factories, db_session
):
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    create_resp = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Reporter is making a complaint here.",
        },
    )
    dispute_id = create_resp.json()["id"]

    resp = api.as_user(admin).get(f"/admin/disputes/{dispute_id}")
    assert resp.status_code == 200
    body = resp.json()
    # Admin shape exposes reporter identity (consumer-self shape and
    # owner shape don't — but admin does).
    assert body["reporter_user_id"] == str(consumer.id)


def test_consumer_403s_admin_endpoint(api, factories, db_session):
    consumer = factories.consumer()
    db_session.commit()
    resp = api.as_user(consumer).get("/admin/disputes")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Admin resolve
# ---------------------------------------------------------------------------


def test_admin_resolve_uphold_clears_profile_state(api, factories, db_session):
    admin, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer = factories.consumer()
    db_session.commit()

    dispute_id = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "PORK_SERVED",
            "description": "Reporter saw pork on the menu.",
        },
    ).json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={
            "decision": "RESOLVED_UPHELD",
            "admin_decision_note": "Verified — pork is on the menu.",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == DisputeStatus.RESOLVED_UPHELD.value
    assert resp.json()["decided_by_user_id"] == str(admin.id)

    db_session.expire_all()
    assert (
        _profile_state_for(db_session, place.id)
        == HalalProfileDisputeState.NONE.value
    )
    place_events = _place_event_types(db_session, place.id)
    assert "DISPUTE_OPENED" in place_events
    assert "DISPUTE_RESOLVED" in place_events


def test_admin_resolve_dismiss(api, factories, db_session):
    admin, _, place, _ = _approve_claim_for_place(api, factories, db_session)
    consumer = factories.consumer()
    db_session.commit()
    dispute_id = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Reporter complaint that doesn't pan out.",
        },
    ).json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={
            "decision": "RESOLVED_DISMISSED",
            "admin_decision_note": "Couldn't verify the claim.",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == DisputeStatus.RESOLVED_DISMISSED.value


def test_admin_resolve_rejects_non_terminal_decision(
    api, factories, db_session
):
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    dispute_id = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "A description that's long enough here.",
        },
    ).json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={
            "decision": "OPEN",  # not a valid terminal state
            "admin_decision_note": "trying something silly",
        },
    )
    # Repo defensive check raises ConflictError → 409
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONSUMER_DISPUTE_BAD_DECISION"


def test_admin_resolve_blocks_already_resolved(api, factories, db_session):
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    dispute_id = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Initial complaint goes here for testing.",
        },
    ).json()["id"]

    api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={
            "decision": "RESOLVED_DISMISSED",
            "admin_decision_note": "Done.",
        },
    )
    second = api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/resolve",
        json={
            "decision": "RESOLVED_UPHELD",
            "admin_decision_note": "Trying again.",
        },
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "CONSUMER_DISPUTE_NOT_RESOLVABLE"


# ---------------------------------------------------------------------------
# Admin: request owner reconciliation
# ---------------------------------------------------------------------------


def test_admin_request_owner_reconciliation_moves_status(
    api, factories, db_session
):
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    dispute_id = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "MENU_POSTURE_INCORRECT",
            "description": "Place advertises a stricter posture than reality.",
        },
    ).json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/request-owner-reconciliation",
        json={"admin_decision_note": "Owner should file reconciliation."},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == DisputeStatus.OWNER_RECONCILING.value
    assert "Owner should file" in (resp.json()["admin_decision_note"] or "")


def test_admin_request_reconciliation_idempotent(api, factories, db_session):
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    dispute_id = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Description that's long enough certainly.",
        },
    ).json()["id"]
    first = api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/request-owner-reconciliation",
        json={"admin_decision_note": "First call."},
    )
    second = api.as_user(admin).post(
        f"/admin/disputes/{dispute_id}/request-owner-reconciliation",
        json={"admin_decision_note": "Second call — idempotent."},
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["status"] == DisputeStatus.OWNER_RECONCILING.value


# ---------------------------------------------------------------------------
# Admin attachment signed-URL flow
# ---------------------------------------------------------------------------


def test_admin_can_mint_signed_url_for_dispute_attachment(
    api, factories, db_session, fake_storage
):
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    db_session.commit()
    dispute_id = api.as_user(consumer).post(
        f"/places/{place.id}/disputes",
        json={
            "disputed_attribute": "OTHER",
            "description": "Dispute with attached evidence file.",
        },
    ).json()["id"]
    upload = api.as_user(consumer).post(
        f"/me/disputes/{dispute_id}/attachments",
        files={
            "file": (
                "evidence.pdf",
                BytesIO(b"%PDF-1.4 fake"),
                "application/pdf",
            )
        },
    )
    attachment_id = upload.json()["id"]

    list_resp = api.as_user(admin).get(
        f"/admin/disputes/{dispute_id}/attachments"
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    url_resp = api.as_user(admin).get(
        f"/admin/disputes/{dispute_id}/attachments/{attachment_id}/url"
    )
    assert url_resp.status_code == 200
    body = url_resp.json()
    assert body["expires_in_seconds"] == 60
    assert "fake-storage.local" in body["url"]
    # Storage fake recorded the signed-URL request.
    assert len(fake_storage.signed_urls) == 1
