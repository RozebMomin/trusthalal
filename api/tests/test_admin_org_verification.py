"""Integration tests for slice 5c — admin org verification.

Covers the admin-only verify/reject decisions, the status filter on
the org list endpoint, and the attachment viewer endpoints (list +
signed URL). Storage is overridden via the same fake_storage
fixture pattern used in the claim-attachment tests.
"""
from __future__ import annotations

from io import BytesIO

import pytest
from sqlalchemy import select

from app.core.storage import get_storage_client
from app.modules.organizations.enums import OrganizationStatus
from app.modules.organizations.models import Organization


# ---------------------------------------------------------------------------
# Fake storage (mirror of the test_owner_attachments / organizations setup)
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


def _under_review_org(api, factories, db_session, *, name="Under Review Co"):
    """Materialize an UNDER_REVIEW org owned by a freshly-created
    OWNER user. Returns (owner, org_id)."""
    owner = factories.user(role="OWNER", display_name="Olivia Owner")
    org = factories.org_for_user(
        user=owner, name=name, status=OrganizationStatus.DRAFT
    )
    db_session.commit()

    api.as_user(owner).post(
        f"/me/organizations/{org.id}/attachments",
        files={
            "file": ("filing.pdf", BytesIO(b"%PDF-1.4 articles"), "application/pdf"),
        },
    )
    api.as_user(owner).post(f"/me/organizations/{org.id}/submit")
    return owner, str(org.id)


# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
def test_admin_verify_org_transitions_to_verified(
    api, factories, db_session, fake_storage,
):
    """Happy path: UNDER_REVIEW → VERIFIED. Decision fields land
    on the row + show up in the response."""
    admin = factories.admin()
    _, org_id = _under_review_org(api, factories, db_session)

    resp = api.as_user(admin).post(
        f"/admin/organizations/{org_id}/verify",
        json={"note": "Cross-checked SOS filing."},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == OrganizationStatus.VERIFIED.value
    assert body["decided_at"] is not None
    assert body["decided_by_user_id"] == str(admin.id)
    assert body["decision_note"] == "Cross-checked SOS filing."

    row = db_session.execute(
        select(Organization).where(Organization.id == org_id)
    ).scalar_one()
    assert row.status == OrganizationStatus.VERIFIED.value
    assert row.decided_by_user_id == admin.id


def test_admin_verify_org_accepts_no_note(
    api, factories, db_session, fake_storage,
):
    """note is optional. Verifying without one leaves
    decision_note null on the row."""
    admin = factories.admin()
    _, org_id = _under_review_org(api, factories, db_session)

    resp = api.as_user(admin).post(
        f"/admin/organizations/{org_id}/verify",
        json={},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["decision_note"] is None


def test_admin_verify_org_rejects_non_under_review(
    api, factories, db_session, fake_storage,
):
    """Verifying a DRAFT org → 409 ORGANIZATION_NOT_REVIEWABLE.
    Defends against a stale-tab race where admin clicks Verify
    on something the owner hasn't actually submitted yet."""
    admin = factories.admin()
    owner = factories.user(role="OWNER")
    org = factories.org_for_user(user=owner, status=OrganizationStatus.DRAFT)
    db_session.commit()

    resp = api.as_user(admin).post(
        f"/admin/organizations/{org.id}/verify",
        json={},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "ORGANIZATION_NOT_REVIEWABLE"


def test_admin_verify_org_requires_admin_role(api, factories, db_session, fake_storage):
    """Owner role → 401/403. Verification is staff-only."""
    other_owner = factories.user(role="OWNER", email="other@example.com")
    _, org_id = _under_review_org(api, factories, db_session)

    resp = api.as_user(other_owner).post(
        f"/admin/organizations/{org_id}/verify", json={}
    )
    assert resp.status_code in (401, 403), resp.text


# ---------------------------------------------------------------------------
# Reject
# ---------------------------------------------------------------------------
def test_admin_reject_org_transitions_to_rejected_with_reason(
    api, factories, db_session, fake_storage,
):
    admin = factories.admin()
    _, org_id = _under_review_org(api, factories, db_session)

    resp = api.as_user(admin).post(
        f"/admin/organizations/{org_id}/reject",
        json={"reason": "Filing does not match the registered LLC name."},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == OrganizationStatus.REJECTED.value
    assert body["decision_note"] == "Filing does not match the registered LLC name."
    assert body["decided_by_user_id"] == str(admin.id)


def test_admin_reject_org_requires_reason(
    api, factories, db_session, fake_storage,
):
    """reason is min_length=3 at the schema layer. Empty body or
    short reason → 422 with the standard envelope."""
    admin = factories.admin()
    _, org_id = _under_review_org(api, factories, db_session)

    resp = api.as_user(admin).post(
        f"/admin/organizations/{org_id}/reject",
        json={},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_admin_reject_org_rejects_non_under_review(
    api, factories, db_session, fake_storage,
):
    """Mirror of verify guard — REJECTED orgs can't be re-rejected."""
    admin = factories.admin()
    owner = factories.user(role="OWNER")
    org = factories.org_for_user(
        user=owner, status=OrganizationStatus.REJECTED
    )
    db_session.commit()

    resp = api.as_user(admin).post(
        f"/admin/organizations/{org.id}/reject",
        json={"reason": "Already done"},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "ORGANIZATION_NOT_REVIEWABLE"


# ---------------------------------------------------------------------------
# List + status filter
# ---------------------------------------------------------------------------
def test_admin_org_list_filters_by_status(
    api, factories, db_session, fake_storage,
):
    """Status filter narrows the queue to just one bucket. Useful
    for the verification queue UI."""
    admin = factories.admin()
    factories.org_for_user(
        user=factories.user(role="OWNER", email="a@example.com"),
        name="Verified Co",
        status=OrganizationStatus.VERIFIED,
    )
    factories.org_for_user(
        user=factories.user(role="OWNER", email="b@example.com"),
        name="Under Review Co",
        status=OrganizationStatus.UNDER_REVIEW,
    )
    factories.org_for_user(
        user=factories.user(role="OWNER", email="c@example.com"),
        name="Draft Co",
        status=OrganizationStatus.DRAFT,
    )
    db_session.commit()

    resp = api.as_user(admin).get(
        "/admin/organizations?status=UNDER_REVIEW"
    )
    assert resp.status_code == 200, resp.text
    names = {o["name"] for o in resp.json()}
    assert names == {"Under Review Co"}


def test_admin_org_list_embeds_attachments(
    api, factories, db_session, fake_storage,
):
    """OrganizationAdminRead now carries an attachments[] field so
    the queue can show 'N documents' inline without a per-row fetch."""
    admin = factories.admin()
    _, org_id = _under_review_org(api, factories, db_session, name="Has Files Co")

    resp = api.as_user(admin).get("/admin/organizations?status=UNDER_REVIEW")
    assert resp.status_code == 200, resp.text
    rows = [r for r in resp.json() if r["id"] == org_id]
    assert len(rows) == 1
    assert len(rows[0]["attachments"]) == 1


# ---------------------------------------------------------------------------
# Attachments viewer
# ---------------------------------------------------------------------------
def test_admin_list_org_attachments_returns_metadata(
    api, factories, db_session, fake_storage,
):
    admin = factories.admin()
    _, org_id = _under_review_org(api, factories, db_session)

    resp = api.as_user(admin).get(
        f"/admin/organizations/{org_id}/attachments"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["original_filename"] == "filing.pdf"


def test_admin_signed_url_calls_storage_with_short_ttl(
    api, factories, db_session, fake_storage,
):
    """Click 'View' on an org attachment → endpoint asks storage
    for a fresh signed URL with a 60s TTL."""
    admin = factories.admin()
    _, org_id = _under_review_org(api, factories, db_session)

    listing = api.as_user(admin).get(
        f"/admin/organizations/{org_id}/attachments"
    )
    attachment_id = listing.json()[0]["id"]

    resp = api.as_user(admin).get(
        f"/admin/organizations/{org_id}/attachments/{attachment_id}/url"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["expires_in_seconds"] == 60
    assert body["url"].startswith("https://fake-storage.local/")
    assert body["original_filename"] == "filing.pdf"

    # Storage was asked for a signed URL.
    assert len(fake_storage.signed_urls) == 1
    path, ttl = fake_storage.signed_urls[0]
    assert path.startswith(f"organizations/{org_id}/")
    assert ttl == 60


def test_admin_signed_url_404_on_mismatched_org_id(
    api, factories, db_session, fake_storage,
):
    """Real attachment id but for a different org → 404
    ATTACHMENT_NOT_FOUND. Defends against a guessed UUID surfacing
    files for an unrelated org."""
    admin = factories.admin()
    _, org_a = _under_review_org(api, factories, db_session, name="Org A")
    _, org_b = _under_review_org(
        api, factories, db_session, name="Org B"
    )

    listing = api.as_user(admin).get(
        f"/admin/organizations/{org_a}/attachments"
    )
    attachment_id = listing.json()[0]["id"]

    resp = api.as_user(admin).get(
        f"/admin/organizations/{org_b}/attachments/{attachment_id}/url"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "ATTACHMENT_NOT_FOUND"
