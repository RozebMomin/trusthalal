"""Integration tests for admin halal-claim review + profile derivation.

Covers Phase 3 of the halal-trust v2 rebuild. Owner-side submission
plumbing (test_owner_halal_claims.py) is a prereq — these tests
build on the same flow: owner submits → admin decides.

Decision endpoints exercised:
  * /admin/halal-claims (list with filters)
  * /admin/halal-claims/{id} (detail)
  * /admin/halal-claims/{id}/approve
  * /admin/halal-claims/{id}/reject
  * /admin/halal-claims/{id}/request-info
  * /admin/halal-claims/{id}/revoke
  * /admin/halal-claims/{id}/attachments + signed-URL endpoint

Profile derivation is the load-bearing assertion in the approve
tests — we check that the HalalProfile materializes (or updates),
that the source_claim_id is set, that the audit event row lands,
and that supersession of older approvals works.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from sqlalchemy import select

from app.core.storage import get_storage_client
from app.modules.halal_claims.enums import HalalClaimStatus
from app.modules.halal_claims.models import HalalClaim
from app.modules.halal_profiles.enums import (
    AlcoholPolicy,
    HalalProfileDisputeState,
    HalalProfileEventType,
    MenuPosture,
    SlaughterMethod,
    ValidationTier,
)
from app.modules.halal_profiles.models import HalalProfile, HalalProfileEvent


# Storage fake — same shape as the other admin attachment suites.
class _FakeStorageClient:
    bucket = "evidence-test"

    def __init__(self) -> None:
        self.uploaded: dict[str, tuple[bytes, str]] = {}
        self.signed_urls: list[tuple[str, int]] = []

    def upload_bytes(self, path: str, data: bytes, *, content_type: str) -> None:
        self.uploaded[path] = (data, content_type)

    def signed_url(self, path: str, *, expires_in_seconds: int) -> str:
        self.signed_urls.append((path, expires_in_seconds))
        return f"https://fake-storage.local/{self.bucket}/{path}?token=stub"

    def delete_object(self, path: str) -> None:  # pragma: no cover
        pass


@pytest.fixture
def fake_storage():
    from app.main import app as fastapi_app

    fake = _FakeStorageClient()
    fastapi_app.dependency_overrides[get_storage_client] = lambda: fake
    try:
        yield fake
    finally:
        fastapi_app.dependency_overrides.pop(get_storage_client, None)


# Lifted from test_owner_halal_claims so submitting a complete
# claim is a one-liner.
COMPLETE_QUESTIONNAIRE: dict = {
    "questionnaire_version": 1,
    "menu_posture": "FULLY_HALAL",
    "has_pork": False,
    "alcohol_policy": "NONE",
    "alcohol_in_cooking": False,
    "chicken": {"slaughter_method": "ZABIHAH"},
    "beef": {"slaughter_method": "ZABIHAH"},
    "lamb": {"slaughter_method": "NOT_SERVED"},
    "goat": {"slaughter_method": "NOT_SERVED"},
    "seafood_only": False,
    # ``has_certification`` and ``certifying_body_name`` deliberately
    # absent — they're now data-driven from HALAL_CERTIFICATE
    # attachments, not the questionnaire (see profile-derivation
    # service). Tests that need them seeded use
    # ``with_certificate=True`` on _submit_pending_claim.
    "caveats": None,
}


def _submit_pending_claim(
    api,
    factories,
    db_session,
    *,
    with_certificate: bool = False,
    certifying_authority: str = "IFANCA",
) -> tuple:
    """Helper: provision a place/org/owner, submit a complete claim,
    return (admin, owner, place, org, claim_id) ready for an admin
    decision endpoint test.

    ``with_certificate=True`` uploads a HALAL_CERTIFICATE
    attachment between the create + submit steps so profile
    derivation flips ``has_certification`` to True at approval
    time. The owner's questionnaire no longer asks about
    certification directly — it's data-driven from attachments.
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
    assert create_resp.status_code == 201, create_resp.text
    claim_id = create_resp.json()["id"]

    if with_certificate:
        # Upload while the claim is still DRAFT (the only state
        # where the upload route accepts new files).
        cert_resp = api.as_user(owner).post(
            f"/me/halal-claims/{claim_id}/attachments",
            files={
                "file": (
                    "cert.pdf",
                    BytesIO(b"%PDF-1.4 fake cert"),
                    "application/pdf",
                ),
            },
            data={
                "document_type": "HALAL_CERTIFICATE",
                "issuing_authority": certifying_authority,
            },
        )
        assert cert_resp.status_code == 201, cert_resp.text

    submit_resp = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/submit"
    )
    assert submit_resp.status_code == 200, submit_resp.text
    assert submit_resp.json()["status"] == "PENDING_REVIEW"

    return admin, owner, place, org, claim_id


