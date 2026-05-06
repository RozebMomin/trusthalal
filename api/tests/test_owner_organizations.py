"""Integration tests for the owner-portal organization self-service.

Covers /me/organizations CRUD + /me/organizations/{id}/submit + the
attachment subroutes. The Supabase Storage client is overridden in
the tests that exercise upload paths, same fake_storage fixture
pattern as test_owner_attachments.
"""
from __future__ import annotations

from io import BytesIO

import pytest
from sqlalchemy import select

from app.core.storage import get_storage_client
from app.modules.organizations.enums import OrganizationStatus
from app.modules.organizations.models import (
    Organization,
    OrganizationAttachment,
    OrganizationMember,
)


# Required fields the schema enforces on POST /me/organizations.
# Address fields landed in polish-pass-v2; contact_email landed in
# polish-pass-v3. Spread with ``**VALID_ORG_FIELDS`` to keep test
# bodies focused on the behavior under test rather than re-typing
# the boilerplate.
VALID_ORG_FIELDS = {
    "contact_email": "owner@example.com",
    "address": "123 Test St",
    "city": "Detroit",
    "region": "MI",
    "country_code": "US",
    "postal_code": "48201",
}
# Old name kept as an alias for any downstream test that still
# references it; new tests should use VALID_ORG_FIELDS.
VALID_ADDRESS = VALID_ORG_FIELDS


# ---------------------------------------------------------------------------
# Storage fake (same pattern used in test_owner_attachments.py)
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
    """Override get_storage_client on the FastAPI app for tests that
    exercise the upload path."""
    from app.main import app as fastapi_app

    fake = _FakeStorageClient()
    fastapi_app.dependency_overrides[get_storage_client] = lambda: fake
    try:
        yield fake
    finally:
        fastapi_app.dependency_overrides.pop(get_storage_client, None)


# ---------------------------------------------------------------------------
# Create + list
# ---------------------------------------------------------------------------
def test_create_my_organization_starts_at_draft_and_joins_creator(
    api, factories, db_session
):
    """POST /me/organizations creates a DRAFT org, auto-joins the
    caller as OWNER_ADMIN."""
    owner = factories.user(role="OWNER", display_name="Olivia")
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/organizations",
        json={
            "name": "Khan Halal LLC",
            "contact_email": "khan@example.com",
            **VALID_ADDRESS,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Khan Halal LLC"
    assert body["contact_email"] == "khan@example.com"
    assert body["status"] == OrganizationStatus.DRAFT.value
    assert body["submitted_at"] is None
    assert body["attachments"] == []

    # DB: org exists, owner is an ACTIVE OWNER_ADMIN member, created_by
    # matches.
    org_row = db_session.execute(
        select(Organization).where(Organization.id == body["id"])
    ).scalar_one()
    assert org_row.created_by_user_id == owner.id

    member_row = db_session.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_row.id,
            OrganizationMember.user_id == owner.id,
        )
    ).scalar_one()
    assert member_row.status == "ACTIVE"
    assert member_row.role == "OWNER_ADMIN"


def test_list_my_organizations_scoped_to_caller(api, factories, db_session):
    """List endpoint only returns orgs where caller is an ACTIVE
    member. Cross-tenant orgs are invisible."""
    me = factories.user(role="OWNER", email="me@example.com")
    other = factories.user(role="OWNER", email="other@example.com")
    db_session.commit()

    api.as_user(me).post(
        "/me/organizations", json={"name": "Mine LLC", **VALID_ADDRESS}
    )
    api.as_user(other).post(
        "/me/organizations", json={"name": "Theirs LLC", **VALID_ADDRESS}
    )

    resp = api.as_user(me).get("/me/organizations")
    assert resp.status_code == 200, resp.text
    names = [o["name"] for o in resp.json()]
    assert names == ["Mine LLC"]


