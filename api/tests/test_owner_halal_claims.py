"""Integration tests for the owner-portal halal-claim flow.

Phase 2 of the halal-trust v2 rebuild covers:

  * Create DRAFT (with org + place ownership gates)
  * List own claims
  * Get single claim (404 vs 403 split)
  * Patch DRAFT (NO_FIELDS, status guard)
  * Submit DRAFT → PENDING_REVIEW (questionnaire completeness gate)
  * Attachment upload (caps + MIME allow-list + status guard)
  * Attachment list

Storage uploads use the same fake-storage fixture as the org and
ownership-request attachment suites.
"""
from __future__ import annotations

from io import BytesIO

import pytest
from sqlalchemy import select

from app.core.storage import get_storage_client
from app.modules.halal_claims.enums import HalalClaimStatus, HalalClaimType
from app.modules.halal_claims.models import HalalClaim, HalalClaimAttachment
from app.modules.organizations.enums import OrganizationStatus


# ---------------------------------------------------------------------------
# Storage fake — pasted to keep tests self-contained.
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


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


# A complete questionnaire payload that satisfies the strict shape.
# Used as a fixture the tests can copy + modify field-by-field.
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


def _create_claim_payload(place_id, organization_id, *, structured=None):
    body = {
        "place_id": str(place_id),
        "organization_id": str(organization_id),
    }
    if structured is not None:
        body["structured_response"] = structured
    return body


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------
def test_create_draft_happy_path(api, factories, db_session):
    """Owner with an active org + place_owner link can create a
    DRAFT claim. No questionnaire is required at create — the row
    just exists, ready for patching + submitting."""
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["place_id"] == str(place.id)
    assert body["organization_id"] == str(org.id)
    assert body["claim_type"] == HalalClaimType.INITIAL.value
    assert body["status"] == HalalClaimStatus.DRAFT.value
    assert body["structured_response"] is None
    assert body["submitted_at"] is None


def test_create_with_partial_questionnaire_is_allowed(
    api, factories, db_session
):
    """Owners save partial answers across sessions. The draft shape
    accepts every field as optional — no 422 on incomplete drafts."""
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    partial = {
        "questionnaire_version": 1,
        "has_pork": False,
        "menu_posture": "FULLY_HALAL",
        # Everything else omitted.
    }
    resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id, structured=partial),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["structured_response"]["has_pork"] is False
    assert body["structured_response"]["menu_posture"] == "FULLY_HALAL"


def test_create_rejects_non_member_org(api, factories, db_session):
    """User isn't a member of the org → 403 HALAL_CLAIM_ORG_NOT_MEMBER."""
    owner = factories.owner()
    other_user = factories.owner()
    place, org = factories.managed_place(owner=other_user)
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_ORG_NOT_MEMBER"


def test_create_rejects_draft_org(api, factories, db_session):
    """Org in DRAFT can't sponsor — owner must submit it for review
    first. 409 HALAL_CLAIM_ORG_NOT_ELIGIBLE."""
    owner = factories.owner()
    place = factories.place()
    org = factories.org_for_user(
        user=owner, status=OrganizationStatus.DRAFT
    )
    factories.place_owner_link(place=place, organization=org)
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_ORG_NOT_ELIGIBLE"


def test_create_rejects_when_org_not_place_owner(
    api, factories, db_session
):
    """Owner has the org but the org doesn't own the place → 409."""
    owner = factories.owner()
    place = factories.place()
    org = factories.org_for_user(user=owner)
    # Deliberately no place_owner_link.
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_NOT_PLACE_OWNER"


def test_create_404s_unknown_org(api, factories, db_session):
    """Unknown org id → 404 HALAL_CLAIM_ORG_NOT_FOUND."""
    import uuid

    owner = factories.owner()
    place = factories.place()
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, uuid.uuid4()),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_ORG_NOT_FOUND"


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------
def test_list_scopes_to_caller(api, factories, db_session):
    """Listing /me/halal-claims returns only the caller's claims."""
    owner_a = factories.owner()
    owner_b = factories.owner()
    place_a, org_a = factories.managed_place(owner=owner_a)
    place_b, org_b = factories.managed_place(owner=owner_b)
    db_session.commit()

    api.as_user(owner_a).post(
        "/me/halal-claims",
        json=_create_claim_payload(place_a.id, org_a.id),
    )
    api.as_user(owner_b).post(
        "/me/halal-claims",
        json=_create_claim_payload(place_b.id, org_b.id),
    )

    resp = api.as_user(owner_a).get("/me/halal-claims")
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["place_id"] == str(place_a.id)


# ---------------------------------------------------------------------------
# Get / 404 vs 403
# ---------------------------------------------------------------------------
def test_get_unknown_id_returns_404(api, factories, db_session):
    import uuid

    owner = factories.owner()
    db_session.commit()
    resp = api.as_user(owner).get(f"/me/halal-claims/{uuid.uuid4()}")
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_NOT_FOUND"


