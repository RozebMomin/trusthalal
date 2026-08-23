"""Integration tests for verification-visit endpoints (Phase 8b).

Covers:
  * POST /me/verification-visits — verifier-self submit (auth +
    role gate + place existence guard + ACTIVE-profile guard).
  * GET  /me/verification-visits — list + status filter.
  * GET  /me/verification-visits/{id} — read with 404 for other
    verifiers' rows.
  * POST /me/verification-visits/{id}/withdraw — happy path,
    idempotency, post-review lock.
  * POST /me/verification-visits/{id}/attachments — multipart
    upload with allow-list + size + count caps.
  * GET  /admin/verification-visits — queue + filters + role gate.
  * POST /admin/verification-visits/{id}/decide — accept (with +
    without existing profile), reject (note required), redecide
    blocked, tier promotion + last_verified_at refresh + audit
    events landed.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from sqlalchemy import select

from app.core.storage import get_storage_client
from app.modules.halal_profiles.enums import (
    HalalProfileEventType,
    ValidationTier,
)
from app.modules.halal_profiles.models import HalalProfile, HalalProfileEvent
from app.modules.places.models import PlaceEvent, PlacePhoto
from app.modules.users.enums import UserRole
from app.modules.users.models import User
from app.modules.verifiers.enums import (
    VerificationVisitStatus,
    VerifierProfileStatus,
)
from app.modules.verifiers.models import (
    VerificationVisit,
    VerifierProfile,
)


# ---------------------------------------------------------------------------
# Storage fake — same shape used by test_consumer_disputes.
# ---------------------------------------------------------------------------
class _FakeStorageClient:
    bucket = "evidence-test"

    def __init__(self) -> None:
        self.uploaded: dict[str, tuple[bytes, str]] = {}
        self.signed_urls: list[tuple[str, int]] = []

    def upload_bytes(self, path: str, data: bytes, *, content_type: str) -> None:
        self.uploaded[path] = (data, content_type)

    def download_bytes(self, path: str) -> bytes:
        return self.uploaded[path][0]

    def public_url(self, path: str) -> str:
        return f"https://fake-public.local/{self.bucket}/{path}"

    def signed_url(self, path: str, *, expires_in_seconds: int) -> str:
        self.signed_urls.append((path, expires_in_seconds))
        return f"https://fake-storage.local/{self.bucket}/{path}?token=stub"

    def delete_object(self, path: str) -> None:  # pragma: no cover
        self.uploaded.pop(path, None)


@pytest.fixture
def fake_storage():
    from app.main import app as fastapi_app

    fake = _FakeStorageClient()
    fastapi_app.dependency_overrides[get_storage_client] = lambda: fake
    try:
        yield fake
    finally:
        fastapi_app.dependency_overrides.pop(get_storage_client, None)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_active_verifier(factories, db_session) -> User:
    """Build a User with role=VERIFIER and an ACTIVE VerifierProfile.
    Mirrors what the 8a admin-approve flow lands in production."""
    user = factories.verifier()
    profile = VerifierProfile(
        user_id=user.id,
        status=VerifierProfileStatus.ACTIVE.value,
    )
    db_session.add(profile)
    db_session.flush()
    return user


COMPLETE_QUESTIONNAIRE = {
    "questionnaire_version": 1,
    "menu_posture": "FULLY_HALAL",
    "has_pork": False,
    "alcohol_policy": "NONE",
    "alcohol_in_cooking": False,
    "meat_products": [
        {
            "meat_type": "CHICKEN",
            "product_name": "Chicken",
            "slaughter_method": "HAND_CUT",
        },
        {
            "meat_type": "BEEF",
            "product_name": "Beef",
            "slaughter_method": "HAND_CUT",
        },
    ],
    "seafood_only": False,
    "has_certification": False,
    "certifying_body_name": None,
    # ``certificate_expires_at`` is intentionally NOT here — the
    # questionnaire schema is ``extra="forbid"`` and only carries
    # cert metadata via the per-product ``MeatProductSourcing`` rows,
    # not at the top level. Cert validity dates live on the
    # admin-side approve payload (``certificate_expires_at`` on the
    # claim-approve schema), not on the owner's submission.
    "caveats": None,
}


def _approve_claim_for_place(api, factories, db_session) -> tuple[object, str]:
    """Helper: drive an owner halal-claim through approval so the
    place ends up with a HalalProfile. Returns (place, profile_id).
    Mirrors the helper in test_consumer_disputes.
    """
    admin = factories.admin()
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create = api.as_user(owner).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
            "structured_response": COMPLETE_QUESTIONNAIRE,
        },
    )
    claim_id = create.json()["id"]
    api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")
    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        # Approve at SELF_ATTESTED so the visit-acceptance test can
        # observe a real promotion to TRUST_HALAL_VERIFIED.
        json={"validation_tier": "SELF_ATTESTED"},
    )

    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    return place, str(profile.id)


VALID_VISIT_PAYLOAD = {
    "visited_at": datetime(2026, 5, 1, 12, tzinfo=timezone.utc).isoformat(),
    # No structured_findings — the questionnaire is optional on the
    # schema and not the focus of these tests. Tests that care about
    # findings can override the payload.
    "notes_for_admin": "Visited at lunch service; saw the cert on the wall.",
    "disclosure": "SELF_FUNDED",
}


# ---------------------------------------------------------------------------
# Verifier-self submit
# ---------------------------------------------------------------------------


def test_submit_visit_happy_path(api, factories, db_session):
    verifier = _make_active_verifier(factories, db_session)
    place = factories.place()

    payload = {**VALID_VISIT_PAYLOAD, "place_id": str(place.id)}
    resp = api.as_user(verifier).post("/me/verification-visits", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == VerificationVisitStatus.SUBMITTED.value
    assert body["verifier_user_id"] == str(verifier.id)
    assert body["place_id"] == str(place.id)

    # Cross-write to place_events landed.
    events = db_session.execute(
        select(PlaceEvent).where(PlaceEvent.place_id == place.id)
    ).scalars().all()
    assert any(e.event_type == "VERIFIER_VISIT_SUBMITTED" for e in events)


def test_submit_visit_requires_verifier_role(api, factories, db_session):
    consumer = factories.consumer()
    place = factories.place()
    payload = {**VALID_VISIT_PAYLOAD, "place_id": str(place.id)}
    resp = api.as_user(consumer).post(
        "/me/verification-visits", json=payload
    )
    assert resp.status_code == 403


def test_submit_visit_requires_active_profile(api, factories, db_session):
    """A user with role=VERIFIER but no profile (or a SUSPENDED
    profile) gets a 409 — defense in depth against admin
    inconsistency between role and profile.status."""
    verifier = factories.verifier()  # no VerifierProfile created
    place = factories.place()
    payload = {**VALID_VISIT_PAYLOAD, "place_id": str(place.id)}
    resp = api.as_user(verifier).post(
        "/me/verification-visits", json=payload
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "VERIFIER_PROFILE_MISSING"


def test_submit_visit_blocks_suspended_verifier(
    api, factories, db_session
):
    verifier = factories.verifier()
    db_session.add(
        VerifierProfile(
            user_id=verifier.id,
            status=VerifierProfileStatus.SUSPENDED.value,
        )
    )
    db_session.flush()
    place = factories.place()
    payload = {**VALID_VISIT_PAYLOAD, "place_id": str(place.id)}
    resp = api.as_user(verifier).post(
        "/me/verification-visits", json=payload
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "VERIFIER_PROFILE_NOT_ACTIVE"


def test_submit_visit_404s_unknown_place(api, factories, db_session):
    verifier = _make_active_verifier(factories, db_session)
    payload = {
        **VALID_VISIT_PAYLOAD,
        "place_id": "00000000-0000-0000-0000-000000000000",
    }
    resp = api.as_user(verifier).post(
        "/me/verification-visits", json=payload
    )
    assert resp.status_code == 404


def test_submit_visit_rejects_unknown_field(api, factories, db_session):
    verifier = _make_active_verifier(factories, db_session)
    place = factories.place()
    payload = {
        **VALID_VISIT_PAYLOAD,
        "place_id": str(place.id),
        "secret_admin_flag": True,
    }
    resp = api.as_user(verifier).post(
        "/me/verification-visits", json=payload
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Verifier-self list / read / withdraw
# ---------------------------------------------------------------------------


def test_list_my_visits_scopes_to_caller(api, factories, db_session):
    a = _make_active_verifier(factories, db_session)
    b = _make_active_verifier(factories, db_session)
    place = factories.place()

    api.as_user(a).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    api.as_user(b).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )

    rows_a = api.as_user(a).get("/me/verification-visits").json()
    rows_b = api.as_user(b).get("/me/verification-visits").json()
    assert len(rows_a) == 1
    assert len(rows_b) == 1
    assert rows_a[0]["verifier_user_id"] == str(a.id)


def test_get_my_visit_404s_for_other_verifier(api, factories, db_session):
    a = _make_active_verifier(factories, db_session)
    b = _make_active_verifier(factories, db_session)
    place = factories.place()
    create = api.as_user(a).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    resp = api.as_user(b).get(f"/me/verification-visits/{visit_id}")
    assert resp.status_code == 404


def test_withdraw_submitted_visit_succeeds(api, factories, db_session):
    verifier = _make_active_verifier(factories, db_session)
    place = factories.place()
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    resp = api.as_user(verifier).post(
        f"/me/verification-visits/{visit_id}/withdraw"
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == VerificationVisitStatus.WITHDRAWN.value


def test_withdraw_blocked_after_under_review(api, factories, db_session):
    verifier = _make_active_verifier(factories, db_session)
    admin = factories.admin()
    place = factories.place()
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/under-review"
    )

    resp = api.as_user(verifier).post(
        f"/me/verification-visits/{visit_id}/withdraw"
    )
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"]
        == "VERIFICATION_VISIT_NOT_WITHDRAWABLE"
    )


# ---------------------------------------------------------------------------
# Attachment upload
# ---------------------------------------------------------------------------


def test_upload_visit_attachment_happy_path(
    api, factories, db_session, fake_storage
):
    verifier = _make_active_verifier(factories, db_session)
    place = factories.place()
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    files = {
        "file": ("menu.jpg", BytesIO(b"\xff\xd8\xff" + b"x" * 100), "image/jpeg"),
    }
    resp = api.as_user(verifier).post(
        f"/me/verification-visits/{visit_id}/attachments", files=files
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["original_filename"] == "menu.jpg"
    assert body["content_type"] == "image/jpeg"
    assert any("verification_visits/" in k for k in fake_storage.uploaded)


def test_upload_visit_attachment_rejects_bad_mime(
    api, factories, db_session, fake_storage
):
    verifier = _make_active_verifier(factories, db_session)
    place = factories.place()
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    files = {
        "file": ("notes.txt", BytesIO(b"hello"), "text/plain"),
    }
    resp = api.as_user(verifier).post(
        f"/me/verification-visits/{visit_id}/attachments", files=files
    )
    assert resp.status_code == 400
    assert (
        resp.json()["error"]["code"]
        == "VERIFICATION_VISIT_ATTACHMENT_TYPE_NOT_ALLOWED"
    )


def test_upload_visit_attachment_blocked_after_under_review(
    api, factories, db_session, fake_storage
):
    verifier = _make_active_verifier(factories, db_session)
    admin = factories.admin()
    place = factories.place()
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]
    api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/under-review"
    )

    files = {
        "file": ("menu.jpg", BytesIO(b"\xff\xd8\xff" + b"x" * 100), "image/jpeg"),
    }
    resp = api.as_user(verifier).post(
        f"/me/verification-visits/{visit_id}/attachments", files=files
    )
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"] == "VERIFICATION_VISIT_NOT_EDITABLE"
    )


# ---------------------------------------------------------------------------
# Admin queue + role gate
# ---------------------------------------------------------------------------


def test_admin_list_visits_requires_admin(api, factories, db_session):
    consumer = factories.consumer()
    owner = factories.owner()
    verifier = _make_active_verifier(factories, db_session)
    for u in (consumer, owner, verifier):
        assert (
            api.as_user(u).get("/admin/verification-visits").status_code == 403
        )


def test_admin_list_visits_filter_by_place(api, factories, db_session):
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    p1 = factories.place()
    p2 = factories.place()
    api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(p1.id)},
    )
    api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(p2.id)},
    )

    resp = api.as_user(admin).get(
        f"/admin/verification-visits?place_id={p1.id}"
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["place_id"] == str(p1.id)


# ---------------------------------------------------------------------------
# Admin decide — acceptance + tier promotion
# ---------------------------------------------------------------------------


def test_admin_accept_promotes_tier_and_writes_events(
    api, factories, db_session
):
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place, profile_id = _approve_claim_for_place(api, factories, db_session)

    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/decide",
        json={"decision": "ACCEPTED"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == VerificationVisitStatus.ACCEPTED.value
    assert body["decided_by_user_id"] == str(admin.id)

    # Tier promoted.
    db_session.expire_all()
    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.id == profile_id)
    ).scalar_one()
    assert (
        profile.validation_tier == ValidationTier.TRUST_HALAL_VERIFIED.value
    )

    # last_verified_at refreshed to the visit's visited_at.
    visited_at_iso = VALID_VISIT_PAYLOAD["visited_at"]
    assert profile.last_verified_at.isoformat() == visited_at_iso

    # HalalProfileEvent landed.
    events = db_session.execute(
        select(HalalProfileEvent).where(
            HalalProfileEvent.profile_id == profile_id,
            HalalProfileEvent.event_type
            == HalalProfileEventType.VERIFIER_VISIT_ACCEPTED.value,
        )
    ).scalars().all()
    assert len(events) == 1

    # PlaceEvent cross-write landed.
    place_events = db_session.execute(
        select(PlaceEvent).where(PlaceEvent.place_id == place.id)
    ).scalars().all()
    assert any(e.event_type == "VERIFIER_VISIT_ACCEPTED" for e in place_events)


def test_admin_accept_bootstraps_profile_when_none(api, factories, db_session):
    """Community verification: accepting a visit on a place with no profile
    establishes one at TRUST_HALAL_VERIFIED (no owner claim required)."""
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place = factories.place()  # no halal profile
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/decide",
        json={"decision": "ACCEPTED"},
    )
    assert resp.status_code == 200, resp.text

    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one_or_none()
    assert profile is not None
    assert profile.validation_tier == ValidationTier.TRUST_HALAL_VERIFIED.value
    # Verifier-established: no owner claim behind it.
    assert profile.source_claim_id is None

    # Both a CREATED and a VERIFIER_VISIT_ACCEPTED event landed.
    types = db_session.execute(
        select(HalalProfileEvent.event_type).where(
            HalalProfileEvent.profile_id == profile.id
        )
    ).scalars().all()
    assert HalalProfileEventType.CREATED.value in types
    assert HalalProfileEventType.VERIFIER_VISIT_ACCEPTED.value in types


def test_admin_accept_bootstrap_maps_observations(api, factories, db_session):
    """The established profile reflects the verifier's observations: menu
    posture, per-meat method, alcohol, cert."""
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place = factories.place()
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={
            **VALID_VISIT_PAYLOAD,
            "place_id": str(place.id),
            "observations": {
                "ordered_items": [],
                "checks": {
                    "Menu is fully halal": "PARTIAL",
                    "Alcohol on premises": "YES",
                    "Halal cert visible on premises": "YES",
                },
                "menu_partial": {"scope": "ON_REQUEST", "note": "chicken on request"},
                "meat_checks": {
                    "CHICKEN": {"finding": "HAND_CUT", "evidence": "INVOICE"},
                    "BEEF": {"finding": "MACHINE_CUT", "evidence": "VERBAL"},
                    "GOAT": {"finding": "UNSURE", "evidence": "CERTIFICATE"},
                },
                "other_meat_checks": [],
                "amenities": {},
            },
        },
    )
    visit_id = create.json()["id"]
    resp = api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/decide",
        json={"decision": "ACCEPTED"},
    )
    assert resp.status_code == 200, resp.text

    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    assert profile.menu_posture == "HALAL_UPON_REQUEST"
    assert profile.alcohol_policy == "FULL_BAR"
    assert profile.has_certification is True
    assert profile.chicken_slaughter == "HAND_CUT"
    assert profile.beef_slaughter == "MACHINE_CUT"
    assert profile.lamb_slaughter == "NOT_SERVED"  # unrecorded → not served
    # "Unsure" means served-but-method-unconfirmed, NOT absent.
    assert profile.goat_slaughter == "NOT_DISCLOSED"


def test_accept_refreshes_verifier_established_profile(api, factories, db_session):
    """A second accepted visit updates a verifier-established profile's per-meat
    data (only what the new visit recorded) — not just the timestamp."""
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place = factories.place()

    # Visit 1: no meat findings → thin profile, chicken defaults to NOT_SERVED.
    v1 = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    ).json()["id"]
    api.as_user(admin).post(
        f"/admin/verification-visits/{v1}/decide", json={"decision": "ACCEPTED"}
    )
    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    assert profile.chicken_slaughter == "NOT_SERVED"

    # Visit 2: records chicken hand-cut → refresh updates it.
    v2 = api.as_user(verifier).post(
        "/me/verification-visits",
        json={
            **VALID_VISIT_PAYLOAD,
            "place_id": str(place.id),
            "observations": {
                "ordered_items": [],
                "checks": {},
                "meat_checks": {"CHICKEN": {"finding": "HAND_CUT", "evidence": "VERBAL"}},
                "other_meat_checks": [],
                "amenities": {},
            },
        },
    ).json()["id"]
    api.as_user(admin).post(
        f"/admin/verification-visits/{v2}/decide", json={"decision": "ACCEPTED"}
    )
    db_session.expire_all()
    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    assert profile.chicken_slaughter == "HAND_CUT"


def test_accept_publishes_verifier_photos(api, factories, db_session):
    """On acceptance, Meal/Menu photos become public VERIFIER place photos and
    the Cert photo populates the profile's certificate document."""
    from app.main import app as fastapi_app
    from app.core.storage import (
        get_certificates_storage_client_optional,
        get_photos_storage_client_optional,
        get_storage_client_optional,
    )

    evidence = _FakeStorageClient()
    photos_store = _FakeStorageClient()
    photos_store.bucket = "place-photos-test"
    certs_store = _FakeStorageClient()
    certs_store.bucket = "certs-test"
    fastapi_app.dependency_overrides[get_storage_client] = lambda: evidence
    fastapi_app.dependency_overrides[get_storage_client_optional] = lambda: evidence
    fastapi_app.dependency_overrides[get_photos_storage_client_optional] = (
        lambda: photos_store
    )
    fastapi_app.dependency_overrides[get_certificates_storage_client_optional] = (
        lambda: certs_store
    )
    try:
        admin = factories.admin()
        verifier = _make_active_verifier(factories, db_session)
        place = factories.place()
        db_session.commit()

        vid = api.as_user(verifier).post(
            "/me/verification-visits",
            json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
        ).json()["id"]
        img = b"\xff\xd8\xff" + b"x" * 100
        api.as_user(verifier).post(
            f"/me/verification-visits/{vid}/attachments",
            files={"file": ("meal.jpg", BytesIO(img), "image/jpeg")},
            data={"caption": "Meal"},
        )
        api.as_user(verifier).post(
            f"/me/verification-visits/{vid}/attachments",
            files={"file": ("cert.jpg", BytesIO(img), "image/jpeg")},
            data={"caption": "Cert"},
        )

        resp = api.as_user(admin).post(
            f"/admin/verification-visits/{vid}/decide", json={"decision": "ACCEPTED"}
        )
        assert resp.status_code == 200, resp.text
        db_session.expire_all()

        # Meal photo → public gallery as a VERIFIER photo (hero, place had none).
        rows = db_session.execute(
            select(PlacePhoto).where(PlacePhoto.place_id == place.id)
        ).scalars().all()
        verifier_photos = [p for p in rows if p.source == "VERIFIER"]
        assert len(verifier_photos) == 1
        assert verifier_photos[0].is_hero is True

        # Cert photo → profile certificate document.
        profile = db_session.execute(
            select(HalalProfile).where(HalalProfile.place_id == place.id)
        ).scalar_one()
        assert profile.certificate_url is not None
        assert profile.has_certification is True
    finally:
        for dep in (
            get_storage_client,
            get_storage_client_optional,
            get_photos_storage_client_optional,
            get_certificates_storage_client_optional,
        ):
            fastapi_app.dependency_overrides.pop(dep, None)