# ---------------------------------------------------------------------------
# List + detail
# ---------------------------------------------------------------------------
def test_list_admin_filters_by_status(api, factories, db_session):
    admin, _, _, _, claim_id = _submit_pending_claim(api, factories, db_session)

    resp = api.as_user(admin).get(
        "/admin/halal-claims", params={"status": "PENDING_REVIEW"}
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["id"] == claim_id

    # No-match status returns empty list.
    resp_empty = api.as_user(admin).get(
        "/admin/halal-claims", params={"status": "REJECTED"}
    )
    assert resp_empty.status_code == 200
    assert resp_empty.json() == []


def test_get_admin_detail_includes_internal_fields(
    api, factories, db_session
):
    admin, _, _, _, claim_id = _submit_pending_claim(api, factories, db_session)

    resp = api.as_user(admin).get(f"/admin/halal-claims/{claim_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Admin-only fields are present (even if null pre-decision).
    assert "submitted_by_user_id" in body
    assert "decided_by_user_id" in body
    assert "internal_notes" in body


def test_non_admin_blocked(api, factories, db_session):
    """OWNER role can't hit /admin/halal-claims."""
    _, owner, _, _, claim_id = _submit_pending_claim(api, factories, db_session)
    resp = api.as_user(owner).get("/admin/halal-claims")
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Approve — profile derivation
# ---------------------------------------------------------------------------
def test_approve_creates_profile_first_time(api, factories, db_session):
    # Seed a HALAL_CERTIFICATE attachment so the data-driven
    # certification derivation has something to work with.
    admin, _, place, _, claim_id = _submit_pending_claim(
        api, factories, db_session, with_certificate=True
    )

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={
            "validation_tier": "TRUST_HALAL_VERIFIED",
            "decision_note": "Verified IFANCA cert.",
            "internal_notes": "Spot-checked supplier list.",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "APPROVED"
    assert body["decision_note"] == "Verified IFANCA cert."
    assert body["internal_notes"] == "Spot-checked supplier list."
    assert body["decided_at"] is not None
    assert body["decided_by_user_id"] is not None

    # Profile materialized.
    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    assert profile.validation_tier == ValidationTier.TRUST_HALAL_VERIFIED.value
    assert profile.menu_posture == MenuPosture.FULLY_HALAL.value
    assert profile.has_pork is False
    assert profile.alcohol_policy == AlcoholPolicy.NONE.value
    assert profile.chicken_slaughter == SlaughterMethod.ZABIHAH.value
    assert profile.beef_slaughter == SlaughterMethod.ZABIHAH.value
    assert profile.lamb_slaughter == SlaughterMethod.NOT_SERVED.value
    # ``has_certification`` + ``certifying_body_name`` are now
    # derived from the HALAL_CERTIFICATE attachment, not the
    # questionnaire — see profile-derivation service.
    assert profile.has_certification is True
    assert profile.certifying_body_name == "IFANCA"
    assert profile.dispute_state == HalalProfileDisputeState.NONE.value
    assert profile.expires_at is not None
    assert profile.revoked_at is None


def test_approve_without_certificate_attachment_sets_has_certification_false(
    api, factories, db_session
):
    """Mirror of the happy-path test, but without a HALAL_CERTIFICATE
    attachment. Profile derivation should land
    ``has_certification=False`` + ``certifying_body_name=None``
    even though the rest of the questionnaire is the same."""
    admin, _, place, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={"validation_tier": "OWNER_ATTESTED"},
    )
    assert resp.status_code == 200, resp.text

    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    assert profile.has_certification is False
    assert profile.certifying_body_name is None

    # Audit event row.
    events = db_session.execute(
        select(HalalProfileEvent).where(
            HalalProfileEvent.profile_id == profile.id
        )
    ).scalars().all()
    assert len(events) == 1
    assert events[0].event_type == HalalProfileEventType.CREATED.value


def test_approve_supersedes_prior_claim(api, factories, db_session):
    """Approving a NEW claim for the same place updates the profile
    in place and marks the previous source_claim as SUPERSEDED."""
    admin, owner, place, org, first_claim_id = _submit_pending_claim(
        api, factories, db_session
    )

    # Approve the first claim with SELF_ATTESTED.
    api.as_user(admin).post(
        f"/admin/halal-claims/{first_claim_id}/approve",
        json={"validation_tier": "SELF_ATTESTED"},
    )

    # Owner submits a second claim — same place, different posture.
    second_payload = {**COMPLETE_QUESTIONNAIRE, "alcohol_policy": "BEER_AND_WINE_ONLY"}
    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
            "structured_response": second_payload,
        },
    )
    second_claim_id = create_resp.json()["id"]
    api.as_user(owner).post(f"/me/halal-claims/{second_claim_id}/submit")

    # Admin approves the second one with a higher tier.
    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{second_claim_id}/approve",
        json={"validation_tier": "TRUST_HALAL_VERIFIED"},
    )
    assert resp.status_code == 200, resp.text

    # Profile is updated (in-place, same row), pointing at the new
    # source_claim, with the new alcohol policy + tier.
    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    assert profile.source_claim_id is not None
    assert str(profile.source_claim_id) == second_claim_id
    assert profile.alcohol_policy == AlcoholPolicy.BEER_AND_WINE_ONLY.value
    assert profile.validation_tier == ValidationTier.TRUST_HALAL_VERIFIED.value

    # Old claim flipped to SUPERSEDED.
    db_session.expire_all()
    first_claim = db_session.execute(
        select(HalalClaim).where(HalalClaim.id == first_claim_id)
    ).scalar_one()
    assert first_claim.status == HalalClaimStatus.SUPERSEDED.value

    # Two events on the profile (CREATED for first, UPDATED for
    # second).
    events = db_session.execute(
        select(HalalProfileEvent)
        .where(HalalProfileEvent.profile_id == profile.id)
        .order_by(HalalProfileEvent.created_at.asc())
    ).scalars().all()
    assert len(events) == 2
    assert events[0].event_type == HalalProfileEventType.CREATED.value
    assert events[1].event_type == HalalProfileEventType.UPDATED.value


