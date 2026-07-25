"""Integration tests for the admin bulk add-places flow.

Two endpoints under test:

  * ``POST /admin/places/bulk/preview`` — a Google-free dedup check. Given a
    list of Google IDs, it says which are NEW / EXISTS / SOFT_DELETED via a
    single DB lookup. No fetcher is involved.
  * ``POST /admin/places/bulk/import`` — loops the idempotent single-place
    ingest, one transaction per ID, and reports a per-item outcome so one bad
    row never sinks the batch.

Both reuse ``ingest_google_place``; the fetcher is faked exactly as in
``test_place_ingest.py`` (patch the symbol the ingest module resolves at call
time) so no network happens. The import tests use a *dispatching* fetcher so a
single batch can mix good IDs, incomplete payloads, and NOT_FOUND errors.
"""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select

from app.core.exceptions import NotFoundError
from app.modules.places.ingest import ingest_google_place
from app.modules.places.models import Place, PlaceExternalId


_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "google_places"


def _fixture(name: str) -> dict:
    return json.loads((_FIXTURE_DIR / name).read_text())


def _fetcher_for(payload: dict):
    def _fetch(_place_id: str):
        return payload

    return _fetch


def _dispatch_fetcher(
    good_payload: dict,
    *,
    incomplete_ids: frozenset[str] = frozenset(),
    notfound_ids: frozenset[str] = frozenset(),
):
    """A fetcher that varies its answer by place_id.

    Lets one bulk-import call exercise the whole outcome matrix: good IDs get
    the real fixture, ``incomplete_ids`` get a payload with no name/lat/lng
    (→ GOOGLE_PAYLOAD_INCOMPLETE), and ``notfound_ids`` raise NotFoundError
    the way the real client does on a stale ID.
    """

    def _fetch(place_id: str):
        if place_id in notfound_ids:
            raise NotFoundError(
                "GOOGLE_PLACE_NOT_FOUND",
                f"Google Places returned NOT_FOUND for place_id {place_id!r}",
            )
        if place_id in incomplete_ids:
            return {"status": "OK", "result": {"place_id": place_id}}
        return good_payload

    return _fetch


def _patch_fetcher(monkeypatch, fetcher):
    """Install ``fetcher`` as the Google Place Details fetcher for this test.

    The router calls ``ingest_google_place`` without a fetcher, so it falls
    through to the module-level ``fetch_place_details_google``. Patching the
    name on the ingest module swaps the real HTTP call for every ID in the
    batch.
    """
    from app.modules.places import ingest as ingest_mod

    monkeypatch.setattr(ingest_mod, "fetch_place_details_google", fetcher)