def test_get_other_users_claim_returns_403(api, factories, db_session):
    owner_a = factories.owner()
    owner_b = factories.owner()
    place, org = factories.managed_place(owner=owner_a)
    db_session.commit()

    create_resp = api.as_user(owner_a).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    claim_id = create_resp.json()["id"]

    resp = api.as_user(owner_b).get(f"/me/halal-claims/{claim_id}")
    assert resp.status_code == 403, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_FORBIDDEN"


# ---------------------------------------------------------------------------
# Patch
# ---------------------------------------------------------------------------
def test_patch_updates_questionnaire_on_draft(api, factories, db_session):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    claim_id = create_resp.json()["id"]

    resp = api.as_user(owner).patch(
        f"/me/halal-claims/{claim_id}",
        json={"structured_response": {"has_pork": True}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["structured_response"]["has_pork"] is True


def test_patch_with_no_fields_returns_400_no_fields(
    api, factories, db_session
):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    claim_id = create_resp.json()["id"]

    resp = api.as_user(owner).patch(
        f"/me/halal-claims/{claim_id}", json={}
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "NO_FIELDS"


def test_patch_blocked_after_submit(api, factories, db_session):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(
            place.id, org.id, structured=COMPLETE_QUESTIONNAIRE
        ),
    )
    claim_id = create_resp.json()["id"]

    submit_resp = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/submit"
    )
    assert submit_resp.status_code == 200, submit_resp.text
    assert submit_resp.json()["status"] == "PENDING_REVIEW"

    patch_resp = api.as_user(owner).patch(
        f"/me/halal-claims/{claim_id}",
        json={"structured_response": {"has_pork": True}},
    )
    assert patch_resp.status_code == 409, patch_resp.text
    assert patch_resp.json()["error"]["code"] == "HALAL_CLAIM_NOT_EDITABLE"



# ---------------------------------------------------------------------------
# Delete (DRAFT-only, with attachment cleanup)
# ---------------------------------------------------------------------------
def test_delete_draft_removes_claim_and_attachments(
    api, factories, db_session, fake_storage,
):
    """Owner discards a DRAFT — claim row gone, attachment rows
    cascade off, blob bytes deleted from storage."""
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    claim_id = create_resp.json()["id"]

    # Upload one attachment so the cascade has something to clean.
    upload_resp = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/attachments",
        files={
            "file": ("cert.pdf", BytesIO(b"%PDF-1.4 fake"), "application/pdf"),
        },
        data={"document_type": "HALAL_CERTIFICATE"},
    )
    assert upload_resp.status_code == 201, upload_resp.text

    storage_path = next(iter(fake_storage.uploaded.keys()))

    delete_resp = api.as_user(owner).delete(
        f"/me/halal-claims/{claim_id}"
    )
    assert delete_resp.status_code == 204, delete_resp.text

    # Claim row gone.
    row = db_session.execute(
        select(HalalClaim).where(HalalClaim.id == claim_id)
    ).scalar_one_or_none()
    assert row is None

    # Attachment rows gone (cascade).
    attachments = db_session.execute(
        select(HalalClaimAttachment).where(
            HalalClaimAttachment.claim_id == claim_id
        )
    ).scalars().all()
    assert attachments == []

    # Storage blob deleted.
    assert storage_path in fake_storage.deleted


def test_delete_blocks_after_submit(
    api, factories, db_session, fake_storage,
):
    """Once a claim is PENDING_REVIEW it's part of the audit trail
    and can't be deleted — even by the owner. 409 with the typed
    code so the UI hides the button."""
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(
            place.id, org.id, structured=COMPLETE_QUESTIONNAIRE
        ),
    )
    claim_id = create_resp.json()["id"]
    api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")

    delete_resp = api.as_user(owner).delete(
        f"/me/halal-claims/{claim_id}"
    )
    assert delete_resp.status_code == 409, delete_resp.text
    assert (
        delete_resp.json()["error"]["code"] == "HALAL_CLAIM_NOT_DELETABLE"
    )


def test_delete_blocked_for_other_users_draft(
    api, factories, db_session, fake_storage,
):
    """The membership/ownership gate fires before the status
    check — another owner can't delete your DRAFT just because
    it's deletable in principle."""
    owner = factories.owner(email="own@example.com")
    other = factories.owner(email="other@example.com")
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    claim_id = create_resp.json()["id"]

    delete_resp = api.as_user(other).delete(
        f"/me/halal-claims/{claim_id}"
    )
    # Same posture as the GET ownership check: 403 with FORBIDDEN.
    assert delete_resp.status_code == 403, delete_resp.text
    assert (
        delete_resp.json()["error"]["code"] == "HALAL_CLAIM_FORBIDDEN"
    )