def test_approve_rejects_non_decidable_status(api, factories, db_session):
    """Can't approve a DRAFT claim — must be PENDING_REVIEW."""
    admin = factories.admin()
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    # Owner creates DRAFT but doesn't submit.
    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
            "structured_response": COMPLETE_QUESTIONNAIRE,
        },
    )
    claim_id = create_resp.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={"validation_tier": "SELF_ATTESTED"},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_NOT_DECIDABLE"


def test_approve_with_expires_at_override(api, factories, db_session):
    admin, _, place, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )

    custom_expiry_dt = datetime.now(timezone.utc) + timedelta(days=30)
    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={
            "validation_tier": "CERTIFICATE_ON_FILE",
            "expires_at_override": custom_expiry_dt.isoformat(),
        },
    )
    assert resp.status_code == 200, resp.text

    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    # 30-day override is shorter than the 90-day cap, so it lands
    # verbatim on the row (within a second of the ISO timestamp).
    assert profile.expires_at is not None
    delta = abs((profile.expires_at - custom_expiry_dt).total_seconds())
    assert delta < 2, f"profile.expires_at drifted: delta={delta}s"


def test_approve_default_expiry_is_90_days(api, factories, db_session):
    """Trust Halal company policy: every approved claim is good for
    90 days by default. No override + no certificate_expires_at →
    profile.expires_at lands ~90 days from approve time."""
    admin, _, place, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )

    before = datetime.now(timezone.utc)
    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={"validation_tier": "OWNER_ATTESTED"},
    )
    after = datetime.now(timezone.utc)
    assert resp.status_code == 200, resp.text

    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    # Profile.expires_at sits between (before + 90d) and
    # (after + 90d) — bounded interval that doesn't depend on
    # the test's wall-clock precision.
    lower = before + timedelta(days=90)
    upper = after + timedelta(days=90)
    assert lower <= profile.expires_at <= upper, (
        f"expected ~90 days from approve, got "
        f"{profile.expires_at} (lower={lower}, upper={upper})"
    )


def test_approve_clamps_overlong_override_to_90_days(
    api, factories, db_session
):
    """Admin can't accidentally grant a year-long approval. An
    override past the 90-day company cap is clamped server-side to
    the cap; the request still succeeds (no 422) so admin staff
    don't get confusing errors when they try to be generous."""
    admin, _, place, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )

    overlong = (
        datetime.now(timezone.utc) + timedelta(days=365)
    ).isoformat()
    before = datetime.now(timezone.utc)
    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={
            "validation_tier": "TRUST_HALAL_VERIFIED",
            "expires_at_override": overlong,
        },
    )
    after = datetime.now(timezone.utc)
    assert resp.status_code == 200, resp.text

    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    # Should land at the 90-day cap, NOT the 365-day override.
    lower = before + timedelta(days=90)
    upper = after + timedelta(days=90)
    assert lower <= profile.expires_at <= upper, (
        f"override of 365d should have been clamped to 90d, got "
        f"{profile.expires_at}"
    )


