"""Integration + service tests for the "link existing Place to Google" flow.

POST /admin/places/{place_id}/link-external takes a Google place_id and
attaches it to an already-existing Place (typically one added manually
before the Google ingest flow existed). The key contracts these tests pin:

  * Canonical fields (city/region/country_code/postal_code/timezone/
    canonical_source) are ONLY backfilled where currently NULL — admin
    edits survive.
  * Same-pair linking is idempotent (no duplicate PlaceExternalId rows,
    no second EDITED event).
  * Cross-place conflicts surface distinct error codes so the admin UI
    can explain what's going on.
  * An EDITED PlaceEvent is always written on a real (non-idempotent)
    link, with the google_place_id embedded in the message so the event
    history tells the audit story on-page.

We reuse the same Google-Places fixtures that the ingest tests use, so
fixture drift affects both flows in lock-step.
"""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select

from app.modules.places.enums import ExternalIdProvider, PlaceEventType
from app.modules.places.ingest import (
    link_google_place_to_existing,
    resync_google_place,
)
from app.modules.places.models import Place, PlaceEvent, PlaceExternalId


_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "google_places"


def _fixture(name: str) -> dict:
    return json.loads((_FIXTURE_DIR / name).read_text())


def _fetcher_for(fixture_name: str):
    payload = _fixture(fixture_name)

    def _fetch(_place_id: str):
        return payload

    return _fetch


def _patch_fetcher(monkeypatch, fetcher):
    """Swap the module-level fetcher the HTTP route resolves at call time."""
    from app.modules.places import ingest as ingest_mod

    monkeypatch.setattr(ingest_mod, "fetch_place_details_google", fetcher)


# ---------------------------------------------------------------------------
# Service-level: fresh link backfills NULL canonical fields
# ---------------------------------------------------------------------------
def test_link_populates_null_canonical_fields_and_logs_event(
    db_session, factories
):
    admin = factories.admin()
    # factories.place() creates a manually-added row with no canonical
    # address breakdown — the exact scenario this endpoint exists for.
    place = factories.place()
    assert place.city is None
    assert place.country_code is None
    assert place.canonical_source is None

    result = link_google_place_to_existing(
        db_session,
        place_id=place.id,
        google_place_id="ChIJseed_LinkFresh",
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )

    assert result.existed is False
    # us_nyc_locality.json has locality=Brooklyn, admin_area_1=New York,
    # country=US, postal_code=11201 — all five canonical fields land.
    assert set(result.fields_updated) == {
        "city",
        "region",
        "country_code",
        "postal_code",
        "canonical_source",
    }

    db_session.refresh(result.place)
    assert result.place.city == "Brooklyn"
    assert result.place.country_code == "US"
    assert result.place.region == "New York"
    assert result.place.postal_code == "11201"
    assert result.place.canonical_source == ExternalIdProvider.GOOGLE

    # PlaceExternalId row exists with the right provider + raw_data snapshot
    ext = db_session.execute(
        select(PlaceExternalId).where(PlaceExternalId.place_id == place.id)
    ).scalar_one()
    assert ext.provider == ExternalIdProvider.GOOGLE
    assert ext.external_id == "ChIJseed_LinkFresh"
    assert ext.raw_data is not None
    assert ext.last_synced_at is not None

    # EDITED event names the google_place_id + backfilled columns so the
    # place history page can tell the story on its own.
    event = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.EDITED.value)
    ).scalar_one()
    assert "ChIJseed_LinkFresh" in event.message
    assert "city" in event.message


# ---------------------------------------------------------------------------
# Service-level: existing admin-set fields are NOT clobbered on link
# ---------------------------------------------------------------------------
def test_link_does_not_overwrite_already_set_canonical_fields(
    db_session, factories
):
    admin = factories.admin()
    place = factories.place()

    # Admin already edited these in — linking to Google must not clobber.
    place.city = "My Custom City"
    place.country_code = "ZZ"
    db_session.add(place)
    db_session.flush()

    result = link_google_place_to_existing(
        db_session,
        place_id=place.id,
        google_place_id="ChIJseed_LinkNoClobber",
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )

    db_session.refresh(result.place)
    # Preserved
    assert result.place.city == "My Custom City"
    assert result.place.country_code == "ZZ"
    # Filled in (were NULL before)
    assert result.place.region == "New York"
    assert result.place.postal_code == "11201"

    assert "city" not in result.fields_updated
    assert "country_code" not in result.fields_updated
    assert "region" in result.fields_updated
    assert "postal_code" in result.fields_updated


