"""Audit-trail integration tests for halal claims.

Phase 6.1 wired ``HalalClaimEvent`` rows into every meaningful state
transition. These tests pin that contract end-to-end:

  * Owner DRAFT_CREATED on create + batch-create.
  * Owner SUBMITTED on submit.
  * Owner ATTACHMENT_ADDED on each upload.
  * Admin APPROVED / REJECTED / INFO_REQUESTED / REVOKED on the four
    decision endpoints.
  * SUPERSEDED on a prior approved claim when a fresh approval lands.
  * GET /me/halal-claims/{id}/events returns the timeline (owner-side).
  * GET /admin/halal-claims/{id}/events returns it (admin-side).

These tests don't re-cover the lifecycle itself — that lives in
``test_owner_halal_claims.py`` and ``test_admin_halal_claims.py``.
The focus here is "every transition writes an event."
"""
from __future__ import annotations

from io import BytesIO

import pytest
from sqlalchemy import select

from app.core.storage import get_storage_client
from app.modules.halal_claims.enums import (
    HalalClaimEventType,
    HalalClaimStatus,
)
from app.modules.halal_claims.models import HalalClaim, HalalClaimEvent
from app.modules.places.models import PlaceEvent


# ---------------------------------------------------------------------------
# Storage fake (same shape as the lifecycle test files).
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

    def delete_object(self, path: str) -> None:
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


def _events_for(db_session, claim_id) -> list[HalalClaimEvent]:
    return list(
        db_session.execute(
            select(HalalClaimEvent)
            .where(HalalClaimEvent.claim_id == claim_id)
            .order_by(HalalClaimEvent.created_at)
        )
        .scalars()
        .all()
    )


def _event_types(db_session, claim_id) -> list[str]:
    return [e.event_type for e in _events_for(db_session, claim_id)]


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


# ---------------------------------------------------------------------------
# Owner-side transitions
# ---------------------------------------------------------------------------


def test_create_logs_draft_created(api, factories, db_session):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
        },
    )
    assert resp.status_code == 201, resp.text
    claim_id = resp.json()["id"]

    types = _event_types(db_session, claim_id)
    assert types == [HalalClaimEventType.DRAFT_CREATED.value]

    rows = _events_for(db_session, claim_id)
    assert rows[0].actor_user_id == owner.id
    assert rows[0].description and "started" in rows[0].description.lower()


def test_batch_create_logs_one_event_per_claim(api, factories, db_session):
    owner = factories.owner()
    # Two places under the same org so one batch can fan out across
    # them. ``managed_place`` doesn't accept an existing org, so we
    # set up the second place manually using the same primitives.
    place_a, org = factories.managed_place(owner=owner)
    place_b = factories.place()
    factories.place_owner_link(place=place_b, organization=org)
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/halal-claims/batch",
        json={
            "selections": [
                {
                    "place_id": str(place_a.id),
                    "organization_id": str(org.id),
                },
                {
                    "place_id": str(place_b.id),
                    "organization_id": str(org.id),
                },
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert len(body) == 2

    for row in body:
        types = _event_types(db_session, row["id"])
        assert types == [HalalClaimEventType.DRAFT_CREATED.value]


def test_submit_logs_submitted(api, factories, db_session):
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
    submit_resp = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/submit"
    )
    assert submit_resp.status_code == 200, submit_resp.text

    types = _event_types(db_session, claim_id)
    assert types == [
        HalalClaimEventType.DRAFT_CREATED.value,
        HalalClaimEventType.SUBMITTED.value,
    ]

    # Submit also cross-writes a HALAL_CLAIM_SUBMITTED row to the
    # place's audit trail so the place detail page picks it up.
    place_types = _place_event_types(db_session, place.id)
    assert "HALAL_CLAIM_SUBMITTED" in place_types


def test_upload_logs_attachment_added(
    api, factories, db_session, fake_storage
):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
        },
    )
    claim_id = create_resp.json()["id"]

    upload_resp = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/attachments",
        files={
            "file": (
                "cert.pdf",
                BytesIO(b"%PDF-1.4 fake"),
                "application/pdf",
            )
        },
        data={"document_type": "HALAL_CERTIFICATE"},
    )
    assert upload_resp.status_code == 201, upload_resp.text

    types = _event_types(db_session, claim_id)
    assert types == [
        HalalClaimEventType.DRAFT_CREATED.value,
        HalalClaimEventType.ATTACHMENT_ADDED.value,
    ]

    rows = _events_for(db_session, claim_id)
    assert "HALAL_CERTIFICATE" in (rows[-1].description or "")


# ---------------------------------------------------------------------------
# Admin decision transitions
# ---------------------------------------------------------------------------


def _submit_pending_claim(api, factories, db_session):
    """Helper — owner creates + submits a complete claim."""
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
    return owner, place, org, claim_id


def test_admin_approve_logs_approved(api, factories, db_session):
    admin = factories.admin()
    _, place, _, claim_id = _submit_pending_claim(api, factories, db_session)

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={
            "validation_tier": "SELF_ATTESTED",
            "decision_note": "Looks fine.",
        },
    )
    assert resp.status_code == 200, resp.text

    types = _event_types(db_session, claim_id)
    assert HalalClaimEventType.APPROVED.value in types
    rows = _events_for(db_session, claim_id)
    approved = next(
        e for e in rows if e.event_type == HalalClaimEventType.APPROVED.value
    )
    assert approved.actor_user_id == admin.id
    assert "Looks fine." in (approved.description or "")
    assert "SELF_ATTESTED" in (approved.description or "")

    # Cross-write to the place's audit trail.
    place_types = _place_event_types(db_session, place.id)
    assert "HALAL_CLAIM_APPROVED" in place_types


