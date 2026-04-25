"""Integration tests for the Google-driven Place ingest flow.

These tests cover the *orchestration* layer (``app.modules.places.ingest``)
and the thin admin endpoint that wraps it. The extractor itself is covered
by ``tests/test_google_place_extractor.py``.

A fake fetcher is injected wherever the service signature accepts one, so no
network calls happen. When exercising the HTTP endpoint, we instead
monkeypatch the symbol the router imports (``fetch_place_details_google`` is
resolved through ``ingest_google_place`` at call time).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.modules.places.enums import ExternalIdProvider, PlaceEventType
from app.modules.places.ingest import ingest_google_place
from app.modules.places.models import Place, PlaceEvent, PlaceExternalId


_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "google_places"


def _fixture(name: str) -> dict:
    return json.loads((_FIXTURE_DIR / name).read_text())


def _fetcher_for(fixture_name: str):
    payload = _fixture(fixture_name)

    def _fetch(_place_id: str):
        return payload

    return _fetch


# ---------------------------------------------------------------------------
# Service-level: creates Place + external id + CREATED event
# ---------------------------------------------------------------------------
def test_ingest_creates_place_with_canonical_fields(db_session, factories):
    admin = factories.admin()
    result = ingest_google_place(
        db_session,
        google_place_id="ChIJseed_Brooklyn",
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )

    assert result.existed is False
    assert result.was_deleted is False

    p = result.place
    assert p.name == "Halal Test Diner"
    assert p.city == "Brooklyn"
    assert p.country_code == "US"
    assert p.region == "New York"
    assert p.postal_code == "11201"
    assert p.canonical_source == ExternalIdProvider.GOOGLE

    # PlaceExternalId row exists with raw_data + last_synced_at
    ext = db_session.execute(
        select(PlaceExternalId).where(PlaceExternalId.place_id == p.id)
    ).scalar_one()
    assert ext.provider == ExternalIdProvider.GOOGLE
    assert ext.external_id == "ChIJseed_Brooklyn"
    assert ext.raw_data is not None
    assert ext.last_synced_at is not None

    # A CREATED audit event was logged, attributed to the admin.
    events = db_session.execute(
        select(PlaceEvent).where(PlaceEvent.place_id == p.id)
    ).scalars().all()
    assert any(
        e.event_type == PlaceEventType.CREATED.value
        and e.actor_user_id == admin.id
        for e in events
    )


# ---------------------------------------------------------------------------
# Idempotency: second call with the same google_place_id returns existing
# ---------------------------------------------------------------------------
def test_ingest_is_idempotent_on_google_place_id(db_session):
    first = ingest_google_place(
        db_session,
        google_place_id="ChIJseed_Idempotent",
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )
    assert first.existed is False

    second = ingest_google_place(
        db_session,
        google_place_id="ChIJseed_Idempotent",
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )
    assert second.existed is True
    assert second.was_deleted is False
    assert second.place.id == first.place.id

    # Still exactly one external id row
    count = db_session.execute(
        select(PlaceExternalId).where(
            PlaceExternalId.external_id == "ChIJseed_Idempotent"
        )
    ).scalars().all()
    assert len(count) == 1


# ---------------------------------------------------------------------------
# Idempotency — soft-deleted Place flagged so UI can offer Restore
# ---------------------------------------------------------------------------
def test_ingest_flags_soft_deleted_place(db_session):
    first = ingest_google_place(
        db_session,
        google_place_id="ChIJseed_Deleted",
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )
    first.place.is_deleted = True
    db_session.add(first.place)
    db_session.commit()

    again = ingest_google_place(
        db_session,
        google_place_id="ChIJseed_Deleted",
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )
    assert again.existed is True
    assert again.was_deleted is True
    assert again.place.id == first.place.id


# ---------------------------------------------------------------------------
# Incomplete payloads fail fast, no half-written row
# ---------------------------------------------------------------------------
def test_ingest_rejects_payload_missing_required_fields(db_session):
    def bad_fetcher(_place_id: str):
        # Valid JSON but no name/lat/lng — Place would be uninsertable.
        return {"status": "OK", "result": {"place_id": "x"}}

    with pytest.raises(Exception) as exc:
        ingest_google_place(
            db_session,
            google_place_id="ChIJseed_Incomplete",
            fetcher=bad_fetcher,
        )
    assert "GOOGLE_PAYLOAD_INCOMPLETE" in str(exc.value) or getattr(
        exc.value, "code", None
    ) == "GOOGLE_PAYLOAD_INCOMPLETE"

    # No Place was created
    assert db_session.execute(
        select(Place).where(Place.name == "Halal Test Diner")
    ).scalar_one_or_none() is None


# ---------------------------------------------------------------------------
# HTTP endpoint — admin auth + happy path
# ---------------------------------------------------------------------------
def test_admin_ingest_endpoint_creates_place(api, factories, db_session, monkeypatch):
    admin = factories.admin()

    # The router calls ``ingest_google_place`` (without a fetcher), which falls
    # through to ``fetch_place_details_google``. Patch the symbol at the module
    # that looks it up so no HTTP happens.
    from app.modules.places import ingest as ingest_mod

    def fake_fetch(place_id: str):
        return _fixture("us_nyc_locality.json")

    monkeypatch.setattr(ingest_mod, "fetch_place_details_google", fake_fetch)

    resp = api.as_user(admin).post(
        "/admin/places/ingest",
        json={"google_place_id": "ChIJseed_HttpIngest"},
    )
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["existed"] is False
    assert body["was_deleted"] is False
    assert body["place"]["city"] == "Brooklyn"
    assert body["place"]["country_code"] == "US"
    assert body["place"]["canonical_source"] == "GOOGLE"


def test_admin_ingest_endpoint_requires_admin_role(api, factories, monkeypatch):
    # Even a consumer shouldn't be able to trigger Google ingest.
    consumer = factories.consumer()
    resp = api.as_user(consumer).post(
        "/admin/places/ingest",
        json={"google_place_id": "ChIJseed_Unauthorized"},
    )
    assert resp.status_code in (401, 403), resp.text


def _patch_fetcher(monkeypatch, fetcher):
    """Install ``fetcher`` as the Google Place Details fetcher for this test.

    The router resolves ``fetch_place_details_google`` through the ingest
    module at call time, so patching the name at the module level swaps
    out the real HTTP call without touching the service signature.
    """
    from app.modules.places import ingest as ingest_mod

    monkeypatch.setattr(ingest_mod, "fetch_place_details_google", fetcher)


# ---------------------------------------------------------------------------
# HTTP endpoint — idempotency flag round-trips cleanly
# ---------------------------------------------------------------------------
def test_admin_ingest_endpoint_is_idempotent(api, factories, monkeypatch):
    """Second call with the same google_place_id must return existed=true.

    The admin UI uses ``existed`` to differentiate "Place added" from "Already
    in catalog" toasts — if this flag ever stops round-tripping through the
    response schema, the UX regresses silently.
    """
    admin = factories.admin()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    first = api.as_user(admin).post(
        "/admin/places/ingest",
        json={"google_place_id": "ChIJseed_HttpIdempotent"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["existed"] is False

    second = api.as_user(admin).post(
        "/admin/places/ingest",
        json={"google_place_id": "ChIJseed_HttpIdempotent"},
    )
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["existed"] is True
    assert body["was_deleted"] is False
    # Same Place row — critical for the "open the existing one" navigation.
    assert body["place"]["id"] == first.json()["place"]["id"]


# ---------------------------------------------------------------------------
# HTTP endpoint — soft-deleted flag drives the Restore prompt
# ---------------------------------------------------------------------------
def test_admin_ingest_endpoint_flags_soft_deleted(
    api, factories, db_session, monkeypatch
):
    """Ingesting a soft-deleted match returns was_deleted=true.

    The New Place dialog keys off this flag to render an inline "Restore
    place" prompt instead of silently navigating to a hidden row. The
    endpoint must not auto-restore — that's an explicit user action.
    """
    admin = factories.admin()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    first = api.as_user(admin).post(
        "/admin/places/ingest",
        json={"google_place_id": "ChIJseed_HttpDeleted"},
    )
    assert first.status_code == 200, first.text
    place_id = first.json()["place"]["id"]

    # Soft-delete directly via the DB so we don't depend on the admin
    # delete endpoint's behavior here — this test is about ingest's
    # awareness of the is_deleted state, not about how deletion happened.
    place = db_session.execute(
        select(Place).where(Place.id == place_id)
    ).scalar_one()
    place.is_deleted = True
    db_session.add(place)
    db_session.commit()

    again = api.as_user(admin).post(
        "/admin/places/ingest",
        json={"google_place_id": "ChIJseed_HttpDeleted"},
    )
    assert again.status_code == 200, again.text
    body = again.json()
    assert body["existed"] is True
    assert body["was_deleted"] is True
    assert body["place"]["id"] == place_id
    # Ingest must NOT auto-restore — the UI owns that decision.
    assert body["place"]["is_deleted"] is True


# ---------------------------------------------------------------------------
# HTTP endpoint — NOT_FOUND from Google surfaces as a 404 to the client
# ---------------------------------------------------------------------------
def test_admin_ingest_endpoint_propagates_google_not_found(
    api, factories, monkeypatch
):
    """A stale or wrong place_id from the browser widget should 404 cleanly.

    ``fetch_place_details_google`` raises ``NotFoundError`` when Google
    returns status=NOT_FOUND / ZERO_RESULTS; FastAPI's AppError handler
    then renders it as HTTP 404 with ``code=GOOGLE_PLACE_NOT_FOUND``.
    The admin panel surfaces this in a toast so users aren't left wondering.
    """
    from app.core.exceptions import NotFoundError

    admin = factories.admin()

    def fake_fetch_not_found(_place_id: str):
        raise NotFoundError(
            "GOOGLE_PLACE_NOT_FOUND",
            "Google Places returned NOT_FOUND for place_id 'bogus'",
        )

    _patch_fetcher(monkeypatch, fake_fetch_not_found)

    resp = api.as_user(admin).post(
        "/admin/places/ingest",
        json={"google_place_id": "ChIJseed_Bogus"},
    )
    assert resp.status_code == 404, resp.text
    body = resp.json()
    assert body["error"]["code"] == "GOOGLE_PLACE_NOT_FOUND"


# ---------------------------------------------------------------------------
# HTTP endpoint — anonymous caller (no X-User-Id) can't trigger ingest
# ---------------------------------------------------------------------------
def test_admin_ingest_endpoint_requires_authentication(api):
    """No X-User-Id header → the role guard rejects before any DB work."""
    resp = api.as_anonymous().post(
        "/admin/places/ingest",
        json={"google_place_id": "ChIJseed_Anon"},
    )
    # 401 (no credentials) is semantically correct; the existing require_roles
    # dep in some codepaths returns 403. Either is acceptable rejection.
    assert resp.status_code in (401, 403), resp.text


# ---------------------------------------------------------------------------
# HTTP endpoint — malformed body is rejected before any Google call
# ---------------------------------------------------------------------------
def test_admin_ingest_endpoint_rejects_malformed_body(api, factories, monkeypatch):
    """Missing ``google_place_id`` is a 422 from Pydantic, not a 500.

    Also confirms PlaceIngestRequest has ``extra='forbid'`` (posting an
    unknown field should also 422), which matters because we don't want the
    admin panel accidentally sending fields the server silently drops.
    """
    admin = factories.admin()

    # The fetcher should never fire if validation fails up-front — installing
    # a fetcher that errors lets us assert that.
    def fake_should_not_run(_place_id: str):
        raise AssertionError("fetcher must not be called on invalid input")

    _patch_fetcher(monkeypatch, fake_should_not_run)

    missing = api.as_user(admin).post("/admin/places/ingest", json={})
    assert missing.status_code == 422, missing.text

    unknown = api.as_user(admin).post(
        "/admin/places/ingest",
        json={"google_place_id": "ChIJseed_Extra", "nope": "rejected"},
    )
    assert unknown.status_code == 422, unknown.text