# ---------------------------------------------------------------------------
# Service-level: same-place / same-google_id is idempotent
# ---------------------------------------------------------------------------
def test_link_same_pair_is_idempotent_no_duplicate_event(
    db_session, factories
):
    admin = factories.admin()
    place = factories.place()

    first = link_google_place_to_existing(
        db_session,
        place_id=place.id,
        google_place_id="ChIJseed_LinkIdem",
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )
    assert first.existed is False

    second = link_google_place_to_existing(
        db_session,
        place_id=place.id,
        google_place_id="ChIJseed_LinkIdem",
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )
    assert second.existed is True
    assert second.fields_updated == []

    # Still exactly one PlaceExternalId row and one EDITED event — the
    # idempotent no-op must not stack audit noise.
    ext_rows = db_session.execute(
        select(PlaceExternalId).where(PlaceExternalId.place_id == place.id)
    ).scalars().all()
    assert len(ext_rows) == 1

    events = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.EDITED.value)
    ).scalars().all()
    assert len(events) == 1


# ---------------------------------------------------------------------------
# Service-level: google_place_id already linked to a DIFFERENT place → 409
# ---------------------------------------------------------------------------
def test_link_rejects_google_id_bound_to_a_different_place(
    db_session, factories
):
    import pytest

    admin = factories.admin()
    place_a = factories.place(name="Place A")
    place_b = factories.place(name="Place B")

    link_google_place_to_existing(
        db_session,
        place_id=place_a.id,
        google_place_id="ChIJseed_SharedGid",
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )

    with pytest.raises(Exception) as exc:
        link_google_place_to_existing(
            db_session,
            place_id=place_b.id,
            google_place_id="ChIJseed_SharedGid",
            actor_user_id=admin.id,
            fetcher=_fetcher_for("us_nyc_locality.json"),
        )
    # Error carries the specific domain code so the admin UI can explain
    # what happened ("this Google place is already linked elsewhere").
    assert getattr(exc.value, "code", "") == "GOOGLE_PLACE_ALREADY_LINKED"


# ---------------------------------------------------------------------------
# Service-level: place already has a DIFFERENT Google link → 409
# ---------------------------------------------------------------------------
def test_link_rejects_when_place_already_has_a_google_link(
    db_session, factories
):
    import pytest

    admin = factories.admin()
    place = factories.place()

    link_google_place_to_existing(
        db_session,
        place_id=place.id,
        google_place_id="ChIJseed_FirstLink",
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )

    with pytest.raises(Exception) as exc:
        link_google_place_to_existing(
            db_session,
            place_id=place.id,
            google_place_id="ChIJseed_SecondLink",
            actor_user_id=admin.id,
            fetcher=_fetcher_for("us_nyc_locality.json"),
        )
    assert getattr(exc.value, "code", "") == "PLACE_ALREADY_HAS_GOOGLE_LINK"


# ---------------------------------------------------------------------------
# HTTP: happy path round-trips through the admin route
# ---------------------------------------------------------------------------
def test_admin_link_endpoint_links_and_reports_fields(
    api, factories, monkeypatch
):
    admin = factories.admin()
    place = factories.place()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    resp = api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_HttpLink"},
    )
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["existed"] is False
    assert "city" in body["fields_updated"]
    assert body["place"]["city"] == "Brooklyn"
    assert body["place"]["canonical_source"] == "GOOGLE"


