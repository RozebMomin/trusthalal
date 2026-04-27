"""Integration tests for owner-uploaded evidence attachments.

Covers POST /me/ownership-requests/{id}/attachments and GET ditto:
the multipart upload path with all the validation guards (auth,
ownership, MIME allow-list, size cap, count cap), and the per-claim
listing the owner can call to see what they've already attached.

The Supabase Storage client is swapped for an in-memory fake via the
FastAPI dependency override mechanism — same pattern as how the
Google Place Details fetcher gets stubbed elsewhere. The fake
records every upload + delete it sees so we can assert the storage
contract without a live network call.
"""
from __future__ import annotations

from io import BytesIO

import pytest
from sqlalchemy import select

from app.core.storage import get_storage_client
from app.modules.ownership_requests.models import OwnershipRequestAttachment


# ---------------------------------------------------------------------------
# In-memory storage fake
# ---------------------------------------------------------------------------
class _FakeStorageClient:
    """Tiny in-memory StorageClient implementation for tests.

    Records every upload + delete call. Hand-written rather than a
    Mock so failures point at our code, not at MagicMock attribute
    drift.
    """

    bucket = "evidence-test"

    def __init__(self) -> None:
        self.uploaded: dict[str, tuple[bytes, str]] = {}
        self.signed_urls: list[tuple[str, int]] = []
        self.deleted: list[str] = []

    def upload_bytes(
        self, path: str, data: bytes, *, content_type: str
    ) -> None:
        self.uploaded[path] = (data, content_type)

    def signed_url(self, path: str, *, expires_in_seconds: int) -> str:
        self.signed_urls.append((path, expires_in_seconds))
        return f"https://fake-storage.local/{self.bucket}/{path}?token=stub"

    def delete_object(self, path: str) -> None:
        self.deleted.append(path)


@pytest.fixture
def fake_storage():
    """Override the storage dependency on the FastAPI app and return
    the fake instance so tests can inspect it. Tears down the
    override after the test to avoid leaking state into other tests
    that use the same app.

    Mirrors the conftest's ``api`` fixture pattern (which overrides
    ``get_db``): import the app directly from app.main, write the
    override, yield, and pop on teardown.
    """
    from app.main import app as fastapi_app

    fake = _FakeStorageClient()
    fastapi_app.dependency_overrides[get_storage_client] = lambda: fake
    try:
        yield fake
    finally:
        fastapi_app.dependency_overrides.pop(get_storage_client, None)


def _claim_for(api, factories, db_session, owner, place):
    """Submit a real ownership request via the API so subsequent
    upload tests have a request_id to attach against. Returns the
    new request's UUID.

    Slice 5b coupling: every claim now requires a sponsoring org
    that's at least UNDER_REVIEW. This helper materializes a
    VERIFIED org for the owner inline so per-test setup doesn't
    repeat the boilerplate.
    """
    org = factories.org_for_user(user=owner)
    db_session.commit()
    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={"organization_id": str(org.id), "place_id": str(place.id)},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------
def test_upload_attachment_writes_storage_and_persists_metadata(
    api, factories, db_session, fake_storage):
    """A valid PDF upload:
      * uploads to the storage backend at the expected path shape.
      * persists a metadata row linked to the parent claim.
      * returns the row in the documented wire shape.
    """
    owner = factories.user(role="OWNER", display_name="Olivia Owner")
    place = factories.place(name="Khan Halal")
    db_session.commit()

    request_id = _claim_for(api, factories, db_session, owner, place)

    pdf_bytes = b"%PDF-1.4\n%fake-pdf-content"
    resp = api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={
            "file": ("utility-bill-march.pdf", BytesIO(pdf_bytes), "application/pdf"),
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["original_filename"] == "utility-bill-march.pdf"
    assert body["content_type"] == "application/pdf"
    assert body["size_bytes"] == len(pdf_bytes)
    assert body["request_id"] == request_id

    # Storage contract: one upload at the expected path + content-type.
    assert len(fake_storage.uploaded) == 1
    [(path, (data, content_type))] = fake_storage.uploaded.items()
    assert path.startswith(f"ownership-requests/{request_id}/")
    assert path.endswith(".pdf")
    assert data == pdf_bytes
    assert content_type == "application/pdf"

    # DB state: one row, owned by this request, with the same path.
    row = db_session.execute(
        select(OwnershipRequestAttachment)
    ).scalar_one()
    assert str(row.request_id) == request_id
    assert row.storage_path == path


def test_upload_attachment_truncates_overlong_filename(
    api, factories, db_session, fake_storage):
    """Filenames > 512 chars get head-trimmed at the column limit so
    the insert doesn't blow up. Pathological but cheap to defend
    against."""
    owner = factories.user(role="OWNER")
    place = factories.place(name="Long Filename")
    db_session.commit()

    request_id = _claim_for(api, factories, db_session, owner, place)

    long_name = ("a" * 600) + ".pdf"
    resp = api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={
            "file": (long_name, BytesIO(b"%PDF-1.4 short body"), "application/pdf"),
        },
    )
    assert resp.status_code == 201, resp.text
    assert len(resp.json()["original_filename"]) == 512