# ---------------------------------------------------------------------------
# Preview — dedup verdict matrix (NEW / EXISTS / SOFT_DELETED)
# ---------------------------------------------------------------------------
def test_bulk_preview_status_matrix(api, factories, db_session):
    admin = factories.admin()
    payload = _fixture("us_nyc_locality.json")

    # Seed one live place (EXISTS) and one that we then soft-delete
    # (SOFT_DELETED). Seeding via the service commits, so the preview
    # endpoint (its own session, same DB) sees them.
    live = ingest_google_place(
        db_session, google_place_id="ChIJ_bulk_live", fetcher=_fetcher_for(payload)
    )
    gone = ingest_google_place(
        db_session, google_place_id="ChIJ_bulk_gone", fetcher=_fetcher_for(payload)
    )
    gone.place.is_deleted = True
    db_session.add(gone.place)
    db_session.commit()

    resp = api.as_user(admin).post(
        "/admin/places/bulk/preview",
        json={
            "google_place_ids": [
                "ChIJ_bulk_live",
                "ChIJ_bulk_gone",
                "ChIJ_bulk_brand_new",
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    by_id = {it["google_place_id"]: it for it in resp.json()["items"]}

    assert by_id["ChIJ_bulk_live"]["status"] == "EXISTS"
    assert by_id["ChIJ_bulk_live"]["existing_place_id"] == str(live.place.id)
    assert by_id["ChIJ_bulk_live"]["existing_name"] == "Halal Test Diner"

    assert by_id["ChIJ_bulk_gone"]["status"] == "SOFT_DELETED"
    assert by_id["ChIJ_bulk_gone"]["existing_place_id"] == str(gone.place.id)

    assert by_id["ChIJ_bulk_brand_new"]["status"] == "NEW"
    assert by_id["ChIJ_bulk_brand_new"]["existing_place_id"] is None


def test_bulk_preview_collapses_within_batch_duplicates(api, factories):
    """The same ID staged twice should yield exactly one preview row."""
    admin = factories.admin()
    resp = api.as_user(admin).post(
        "/admin/places/bulk/preview",
        json={"google_place_ids": ["ChIJ_dupe", "ChIJ_dupe", "ChIJ_other"]},
    )
    assert resp.status_code == 200, resp.text
    ids = [it["google_place_id"] for it in resp.json()["items"]]
    assert ids == ["ChIJ_dupe", "ChIJ_other"]


# ---------------------------------------------------------------------------
# Import — creates, then is idempotent on re-import
# ---------------------------------------------------------------------------
def test_bulk_import_creates_then_dedups(api, factories, monkeypatch):
    admin = factories.admin()
    _patch_fetcher(monkeypatch, _fetcher_for(_fixture("us_nyc_locality.json")))

    first = api.as_user(admin).post(
        "/admin/places/bulk/import",
        json={"google_place_ids": ["ChIJ_imp_1", "ChIJ_imp_2"]},
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["summary"] == {
        "created": 2,
        "existed": 0,
        "soft_deleted": 0,
        "failed": 0,
    }
    outcomes = {it["google_place_id"]: it["outcome"] for it in body["items"]}
    assert outcomes == {"ChIJ_imp_1": "CREATED", "ChIJ_imp_2": "CREATED"}
    # Non-failed rows carry the created place id + name.
    assert all(it["place_id"] and it["place_name"] for it in body["items"])

    # Re-import one existing + one new: existing is EXISTED, new is CREATED.
    second = api.as_user(admin).post(
        "/admin/places/bulk/import",
        json={"google_place_ids": ["ChIJ_imp_1", "ChIJ_imp_3"]},
    )
    assert second.status_code == 200, second.text
    body2 = second.json()
    assert body2["summary"] == {
        "created": 1,
        "existed": 1,
        "soft_deleted": 0,
        "failed": 0,
    }
    outcomes2 = {it["google_place_id"]: it["outcome"] for it in body2["items"]}
    assert outcomes2 == {"ChIJ_imp_1": "EXISTED", "ChIJ_imp_3": "CREATED"}


def test_bulk_import_collapses_within_batch_duplicates(api, factories, monkeypatch):
    """The same ID twice in one import creates exactly one place."""
    admin = factories.admin()
    _patch_fetcher(monkeypatch, _fetcher_for(_fixture("us_nyc_locality.json")))

    resp = api.as_user(admin).post(
        "/admin/places/bulk/import",
        json={"google_place_ids": ["ChIJ_once", "ChIJ_once"]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["summary"]["created"] == 1


# ---------------------------------------------------------------------------
# Import — one bad row must not sink the batch (fault isolation)
# ---------------------------------------------------------------------------
def test_bulk_import_isolates_per_item_failures(
    api, factories, db_session, monkeypatch
):
    admin = factories.admin()
    fetcher = _dispatch_fetcher(
        _fixture("us_nyc_locality.json"),
        incomplete_ids=frozenset({"ChIJ_incomplete"}),
        notfound_ids=frozenset({"ChIJ_missing"}),
    )
    _patch_fetcher(monkeypatch, fetcher)

    resp = api.as_user(admin).post(
        "/admin/places/bulk/import",
        json={
            "google_place_ids": [
                "ChIJ_good_a",
                "ChIJ_incomplete",
                "ChIJ_missing",
                "ChIJ_good_b",
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"] == {
        "created": 2,
        "existed": 0,
        "soft_deleted": 0,
        "failed": 2,
    }

    by_id = {it["google_place_id"]: it for it in body["items"]}
    assert by_id["ChIJ_good_a"]["outcome"] == "CREATED"
    assert by_id["ChIJ_good_b"]["outcome"] == "CREATED"
    assert by_id["ChIJ_incomplete"]["outcome"] == "FAILED"
    assert by_id["ChIJ_incomplete"]["error_code"] == "GOOGLE_PAYLOAD_INCOMPLETE"
    assert by_id["ChIJ_missing"]["outcome"] == "FAILED"
    assert by_id["ChIJ_missing"]["error_code"] == "GOOGLE_PLACE_NOT_FOUND"

    # The good rows genuinely persisted despite the failures around them.
    for gid in ("ChIJ_good_a", "ChIJ_good_b"):
        ext = db_session.execute(
            select(PlaceExternalId).where(PlaceExternalId.external_id == gid)
        ).scalar_one_or_none()
        assert ext is not None
    # The failed rows wrote nothing.
    for gid in ("ChIJ_incomplete", "ChIJ_missing"):
        ext = db_session.execute(
            select(PlaceExternalId).where(PlaceExternalId.external_id == gid)
        ).scalar_one_or_none()
        assert ext is None


# ---------------------------------------------------------------------------
# Import — a soft-deleted match is reported, never auto-restored
# ---------------------------------------------------------------------------
def test_bulk_import_reports_soft_deleted_without_restoring(
    api, factories, db_session, monkeypatch
):
    admin = factories.admin()
    _patch_fetcher(monkeypatch, _fetcher_for(_fixture("us_nyc_locality.json")))

    seeded = ingest_google_place(
        db_session, google_place_id="ChIJ_softdel", fetcher=_fetcher_for(
            _fixture("us_nyc_locality.json")
        )
    )
    seeded.place.is_deleted = True
    db_session.add(seeded.place)
    db_session.commit()

    resp = api.as_user(admin).post(
        "/admin/places/bulk/import",
        json={"google_place_ids": ["ChIJ_softdel"]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"]["soft_deleted"] == 1
    assert body["items"][0]["outcome"] == "SOFT_DELETED"

    # Still deleted — import must not silently resurrect it.
    place = db_session.execute(
        select(Place).where(Place.id == seeded.place.id)
    ).scalar_one()
    db_session.refresh(place)
    assert place.is_deleted is True


# ---------------------------------------------------------------------------
# AuthZ — both endpoints are admin-only
# ---------------------------------------------------------------------------
def test_bulk_endpoints_require_admin(api, factories):
    consumer = factories.consumer()
    for path in ("/admin/places/bulk/preview", "/admin/places/bulk/import"):
        resp = api.as_user(consumer).post(
            path, json={"google_place_ids": ["ChIJ_nope"]}
        )
        assert resp.status_code in (401, 403), f"{path}: {resp.text}"


# ---------------------------------------------------------------------------
# Validation — batch size + shape guards reject before any Google call
# ---------------------------------------------------------------------------
def test_bulk_import_rejects_bad_batches(api, factories, monkeypatch):
    admin = factories.admin()

    def _must_not_run(_place_id: str):
        raise AssertionError("fetcher must not run on invalid input")

    _patch_fetcher(monkeypatch, _must_not_run)

    # Empty list → 422 (min_length=1).
    empty = api.as_user(admin).post(
        "/admin/places/bulk/import", json={"google_place_ids": []}
    )
    assert empty.status_code == 422, empty.text

    # Over the cap (26 > 25) → 422.
    oversized = api.as_user(admin).post(
        "/admin/places/bulk/import",
        json={"google_place_ids": [f"ChIJ_{i}" for i in range(26)]},
    )
    assert oversized.status_code == 422, oversized.text

    # Unknown field → 422 (extra="forbid").
    extra = api.as_user(admin).post(
        "/admin/places/bulk/import",
        json={"google_place_ids": ["ChIJ_ok"], "nope": True},
    )
    assert extra.status_code == 422, extra.text