# ---------------------------------------------------------------------------
# HTTP: unknown place → 404 PLACE_NOT_FOUND
# ---------------------------------------------------------------------------
def test_admin_link_endpoint_404_for_unknown_place(api, factories, monkeypatch):
    admin = factories.admin()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    resp = api.as_user(admin).post(
        "/admin/places/00000000-0000-4000-8000-000000000000/link-external",
        json={"google_place_id": "ChIJseed_UnknownPlace"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


# ---------------------------------------------------------------------------
# HTTP: Google NOT_FOUND surfaces as 404 GOOGLE_PLACE_NOT_FOUND
# ---------------------------------------------------------------------------
def test_admin_link_endpoint_404_when_google_returns_not_found(
    api, factories, monkeypatch
):
    from app.core.exceptions import NotFoundError

    admin = factories.admin()
    place = factories.place()

    def fake_not_found(_place_id: str):
        raise NotFoundError(
            "GOOGLE_PLACE_NOT_FOUND",
            "Google Places returned NOT_FOUND for place_id 'bogus'",
        )

    _patch_fetcher(monkeypatch, fake_not_found)

    resp = api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_Bogus"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "GOOGLE_PLACE_NOT_FOUND"


# ---------------------------------------------------------------------------
# HTTP: 409 conflict — place already linked to a different Google place
# ---------------------------------------------------------------------------
def test_admin_link_endpoint_409_when_place_already_linked(
    api, factories, monkeypatch
):
    admin = factories.admin()
    place = factories.place()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    # First link: OK
    first = api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_HttpFirst"},
    )
    assert first.status_code == 200, first.text

    # Second link with a DIFFERENT google_place_id: 409
    second = api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_HttpSecond"},
    )
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "PLACE_ALREADY_HAS_GOOGLE_LINK"


# ---------------------------------------------------------------------------
# HTTP: auth gates
# ---------------------------------------------------------------------------
def test_admin_link_endpoint_requires_admin_role(api, factories):
    consumer = factories.consumer()
    place = factories.place()

    resp = api.as_user(consumer).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_Unauthorized"},
    )
    assert resp.status_code in (401, 403), resp.text


# ---------------------------------------------------------------------------
# HTTP: malformed body → 422
# ---------------------------------------------------------------------------
def test_admin_link_endpoint_rejects_malformed_body(api, factories, monkeypatch):
    admin = factories.admin()
    place = factories.place()

    def should_not_run(_pid: str):
        raise AssertionError("fetcher must not be called on invalid input")

    _patch_fetcher(monkeypatch, should_not_run)

    missing = api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={},
    )
    assert missing.status_code == 422, missing.text

    unknown = api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_Extra", "extra": "rejected"},
    )
    assert unknown.status_code == 422, unknown.text


# ===========================================================================
# GET /admin/places/{id}/external-ids
# ===========================================================================
def test_list_external_ids_returns_google_link(api, factories, monkeypatch):
    admin = factories.admin()
    place = factories.place()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_ListLink"},
    )

    resp = api.as_user(admin).get(f"/admin/places/{place.id}/external-ids")
    assert resp.status_code == 200, resp.text

    rows = resp.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["provider"] == "GOOGLE"
    assert row["external_id"] == "ChIJseed_ListLink"
    # last_synced_at set by link → present in the listing shape.
    assert row["last_synced_at"] is not None
    # Listing shape deliberately omits raw_data (too big for a listing).
    assert "raw_data" not in row


def test_list_external_ids_empty_for_manually_added_place(api, factories):
    admin = factories.admin()
    place = factories.place()

    resp = api.as_user(admin).get(f"/admin/places/{place.id}/external-ids")
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