def test_list_my_organizations_excludes_removed_memberships(
    api, factories, db_session
):
    """Memberships flipped to REMOVED no longer surface the org in
    the user's list — historical context belongs in admin views."""
    owner = factories.user(role="OWNER")
    db_session.commit()

    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Removed Membership Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    # Flip the membership to REMOVED out-of-band.
    member = db_session.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == owner.id,
        )
    ).scalar_one()
    member.status = "REMOVED"
    db_session.add(member)
    db_session.commit()

    listing = api.as_user(owner).get("/me/organizations")
    assert listing.status_code == 200, listing.text
    assert listing.json() == []


def test_create_my_organization_requires_authentication(api):
    # Send a complete (validation-passing) payload so the failure
    # is unambiguously the auth gate, not a missing address field.
    resp = api.post(
        "/me/organizations",
        json={"name": "Anonymous", **VALID_ADDRESS},
    )
    assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# Detail + access control
# ---------------------------------------------------------------------------
def test_get_my_organization_404_on_unknown_id(api, factories):
    owner = factories.user(role="OWNER")
    resp = api.as_user(owner).get(
        "/me/organizations/00000000-0000-0000-0000-000000000000"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_NOT_FOUND"


def test_get_my_organization_403_when_not_a_member(api, factories, db_session):
    """Real org id, but caller isn't a member → 403."""
    owner = factories.user(role="OWNER", email="own@example.com")
    other = factories.user(role="OWNER", email="other@example.com")
    db_session.commit()

    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Members Only LLC", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    resp = api.as_user(other).get(f"/me/organizations/{org_id}")
    assert resp.status_code == 403, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_FORBIDDEN"


# ---------------------------------------------------------------------------
# Patch
# ---------------------------------------------------------------------------
def test_patch_my_organization_updates_name_and_email(
    api, factories, db_session
):
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Original Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    resp = api.as_user(owner).patch(
        f"/me/organizations/{org_id}",
        json={"name": "Renamed Co", "contact_email": "new@example.com"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Renamed Co"
    assert body["contact_email"] == "new@example.com"


def test_patch_my_organization_no_fields_returns_409(
    api, factories, db_session
):
    """Calling patch with only same-as-current values surfaces
    NO_FIELDS so the client can no-op the toast."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Same Name Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    resp = api.as_user(owner).patch(
        f"/me/organizations/{org_id}", json={"name": "Same Name Co"}
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "NO_FIELDS"


def test_patch_my_organization_locked_after_verified(
    api, factories, db_session
):
    """Once admin verifies an org the row is audit-immutable.
    Owner-side patch returns 409 with the stable code so the UI can
    surface 'contact support'."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Verified Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    # Force VERIFIED out-of-band (admin path will land in slice 5c).
    org = db_session.execute(
        select(Organization).where(Organization.id == org_id)
    ).scalar_one()
    org.status = OrganizationStatus.VERIFIED.value
    db_session.add(org)
    db_session.commit()

    resp = api.as_user(owner).patch(
        f"/me/organizations/{org_id}", json={"name": "After Lock"}
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_NOT_EDITABLE"


# ---------------------------------------------------------------------------
# Submit for review
# ---------------------------------------------------------------------------
def test_submit_organization_requires_attachment(api, factories, db_session):
    """A bare DRAFT can't be submitted — admin needs evidence to
    review."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Empty Draft Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    resp = api.as_user(owner).post(
        f"/me/organizations/{org_id}/submit"
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_EVIDENCE_REQUIRED"


def test_submit_organization_with_attachment_moves_to_under_review(
    api, factories, db_session, fake_storage,
):
    """Happy path: draft + file → submit → UNDER_REVIEW with
    submitted_at populated."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Submit OK Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files={
            "file": (
                "filing.pdf",
                BytesIO(b"%PDF-1.4 articles"),
                "application/pdf",
            ),
        },
    )

    resp = api.as_user(owner).post(
        f"/me/organizations/{org_id}/submit"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == OrganizationStatus.UNDER_REVIEW.value
    assert body["submitted_at"] is not None


def test_submit_organization_idempotent_when_already_under_review(
    api, factories, db_session, fake_storage,
):
    """Resubmitting an UNDER_REVIEW org is a no-op rather than
    erroring — clients that retry on flaky network shouldn't get
    409s."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Idempotent Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files={"file": ("a.pdf", BytesIO(b"%PDF-1.4 a"), "application/pdf")},
    )
    first = api.as_user(owner).post(f"/me/organizations/{org_id}/submit")
    second = api.as_user(owner).post(f"/me/organizations/{org_id}/submit")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["status"] == OrganizationStatus.UNDER_REVIEW.value


def test_submit_organization_blocked_after_verified(
    api, factories, db_session, fake_storage,
):
    """Once VERIFIED, submit returns NOT_SUBMITTABLE — the
    happy-path flow shouldn't be re-runnable from a stale tab."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Locked Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    org = db_session.execute(
        select(Organization).where(Organization.id == org_id)
    ).scalar_one()
    org.status = OrganizationStatus.VERIFIED.value
    db_session.add(org)
    db_session.commit()

    resp = api.as_user(owner).post(f"/me/organizations/{org_id}/submit")
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_NOT_SUBMITTABLE"


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------
def test_upload_attachment_writes_storage_and_persists_metadata(
    api, factories, db_session, fake_storage,
):
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Files Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    pdf = b"%PDF-1.4 sos filing"
    resp = api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files={
            "file": ("articles-of-org.pdf", BytesIO(pdf), "application/pdf"),
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["original_filename"] == "articles-of-org.pdf"
    assert body["size_bytes"] == len(pdf)

    # Storage path encodes the org id.
    [(path, _)] = fake_storage.uploaded.items()
    assert path.startswith(f"organizations/{org_id}/")
    assert path.endswith(".pdf")

    row = db_session.execute(
        select(OrganizationAttachment).where(
            OrganizationAttachment.organization_id == org_id
        )
    ).scalar_one()
    assert row.storage_path == path


def test_upload_attachment_blocks_non_member(
    api, factories, db_session, fake_storage,
):
    owner = factories.user(role="OWNER", email="own@example.com")
    other = factories.user(role="OWNER", email="other@example.com")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Closed Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    resp = api.as_user(other).post(
        f"/me/organizations/{org_id}/attachments",
        files={"file": ("x.pdf", BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_FORBIDDEN"


def test_upload_attachment_rejects_disallowed_mime(
    api, factories, db_session, fake_storage,
):
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "MIME Gate Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    resp = api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files={
            "file": (
                "evil.docx",
                BytesIO(b"PK fake docx"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
        },
    )
    assert resp.status_code == 400, resp.text
    assert (
        resp.json()["error"]["code"] == "ORGANIZATION_ATTACHMENT_TYPE_NOT_ALLOWED"
    )


def test_upload_attachment_blocked_after_verified(
    api, factories, db_session, fake_storage,
):
    """Locked-once-verified mirrors the patch contract — admin-side
    sign-off freezes the row."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Frozen Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    org = db_session.execute(
        select(Organization).where(Organization.id == org_id)
    ).scalar_one()
    org.status = OrganizationStatus.VERIFIED.value
    db_session.add(org)
    db_session.commit()

    resp = api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files={"file": ("a.pdf", BytesIO(b"%PDF-1.4 a"), "application/pdf")},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_NOT_EDITABLE"


def test_my_organization_detail_embeds_attachments(
    api, factories, db_session, fake_storage,
):
    """GET /me/organizations/{id} embeds the attachments list so the
    detail page renders without a per-row roundtrip."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Detail Embed Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files={"file": ("a.pdf", BytesIO(b"%PDF-1.4 a"), "application/pdf")},
    )
    api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files={"file": ("b.pdf", BytesIO(b"%PDF-1.4 b"), "application/pdf")},
    )

    detail = api.as_user(owner).get(f"/me/organizations/{org_id}")
    assert detail.status_code == 200, detail.text
    names = {a["original_filename"] for a in detail.json()["attachments"]}
    assert names == {"a.pdf", "b.pdf"}


# ---------------------------------------------------------------------------
# Owner-self attachment signed URL — companion to the admin variant.
# After a REJECTED decision the owner needs to re-open what they sent
# before deciding how to revise. Same 60s TTL + ownership posture as
# the admin path; ownership check is membership-based rather than role.
# ---------------------------------------------------------------------------
def test_my_org_attachment_signed_url_returns_storage_url(
    api, factories, db_session, fake_storage,
):
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Signed URL Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    upload = api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files={
            "file": (
                "filing.pdf",
                BytesIO(b"%PDF-1.4 articles"),
                "application/pdf",
            ),
        },
    )
    attachment_id = upload.json()["id"]

    resp = api.as_user(owner).get(
        f"/me/organizations/{org_id}/attachments/{attachment_id}/url"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["expires_in_seconds"] == 60
    assert body["url"].startswith("https://fake-storage.local/")
    assert body["original_filename"] == "filing.pdf"
    assert body["content_type"] == "application/pdf"

    # Storage was asked exactly once with the org-scoped path.
    assert len(fake_storage.signed_urls) == 1
    path, ttl = fake_storage.signed_urls[0]
    assert path.startswith(f"organizations/{org_id}/")
    assert ttl == 60


def test_my_org_attachment_signed_url_403_when_not_a_member(
    api, factories, db_session, fake_storage,
):
    """A different owner can't mint a signed URL for someone else's
    org attachment — same membership gate as every other /me/org
    route, so 403 OWNER_ORGANIZATION_FORBIDDEN."""
    owner = factories.user(role="OWNER", email="own@example.com")
    other = factories.user(role="OWNER", email="other@example.com")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Private Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    upload = api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files={"file": ("x.pdf", BytesIO(b"%PDF-1.4 x"), "application/pdf")},
    )
    attachment_id = upload.json()["id"]

    resp = api.as_user(other).get(
        f"/me/organizations/{org_id}/attachments/{attachment_id}/url"
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_FORBIDDEN"


def test_my_org_attachment_signed_url_404_on_mismatched_org(
    api, factories, db_session, fake_storage,
):
    """Real attachment id but the URL targets a different org the
    caller also owns — 404 so a guessed UUID can't surface another
    org's files even within the caller's own portfolio."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create_a = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Org A", **VALID_ADDRESS},
    )
    org_a_id = create_a.json()["id"]
    create_b = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Org B", **VALID_ADDRESS},
    )
    org_b_id = create_b.json()["id"]

    upload = api.as_user(owner).post(
        f"/me/organizations/{org_a_id}/attachments",
        files={"file": ("a.pdf", BytesIO(b"%PDF-1.4 a"), "application/pdf")},
    )
    attachment_id = upload.json()["id"]

    # Path-org is B but the attachment lives on A.
    resp = api.as_user(owner).get(
        f"/me/organizations/{org_b_id}/attachments/{attachment_id}/url"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORG_ATTACHMENT_NOT_FOUND"


def test_my_org_attachment_signed_url_404_on_unknown_attachment_id(
    api, factories, db_session, fake_storage,
):
    """Bogus attachment id under a real org → same 404. Owner has
    a clean error rather than a 500 from the storage call."""
    owner = factories.user(role="OWNER")
    db_session.commit()
    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "404 Co", **VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    bogus = "00000000-0000-0000-0000-000000000000"
    resp = api.as_user(owner).get(
        f"/me/organizations/{org_id}/attachments/{bogus}/url"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORG_ATTACHMENT_NOT_FOUND"