# ---------------------------------------------------------------------------
# Auth + ownership
# ---------------------------------------------------------------------------
def test_upload_attachment_requires_authentication(api, factories, db_session, fake_storage):
    """No session → 401. Storage isn't even hit."""
    owner = factories.user(role="OWNER")
    place = factories.place(name="Auth Required")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    # Anonymous: pass an empty client (no as_user) and watch it 401.
    resp = api.post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("x.pdf", BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert resp.status_code == 401, resp.text


def test_upload_attachment_blocks_non_owner_caller(api, factories, db_session, fake_storage):
    """Caller doesn't own the parent claim → 403. Even if the UUID
    is real."""
    owner = factories.user(role="OWNER", email="own@example.com")
    other = factories.user(role="OWNER", email="other@example.com")
    place = factories.place(name="Cross Tenant")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    resp = api.as_user(other).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("x.pdf", BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["error"]["code"] == "OWNERSHIP_REQUEST_FORBIDDEN"


def test_upload_attachment_404_on_unknown_request(api, factories, fake_storage):
    """Caller is fine, parent claim UUID is unknown → 404."""
    owner = factories.user(role="OWNER")

    resp = api.as_user(owner).post(
        "/me/ownership-requests/00000000-0000-0000-0000-000000000000/attachments",
        files={"file": ("x.pdf", BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "OWNERSHIP_REQUEST_NOT_FOUND"


# ---------------------------------------------------------------------------
# MIME / size / count guards
# ---------------------------------------------------------------------------
def test_upload_attachment_rejects_disallowed_mime_type(
    api, factories, db_session, fake_storage):
    """Office docs are not on the allow-list — they can carry macros
    and we don't want admin staff opening one. 400 with a stable
    code."""
    owner = factories.user(role="OWNER")
    place = factories.place(name="No Macros Plz")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    resp = api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={
            "file": (
                "evil.docx",
                BytesIO(b"PK fake docx"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
        },
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "ATTACHMENT_TYPE_NOT_ALLOWED"


def test_upload_attachment_rejects_empty_file(api, factories, db_session, fake_storage):
    """Zero-byte upload → 400. Avoids cluttering storage with
    no-op rows the user almost certainly didn't mean to send."""
    owner = factories.user(role="OWNER")
    place = factories.place(name="Empty Body")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    resp = api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("empty.pdf", BytesIO(b""), "application/pdf")},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "ATTACHMENT_EMPTY"


def test_upload_attachment_rejects_oversize_file(api, factories, db_session, fake_storage):
    """File > 10 MB → 400 with a clear code. Storage isn't touched."""
    owner = factories.user(role="OWNER")
    place = factories.place(name="Too Big")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    oversize = b"\x00" * (10 * 1024 * 1024 + 1)  # one byte over the cap
    resp = api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("big.pdf", BytesIO(oversize), "application/pdf")},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "ATTACHMENT_TOO_LARGE"
    assert fake_storage.uploaded == {}


def test_upload_attachment_enforces_per_claim_count_cap(
    api, factories, db_session, fake_storage):
    """Sixth file → 409 ATTACHMENT_LIMIT_REACHED. The cap matches
    the v1 application-level limit (5 per claim)."""
    owner = factories.user(role="OWNER")
    place = factories.place(name="Cap Test")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    # Five succeed.
    for i in range(5):
        resp = api.as_user(owner).post(
            f"/me/ownership-requests/{request_id}/attachments",
            files={
                "file": (
                    f"file-{i}.pdf",
                    BytesIO(b"%PDF-1.4\n" + bytes(str(i), "ascii")),
                    "application/pdf",
                ),
            },
        )
        assert resp.status_code == 201, resp.text

    # Sixth rejects.
    over = api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("six.pdf", BytesIO(b"%PDF-1.4 sixth"), "application/pdf")},
    )
    assert over.status_code == 409, over.text
    assert over.json()["error"]["code"] == "ATTACHMENT_LIMIT_REACHED"


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------
def test_list_my_attachments_scoped_to_caller(api, factories, db_session, fake_storage):
    """GET /me/ownership-requests/{id}/attachments returns only the
    files attached to the caller's own claim. Cross-tenant access
    gets the same 403 as the upload path."""
    owner = factories.user(role="OWNER", email="me@example.com")
    other = factories.user(role="OWNER", email="other@example.com")
    place = factories.place(name="List Test")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("ub.pdf", BytesIO(b"%PDF-1.4 utility"), "application/pdf")},
    )

    # Owner sees their attachment.
    listing = api.as_user(owner).get(
        f"/me/ownership-requests/{request_id}/attachments"
    )
    assert listing.status_code == 200, listing.text
    assert len(listing.json()) == 1
    assert listing.json()[0]["original_filename"] == "ub.pdf"

    # Other user can't peek at it.
    blocked = api.as_user(other).get(
        f"/me/ownership-requests/{request_id}/attachments"
    )
    assert blocked.status_code == 403, blocked.text


# ---------------------------------------------------------------------------
# Admin viewer — list + signed URL
# ---------------------------------------------------------------------------
def test_admin_list_attachments_returns_metadata(
    api, factories, db_session, fake_storage,
):
    """GET /admin/ownership-requests/{id}/attachments returns the
    same metadata shape the owner sees, scoped to admin role."""
    admin = factories.admin()
    owner = factories.user(role="OWNER")
    place = factories.place(name="Admin Lists")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("a.pdf", BytesIO(b"%PDF-1.4 a"), "application/pdf")},
    )

    resp = api.as_user(admin).get(
        f"/admin/ownership-requests/{request_id}/attachments"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["original_filename"] == "a.pdf"


def test_admin_list_attachments_requires_admin_role(api, factories, db_session, fake_storage):
    """Non-admin (e.g. an OWNER) → 401/403. Owner has /me variant for
    their own files; the admin one is staff-only."""
    owner = factories.user(role="OWNER")
    other_owner = factories.user(role="OWNER", email="other@example.com")
    place = factories.place(name="Role Gate")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    resp = api.as_user(other_owner).get(
        f"/admin/ownership-requests/{request_id}/attachments"
    )
    assert resp.status_code in (401, 403), resp.text


def test_admin_signed_url_calls_storage_with_short_ttl(
    api, factories, db_session, fake_storage,
):
    """Admin clicks 'View' → endpoint asks the storage backend for a
    fresh signed URL with a short TTL (60s by default) and returns
    the URL plus filename + content_type for the client."""
    admin = factories.admin()
    owner = factories.user(role="OWNER")
    place = factories.place(name="Signed URL Test")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    upload = api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={
            "file": (
                "license.pdf",
                BytesIO(b"%PDF-1.4 license"),
                "application/pdf",
            ),
        },
    )
    attachment_id = upload.json()["id"]

    resp = api.as_user(admin).get(
        f"/admin/ownership-requests/{request_id}"
        f"/attachments/{attachment_id}/url"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["original_filename"] == "license.pdf"
    assert body["content_type"] == "application/pdf"
    assert body["expires_in_seconds"] == 60
    assert body["url"].startswith("https://fake-storage.local/")

    # Storage was asked for a signed URL at the right path + TTL.
    assert len(fake_storage.signed_urls) == 1
    path, ttl = fake_storage.signed_urls[0]
    assert path.endswith(".pdf")
    assert ttl == 60


def test_admin_signed_url_404_on_mismatched_request_id(
    api, factories, db_session, fake_storage,
):
    """Attachment id is real but belongs to a different request →
    404 ATTACHMENT_NOT_FOUND. Defends against a guessed UUID
    surfacing files for an unrelated claim."""
    admin = factories.admin()
    owner = factories.user(role="OWNER")
    place_a = factories.place(name="Place A")
    place_b = factories.place(name="Place B")
    db_session.commit()
    request_a = _claim_for(api, factories, db_session, owner, place_a)
    request_b = _claim_for(api, factories, db_session, owner, place_b)

    upload = api.as_user(owner).post(
        f"/me/ownership-requests/{request_a}/attachments",
        files={"file": ("x.pdf", BytesIO(b"%PDF-1.4 x"), "application/pdf")},
    )
    attachment_id = upload.json()["id"]

    # Same attachment id, wrong request id in the URL.
    resp = api.as_user(admin).get(
        f"/admin/ownership-requests/{request_b}"
        f"/attachments/{attachment_id}/url"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "ATTACHMENT_NOT_FOUND"


def test_admin_ownership_request_list_embeds_attachments(
    api, factories, db_session, fake_storage,
):
    """OwnershipRequestAdminRead now carries an ``attachments`` list
    so the admin review queue can render evidence count without a
    per-row roundtrip."""
    admin = factories.admin()
    owner = factories.user(role="OWNER")
    place = factories.place(name="Admin Embed")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("ub.pdf", BytesIO(b"%PDF-1.4 ub"), "application/pdf")},
    )

    listing = api.as_user(admin).get("/admin/ownership-requests")
    assert listing.status_code == 200, listing.text
    rows = [r for r in listing.json() if r["id"] == request_id]
    assert len(rows) == 1
    assert len(rows[0]["attachments"]) == 1
    assert rows[0]["attachments"][0]["original_filename"] == "ub.pdf"


def test_my_ownership_requests_list_embeds_attachments(
    api, factories, db_session, fake_storage):
    """GET /me/ownership-requests now embeds the per-claim
    attachments list so the /my-claims page can render filenames
    inline without a per-row roundtrip."""
    owner = factories.user(role="OWNER")
    place = factories.place(name="Embedded")
    db_session.commit()
    request_id = _claim_for(api, factories, db_session, owner, place)

    api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("a.pdf", BytesIO(b"%PDF-1.4 a"), "application/pdf")},
    )
    api.as_user(owner).post(
        f"/me/ownership-requests/{request_id}/attachments",
        files={"file": ("b.pdf", BytesIO(b"%PDF-1.4 b"), "application/pdf")},
    )

    resp = api.as_user(owner).get("/me/ownership-requests")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    filenames = {a["original_filename"] for a in body[0]["attachments"]}
    assert filenames == {"a.pdf", "b.pdf"}