def test_list_external_ids_404_for_unknown_place(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).get(
        "/admin/places/00000000-0000-4000-8000-000000000000/external-ids"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


# ===========================================================================
# DELETE /admin/places/{id}/external-ids/{provider}
# ===========================================================================
def test_unlink_external_removes_row_and_clears_canonical_source(
    api, factories, db_session, monkeypatch
):
    admin = factories.admin()
    place = factories.place()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_UnlinkMe"},
    )

    # Precondition: link exists, canonical_source set.
    assert db_session.execute(
        select(PlaceExternalId).where(PlaceExternalId.place_id == place.id)
    ).scalar_one_or_none() is not None

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/external-ids/GOOGLE",
        json={"reason": "Wrong venue matched during bulk import"},
    )
    assert resp.status_code == 204, resp.text

    # PlaceExternalId row gone.
    assert db_session.execute(
        select(PlaceExternalId).where(PlaceExternalId.place_id == place.id)
    ).scalar_one_or_none() is None

    # canonical_source cleared so the "Link to Google" button will reappear
    # in the admin UI.
    db_session.refresh(place)
    assert place.canonical_source is None

    # Canonical backfilled fields (city, etc.) are NOT wiped — they remain
    # valid data points even without a provider link.
    assert place.city == "Brooklyn"

    # Both link and unlink log EDITED events, so we can't just pick "the
    # most recent" — the test harness's savepoint mode makes func.now()
    # return identical timestamps within a single outer transaction. Filter
    # by message content to single out the unlink row deterministically.
    edited_events = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.EDITED.value)
    ).scalars().all()
    unlink_events = [
        e for e in edited_events if "Unlinked GOOGLE" in (e.message or "")
    ]
    assert len(unlink_events) == 1, [e.message for e in edited_events]
    unlink_msg = unlink_events[0].message or ""
    assert "ChIJseed_UnlinkMe" in unlink_msg
    assert "Wrong venue matched during bulk import" in unlink_msg


def test_unlink_external_without_reason_still_works(
    api, factories, db_session, monkeypatch
):
    admin = factories.admin()
    place = factories.place()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_UnlinkNoReason"},
    )

    # No body at all — backward-compat with scripted callers.
    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/external-ids/GOOGLE"
    )
    assert resp.status_code == 204, resp.text

    # Same timestamp-collision concern as the other unlink test — filter by
    # message content instead of trusting created_at ordering.
    edited_events = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.EDITED.value)
    ).scalars().all()
    unlink_events = [
        e for e in edited_events if "Unlinked GOOGLE" in (e.message or "")
    ]
    assert len(unlink_events) == 1, [e.message for e in edited_events]
    unlink_msg = unlink_events[0].message or ""
    # Unlink message still written, but with no "Reason:" suffix.
    assert "Reason:" not in unlink_msg


def test_unlink_external_404_when_no_link_exists(api, factories):
    admin = factories.admin()
    place = factories.place()

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/external-ids/GOOGLE"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "EXTERNAL_ID_NOT_FOUND"


def test_unlink_external_404_for_unknown_place(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).delete(
        "/admin/places/00000000-0000-4000-8000-000000000000/external-ids/GOOGLE"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


def test_unlink_external_rejects_too_short_reason(api, factories, monkeypatch):
    admin = factories.admin()
    place = factories.place()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_ShortReason"},
    )

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/external-ids/GOOGLE",
        json={"reason": "x"},  # below min_length=3
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ===========================================================================
# POST /admin/places/{id}/resync
# ===========================================================================
def test_resync_refreshes_snapshot_and_backfills_nulls(
    db_session, factories
):
    """Resync updates raw_data + last_synced_at and backfills null fields."""
    admin = factories.admin()
    place = factories.place()

    # Establish the link with a payload that only sets city.
    partial_payload = {
        "status": "OK",
        "result": {
            "place_id": "ChIJseed_ResyncBase",
            "name": "Test Venue",
            "geometry": {"location": {"lat": 40.7, "lng": -74.0}},
            "address_components": [
                {
                    "long_name": "Jersey City",
                    "short_name": "Jersey City",
                    "types": ["locality"],
                },
            ],
            "formatted_address": "Jersey City, NJ",
        },
    }
    link_google_place_to_existing(
        db_session,
        place_id=place.id,
        google_place_id="ChIJseed_ResyncBase",
        actor_user_id=admin.id,
        fetcher=lambda _pid: partial_payload,
    )

    db_session.refresh(place)
    assert place.city == "Jersey City"
    assert place.country_code is None  # still null — no country in partial payload

    # Now resync with a richer fixture that HAS country_code + region.
    result = resync_google_place(
        db_session,
        place_id=place.id,
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )

    db_session.refresh(result.place)
    # city stays as admin's existing value (it was already filled).
    assert result.place.city == "Jersey City"
    assert "city" not in result.fields_updated
    # country_code + region freshly backfilled.
    assert result.place.country_code == "US"
    assert result.place.region == "New York"
    assert "country_code" in result.fields_updated
    assert "region" in result.fields_updated

    # last_synced_at bumped on the link row.
    ext = db_session.execute(
        select(PlaceExternalId).where(PlaceExternalId.place_id == place.id)
    ).scalar_one()
    # raw_data now reflects the newer payload (contains address_components
    # for both locality and country/admin_area_1).
    assert len(ext.raw_data["result"]["address_components"]) > 1


