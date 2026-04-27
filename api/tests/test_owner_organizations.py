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
        json={"name": "Khan Halal LLC", "contact_email": "khan@example.com"},
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
        "/me/organizations", json={"name": "Mine LLC"}
    )
    api.as_user(other).post(
        "/me/organizations", json={"name": "Theirs LLC"}
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
        "/me/organizations", json={"name": "Removed Membership Co"}
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
    resp = api.post("/me/organizations", json={"name": "Anonymous"})
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
        "/me/organizations", json={"name": "Members Only LLC"}
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
        "/me/organizations", json={"name": "Original Co"}
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
        "/me/organizations", json={"name": "Same Name Co"}
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
        "/me/organizations", json={"name": "Verified Co"}
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
        "/me/organizations", json={"name": "Empty Draft Co"}
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
        "/me/organizations", json={"name": "Submit OK Co"}
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
        "/me/organizations", json={"name": "Idempotent Co"}
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
        "/me/organizations", json={"name": "Locked Co"}
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
        "/me/organizations", json={"name": "Files Co"}
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
        "/me/organizations", json={"name": "Closed Co"}
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
        "/me/organizations", json={"name": "MIME Gate Co"}
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
        "/me/organizations", json={"name": "Frozen Co"}
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
        "/me/organizations", json={"name": "Detail Embed Co"}
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