# ---------------------------------------------------------------------------
# Reject
# ---------------------------------------------------------------------------
def test_reject_does_not_create_profile(api, factories, db_session):
    admin, _, place, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/reject",
        json={"decision_note": "Cert is expired."},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "REJECTED"
    assert resp.json()["decision_note"] == "Cert is expired."

    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one_or_none()
    assert profile is None


def test_reject_requires_decision_note(api, factories, db_session):
    admin, _, _, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/reject",
        json={"decision_note": ""},  # too short
    )
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# Request-info
# ---------------------------------------------------------------------------
def test_request_info_moves_claim_and_reopens_uploads(
    api, factories, db_session, fake_storage
):
    admin, owner, _, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/request-info",
        json={"decision_note": "Please upload a current IFANCA certificate."},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "NEEDS_MORE_INFO"
    assert "IFANCA" in resp.json()["decision_note"]

    # Owner can now upload again (was blocked while PENDING_REVIEW).
    upload_resp = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/attachments",
        files={"file": ("cert.pdf", BytesIO(b"%PDF-1.4 cert"), "application/pdf")},
    )
    assert upload_resp.status_code == 201, upload_resp.text


# ---------------------------------------------------------------------------
# Revoke
# ---------------------------------------------------------------------------
def test_revoke_marks_profile_revoked(api, factories, db_session):
    admin, _, place, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )
    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={"validation_tier": "SELF_ATTESTED"},
    )

    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/revoke",
        json={"decision_note": "Restaurant has closed."},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "REVOKED"

    db_session.expire_all()
    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    assert profile.revoked_at is not None

    # REVOKED audit event.
    events = db_session.execute(
        select(HalalProfileEvent)
        .where(HalalProfileEvent.profile_id == profile.id)
        .order_by(HalalProfileEvent.created_at.asc())
    ).scalars().all()
    event_types = [e.event_type for e in events]
    assert HalalProfileEventType.REVOKED.value in event_types


def test_revoke_idempotent_on_already_revoked(api, factories, db_session):
    admin, _, _, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )
    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={"validation_tier": "SELF_ATTESTED"},
    )
    first = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/revoke",
        json={"decision_note": "Closed."},
    )
    assert first.status_code == 200

    second = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/revoke",
        json={"decision_note": "Closed (still)."},
    )
    assert second.status_code == 200
    assert second.json()["status"] == "REVOKED"


def test_revoke_blocks_non_approved(api, factories, db_session):
    admin, _, _, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )
    # Claim still PENDING_REVIEW — revoke should 409.
    resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/revoke",
        json={"decision_note": "Bad faith."},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_NOT_REVOCABLE"


# ---------------------------------------------------------------------------
# Attachments admin viewer
# ---------------------------------------------------------------------------
def test_admin_signed_url_for_attachment(
    api, factories, db_session, fake_storage
):
    admin, owner, _, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )
    # Owner uploaded none yet — request-info to reopen, upload one.
    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/request-info",
        json={"decision_note": "Need cert."},
    )
    upload = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/attachments",
        files={"file": ("cert.pdf", BytesIO(b"%PDF cert"), "application/pdf")},
    )
    attachment_id = upload.json()["id"]

    resp = api.as_user(admin).get(
        f"/admin/halal-claims/{claim_id}/attachments/{attachment_id}/url"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["url"].startswith("https://fake-storage.local/")
    assert body["original_filename"] == "cert.pdf"
    assert body["expires_in_seconds"] == 60


def test_admin_signed_url_404s_unrelated_attachment(
    api, factories, db_session, fake_storage
):
    """Asserting the attachment belongs to the claim in the URL —
    a guessed UUID for a different claim's attachment 404s."""
    import uuid

    admin, _, _, _, claim_id = _submit_pending_claim(
        api, factories, db_session
    )
    resp = api.as_user(admin).get(
        f"/admin/halal-claims/{claim_id}/attachments/{uuid.uuid4()}/url"
    )
    assert resp.status_code == 404, resp.text
    assert (
        resp.json()["error"]["code"] == "HALAL_CLAIM_ATTACHMENT_NOT_FOUND"
    )