def test_admin_reject_logs_rejected(api, factories, db_session):
    admin = factories.admin()
    _, place, _, claim_id = _submit_pending_claim(api, factories, db_session)

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/reject",
        json={"decision_note": "Cert appears expired."},
    )
    assert resp.status_code == 200, resp.text

    types = _event_types(db_session, claim_id)
    assert HalalClaimEventType.REJECTED.value in types
    rows = _events_for(db_session, claim_id)
    rejected = next(
        e for e in rows if e.event_type == HalalClaimEventType.REJECTED.value
    )
    assert "Cert appears expired." in (rejected.description or "")

    place_types = _place_event_types(db_session, place.id)
    assert "HALAL_CLAIM_REJECTED" in place_types


def test_admin_request_info_logs_info_requested(api, factories, db_session):
    admin = factories.admin()
    _, place, _, claim_id = _submit_pending_claim(api, factories, db_session)

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/request-info",
        json={"decision_note": "Please upload current cert."},
    )
    assert resp.status_code == 200, resp.text

    types = _event_types(db_session, claim_id)
    assert HalalClaimEventType.INFO_REQUESTED.value in types

    place_types = _place_event_types(db_session, place.id)
    assert "HALAL_CLAIM_NEEDS_INFO" in place_types


def test_admin_revoke_logs_revoked(api, factories, db_session):
    admin = factories.admin()
    _, place, _, claim_id = _submit_pending_claim(api, factories, db_session)

    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={"validation_tier": "SELF_ATTESTED"},
    )
    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/revoke",
        json={"decision_note": "Restaurant closed."},
    )
    assert resp.status_code == 200, resp.text

    types = _event_types(db_session, claim_id)
    assert HalalClaimEventType.APPROVED.value in types
    assert HalalClaimEventType.REVOKED.value in types

    place_types = _place_event_types(db_session, place.id)
    assert "HALAL_CLAIM_APPROVED" in place_types
    assert "HALAL_CLAIM_REVOKED" in place_types


def test_supersession_logs_event_on_prior_claim(
    api, factories, db_session
):
    """When an admin approves a fresh claim for a place that already
    has an APPROVED claim, the prior claim flips to SUPERSEDED and we
    write a SUPERSEDED event row on the prior claim's timeline."""
    admin = factories.admin()
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    # First claim — submit + approve.
    first_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
            "structured_response": COMPLETE_QUESTIONNAIRE,
        },
    )
    first_id = first_resp.json()["id"]
    api.as_user(owner).post(f"/me/halal-claims/{first_id}/submit")
    api.as_user(admin).post(
        f"/admin/halal-claims/{first_id}/approve",
        json={"validation_tier": "SELF_ATTESTED"},
    )

    # Second claim on the same place — submit + approve. Should
    # supersede the first.
    second_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
            "structured_response": COMPLETE_QUESTIONNAIRE,
        },
    )
    second_id = second_resp.json()["id"]
    api.as_user(owner).post(f"/me/halal-claims/{second_id}/submit")
    api.as_user(admin).post(
        f"/admin/halal-claims/{second_id}/approve",
        json={"validation_tier": "SELF_ATTESTED"},
    )

    db_session.expire_all()
    first = db_session.execute(
        select(HalalClaim).where(HalalClaim.id == first_id)
    ).scalar_one()
    assert first.status == HalalClaimStatus.SUPERSEDED.value

    types = _event_types(db_session, first_id)
    assert HalalClaimEventType.SUPERSEDED.value in types

    # Place audit trail picks up the supersession too.
    place_types = _place_event_types(db_session, place.id)
    assert "HALAL_CLAIM_SUPERSEDED" in place_types


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------


def test_owner_events_endpoint_returns_full_timeline(
    api, factories, db_session
):
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

    resp = api.as_user(owner).get(f"/me/halal-claims/{claim_id}/events")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    types = [e["event_type"] for e in body]
    assert types == [
        HalalClaimEventType.DRAFT_CREATED.value,
        HalalClaimEventType.SUBMITTED.value,
    ]


def test_owner_events_endpoint_404s_unknown_claim(
    api, factories, db_session
):
    owner = factories.owner()
    db_session.commit()
    resp = api.as_user(owner).get(
        "/me/halal-claims/00000000-0000-0000-0000-000000000000/events"
    )
    assert resp.status_code == 404


def test_owner_events_endpoint_403s_other_users_claim(
    api, factories, db_session
):
    owner_a = factories.owner()
    owner_b = factories.owner()
    place, org = factories.managed_place(owner=owner_a)
    db_session.commit()

    create_resp = api.as_user(owner_a).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
        },
    )
    claim_id = create_resp.json()["id"]

    resp = api.as_user(owner_b).get(
        f"/me/halal-claims/{claim_id}/events"
    )
    assert resp.status_code == 403


def test_admin_events_endpoint_returns_full_timeline(
    api, factories, db_session
):
    admin = factories.admin()
    _, _, _, claim_id = _submit_pending_claim(api, factories, db_session)

    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={"validation_tier": "SELF_ATTESTED"},
    )

    resp = api.as_user(admin).get(
        f"/admin/halal-claims/{claim_id}/events"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    types = [e["event_type"] for e in body]
    assert types == [
        HalalClaimEventType.DRAFT_CREATED.value,
        HalalClaimEventType.SUBMITTED.value,
        HalalClaimEventType.APPROVED.value,
    ]