def test_delete_unknown_id_returns_404(
    api, factories, db_session, fake_storage,
):
    """Bogus UUID → 404 NOT_FOUND, not 409 NOT_DELETABLE."""
    import uuid

    owner = factories.owner()
    db_session.commit()

    resp = api.as_user(owner).delete(
        f"/me/halal-claims/{uuid.uuid4()}"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_NOT_FOUND"


# ---------------------------------------------------------------------------
# Submit
# ---------------------------------------------------------------------------
def test_submit_with_complete_questionnaire(api, factories, db_session):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(
            place.id, org.id, structured=COMPLETE_QUESTIONNAIRE
        ),
    )
    claim_id = create_resp.json()["id"]

    resp = api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "PENDING_REVIEW"
    assert body["submitted_at"] is not None


def test_submit_blocks_when_questionnaire_missing(
    api, factories, db_session
):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    claim_id = create_resp.json()["id"]

    resp = api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")
    assert resp.status_code == 400, resp.text
    assert (
        resp.json()["error"]["code"]
        == "HALAL_CLAIM_QUESTIONNAIRE_INCOMPLETE"
    )


def test_submit_blocks_with_partial_questionnaire(
    api, factories, db_session
):
    """Even a partial draft fails submit — strict shape requires
    every required field. The error.detail surfaces field-level
    pydantic errors so the frontend can highlight them."""
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    partial = {
        "questionnaire_version": 1,
        "has_pork": False,
        # Missing menu_posture, alcohol_policy, alcohol_in_cooking
        # — all required by the strict shape. (has_certification is
        # optional now; certification state is derived from
        # HALAL_CERTIFICATE attachments at approval time, not
        # asked in the questionnaire.)
    }
    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id, structured=partial),
    )
    claim_id = create_resp.json()["id"]

    resp = api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")
    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body["error"]["code"] == "HALAL_CLAIM_QUESTIONNAIRE_INCOMPLETE"
    # Field-level errors ride under ``detail`` so the UI can render
    # inline highlights.
    assert isinstance(body["error"].get("detail"), list)
    missing = {tuple(e.get("loc", [])) for e in body["error"]["detail"]}
    assert ("menu_posture",) in missing
    assert ("alcohol_policy",) in missing


def test_submit_idempotent_on_already_pending(api, factories, db_session):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(
            place.id, org.id, structured=COMPLETE_QUESTIONNAIRE
        ),
    )
    claim_id = create_resp.json()["id"]
    api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")
    # Second call should return 200 with the same claim, no error.
    resp = api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "PENDING_REVIEW"


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------
def test_upload_attachment_happy_path(
    api, factories, db_session, fake_storage
):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    claim_id = create_resp.json()["id"]

    file_bytes = b"%PDF-1.4 fake cert"
    resp = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/attachments",
        files={"file": ("cert.pdf", BytesIO(file_bytes), "application/pdf")},
        data={
            "document_type": "HALAL_CERTIFICATE",
            "issuing_authority": "IFANCA",
            "certificate_number": "CERT-12345",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["document_type"] == "HALAL_CERTIFICATE"
    assert body["issuing_authority"] == "IFANCA"
    assert body["certificate_number"] == "CERT-12345"
    assert body["original_filename"] == "cert.pdf"
    assert body["content_type"] == "application/pdf"
    assert body["size_bytes"] == len(file_bytes)

    # Storage actually got the bytes.
    assert any(
        path.startswith(f"halal-claims/{claim_id}/")
        for path in fake_storage.uploaded
    )


def test_upload_rejects_disallowed_mime(
    api, factories, db_session, fake_storage
):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    claim_id = create_resp.json()["id"]

    resp = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/attachments",
        files={"file": ("script.exe", BytesIO(b"MZ"), "application/x-msdownload")},
    )
    assert resp.status_code == 400, resp.text
    assert (
        resp.json()["error"]["code"]
        == "HALAL_CLAIM_ATTACHMENT_TYPE_NOT_ALLOWED"
    )


def test_upload_blocked_on_non_editable_status(
    api, factories, db_session, fake_storage
):
    """Uploading after submit (PENDING_REVIEW) returns
    HALAL_CLAIM_NOT_EDITABLE."""
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(
            place.id, org.id, structured=COMPLETE_QUESTIONNAIRE
        ),
    )
    claim_id = create_resp.json()["id"]
    api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")

    resp = api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/attachments",
        files={"file": ("cert.pdf", BytesIO(b"%PDF"), "application/pdf")},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "HALAL_CLAIM_NOT_EDITABLE"


def test_list_attachments_returns_metadata(
    api, factories, db_session, fake_storage
):
    owner = factories.owner()
    place, org = factories.managed_place(owner=owner)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json=_create_claim_payload(place.id, org.id),
    )
    claim_id = create_resp.json()["id"]

    api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/attachments",
        files={"file": ("a.pdf", BytesIO(b"%PDF a"), "application/pdf")},
    )
    api.as_user(owner).post(
        f"/me/halal-claims/{claim_id}/attachments",
        files={"file": ("b.pdf", BytesIO(b"%PDF b"), "application/pdf")},
    )

    resp = api.as_user(owner).get(
        f"/me/halal-claims/{claim_id}/attachments"
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 2
    filenames = {r["original_filename"] for r in rows}
    assert filenames == {"a.pdf", "b.pdf"}