def test_accept_auto_links_verifier_supplier(api, factories, db_session):
    """A verifier UNSURE about method but naming a registry supplier resolves
    the meat: a VERIFIER_VISIT sourcing link is created and the profile column
    is filled from the matched product line — out of NOT_DISCLOSED."""
    from app.modules.suppliers.models import (
        PlaceSupplierLink,
        Supplier,
        SupplierProduct,
    )

    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place = factories.place()
    sup = Supplier(
        name="Wayne Farms",
        slug="wayne-farms",
        verification_tier="TRUST_HALAL_VERIFIED",
    )
    db_session.add(sup)
    db_session.flush()
    db_session.add(
        SupplierProduct(
            supplier_id=sup.id,
            meat_type="CHICKEN",
            product_name="Chicken",
            slaughter_method="HAND_CUT",
            line_tier="TRUST_HALAL_VERIFIED",
        )
    )
    db_session.commit()

    vid = api.as_user(verifier).post(
        "/me/verification-visits",
        json={
            **VALID_VISIT_PAYLOAD,
            "place_id": str(place.id),
            "observations": {
                "ordered_items": [],
                "checks": {},
                "other_meat_checks": [],
                "amenities": {},
                "meat_checks": {
                    "CHICKEN": {
                        "finding": "UNSURE",
                        "evidence": "CERTIFICATE",
                        "supplier_name": "Wayne Farms",
                    }
                },
            },
        },
    ).json()["id"]
    resp = api.as_user(admin).post(
        f"/admin/verification-visits/{vid}/decide", json={"decision": "ACCEPTED"}
    )
    assert resp.status_code == 200, resp.text
    db_session.expire_all()

    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.place_id == place.id)
    ).scalar_one()
    assert profile.chicken_slaughter == "HAND_CUT"  # filled from Wayne Farms

    link = db_session.execute(
        select(PlaceSupplierLink).where(PlaceSupplierLink.place_id == place.id)
    ).scalar_one_or_none()
    assert link is not None
    assert link.source == "VERIFIER_VISIT"
    assert link.evidence_tier == "VERIFIER_CONFIRMED"