def test_resync_with_fully_populated_place_is_benign_refresh(
    db_session, factories
):
    """When every canonical field is already set, resync refreshes the
    snapshot but reports zero fields_updated — still not an error."""
    admin = factories.admin()
    place = factories.place()

    link_google_place_to_existing(
        db_session,
        place_id=place.id,
        google_place_id="ChIJseed_FullyPopulated",
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )

    result = resync_google_place(
        db_session,
        place_id=place.id,
        actor_user_id=admin.id,
        fetcher=_fetcher_for("us_nyc_locality.json"),
    )

    # Everything was already set on the first link — resync has nothing
    # new to contribute.
    assert result.fields_updated == []


def test_resync_409_when_place_has_no_google_link(db_session, factories):
    import pytest

    admin = factories.admin()
    place = factories.place()

    with pytest.raises(Exception) as exc:
        resync_google_place(
            db_session,
            place_id=place.id,
            actor_user_id=admin.id,
            fetcher=_fetcher_for("us_nyc_locality.json"),
        )
    assert getattr(exc.value, "code", "") == "NO_GOOGLE_LINK"


# --- HTTP layer ---
def test_admin_resync_endpoint_200(api, factories, monkeypatch):
    admin = factories.admin()
    place = factories.place()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))

    api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_HttpResync"},
    )

    resp = api.as_user(admin).post(f"/admin/places/{place.id}/resync")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    # After a link that fully populated everything, resync has nothing new.
    assert body["fields_updated"] == []
    # Place shape round-trips.
    assert body["place"]["city"] == "Brooklyn"


def test_admin_resync_endpoint_409_when_no_link(api, factories):
    admin = factories.admin()
    place = factories.place()

    resp = api.as_user(admin).post(f"/admin/places/{place.id}/resync")
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "NO_GOOGLE_LINK"


def test_admin_resync_endpoint_404_for_unknown_place(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).post(
        "/admin/places/00000000-0000-4000-8000-000000000000/resync"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


def test_admin_resync_endpoint_404_on_google_not_found(
    api, factories, monkeypatch
):
    from app.core.exceptions import NotFoundError

    admin = factories.admin()
    place = factories.place()

    # First link with a working fetcher so we have something to resync.
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))
    api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_GoesMissing"},
    )

    # Swap the fetcher to simulate Google dropping the place_id.
    def fake_not_found(_pid):
        raise NotFoundError(
            "GOOGLE_PLACE_NOT_FOUND",
            "Google Places returned NOT_FOUND for place_id 'ChIJseed_GoesMissing'",
        )

    _patch_fetcher(monkeypatch, fake_not_found)

    resp = api.as_user(admin).post(f"/admin/places/{place.id}/resync")
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "GOOGLE_PLACE_NOT_FOUND"


def test_admin_resync_endpoint_requires_admin_role(api, factories, monkeypatch):
    # Establish the link as admin, then try resync as consumer.
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    _patch_fetcher(monkeypatch, lambda _pid: _fixture("us_nyc_locality.json"))
    api.as_user(admin).post(
        f"/admin/places/{place.id}/link-external",
        json={"google_place_id": "ChIJseed_AuthResync"},
    )

    resp = api.as_user(consumer).post(f"/admin/places/{place.id}/resync")
    assert resp.status_code in (401, 403), resp.text