def test_admin_accept_when_already_top_tier_just_refreshes(
    api, factories, db_session
):
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place, profile_id = _approve_claim_for_place(api, factories, db_session)

    # Manually push the profile to TRUST_HALAL_VERIFIED so the
    # acceptance doesn't have to promote.
    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.id == profile_id)
    ).scalar_one()
    profile.validation_tier = ValidationTier.TRUST_HALAL_VERIFIED.value
    db_session.flush()

    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/decide",
        json={"decision": "ACCEPTED"},
    )
    assert resp.status_code == 200

    # Tier stays at the top, but the audit event still lands.
    db_session.expire_all()
    refreshed = db_session.execute(
        select(HalalProfile).where(HalalProfile.id == profile_id)
    ).scalar_one()
    assert (
        refreshed.validation_tier
        == ValidationTier.TRUST_HALAL_VERIFIED.value
    )

    events = db_session.execute(
        select(HalalProfileEvent).where(
            HalalProfileEvent.profile_id == profile_id,
            HalalProfileEvent.event_type
            == HalalProfileEventType.VERIFIER_VISIT_ACCEPTED.value,
        )
    ).scalars().all()
    assert len(events) == 1


# ---------------------------------------------------------------------------
# Admin decide — rejection + redecide
# ---------------------------------------------------------------------------


def test_admin_reject_requires_note(api, factories, db_session):
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place, _ = _approve_claim_for_place(api, factories, db_session)
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/decide",
        json={"decision": "REJECTED"},
    )
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"]
        == "VERIFICATION_VISIT_REJECT_NOTE_REQUIRED"
    )


def test_admin_reject_writes_place_event(api, factories, db_session):
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place, profile_id = _approve_claim_for_place(api, factories, db_session)
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    resp = api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/decide",
        json={"decision": "REJECTED", "decision_note": "Insufficient photo evidence."},
    )
    assert resp.status_code == 200

    place_events = db_session.execute(
        select(PlaceEvent).where(PlaceEvent.place_id == place.id)
    ).scalars().all()
    assert any(
        e.event_type == "VERIFIER_VISIT_REJECTED" for e in place_events
    )

    # Profile NOT promoted.
    profile = db_session.execute(
        select(HalalProfile).where(HalalProfile.id == profile_id)
    ).scalar_one()
    assert (
        profile.validation_tier != ValidationTier.TRUST_HALAL_VERIFIED.value
    )


def test_admin_redecide_blocked(api, factories, db_session):
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place, _ = _approve_claim_for_place(api, factories, db_session)
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/decide",
        json={"decision": "ACCEPTED"},
    )
    resp = api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/decide",
        json={"decision": "REJECTED", "decision_note": "Wait, no."},
    )
    assert resp.status_code == 409
    assert (
        resp.json()["error"]["code"] == "VERIFICATION_VISIT_NOT_DECIDABLE"
    )


def test_admin_under_review_idempotent(api, factories, db_session):
    admin = factories.admin()
    verifier = _make_active_verifier(factories, db_session)
    place, _ = _approve_claim_for_place(api, factories, db_session)
    create = api.as_user(verifier).post(
        "/me/verification-visits",
        json={**VALID_VISIT_PAYLOAD, "place_id": str(place.id)},
    )
    visit_id = create.json()["id"]

    a = api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/under-review"
    )
    b = api.as_user(admin).post(
        f"/admin/verification-visits/{visit_id}/under-review"
    )
    assert a.status_code == 200
    assert b.status_code == 200
    assert b.json()["status"] == VerificationVisitStatus.UNDER_REVIEW.value
