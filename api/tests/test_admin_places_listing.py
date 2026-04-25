"""Admin places browse — filter + sort.

Covers ``GET /admin/places`` across its filter combinations (q / city /
country / deleted) and its sort modes (created_at / name / city /
country), plus the supporting ``GET /admin/places/countries`` endpoint
that feeds the UI's country dropdown.

We don't re-test the q/name search path here — it's exercised by the
existing /places list page tests indirectly. The focus is on the
newly-added city + country + order_by surface area.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def mixed_catalog(factories, db_session):
    """A handful of places spanning multiple cities + countries.

    Returns a dict keyed by short nickname for readability in assertions:

        {
          "brooklyn_diner": Place,          # Brooklyn, NY, US
          "queens_deli":    Place,          # Queens,   NY, US
          "london_kebab":   Place,          # London,   GB
          "unnamed":        Place,          # no city / no country_code
        }
    """
    b = factories.place(name="Brooklyn Diner")
    b.city = "Brooklyn"
    b.region = "New York"
    b.country_code = "US"

    q = factories.place(name="Queens Deli")
    q.city = "Queens"
    q.region = "New York"
    q.country_code = "US"

    l = factories.place(name="London Kebab")
    l.city = "London"
    l.country_code = "GB"

    u = factories.place(name="Anonymous Joint")
    # city + country_code left NULL — tests NULLS LAST behavior on sorts

    db_session.add_all([b, q, l, u])
    db_session.flush()

    return {
        "brooklyn_diner": b,
        "queens_deli": q,
        "london_kebab": l,
        "unnamed": u,
    }


# ---------------------------------------------------------------------------
# City filter (ILIKE)
# ---------------------------------------------------------------------------
def test_list_places_filters_by_city_ilike(api, factories, mixed_catalog):
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?city=brook")
    assert resp.status_code == 200, resp.text
    names = {row["name"] for row in resp.json()}
    assert names == {"Brooklyn Diner"}


def test_list_places_city_filter_is_case_insensitive(
    api, factories, mixed_catalog
):
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?city=QUEENS")
    assert resp.status_code == 200, resp.text
    names = {row["name"] for row in resp.json()}
    assert names == {"Queens Deli"}


def test_list_places_city_filter_excludes_null_cities(
    api, factories, mixed_catalog
):
    """Places with NULL city shouldn't match any city substring — otherwise
    ILIKE on NULL would yield NULL, which is falsy in WHERE, which is
    already correct, but asserting guards against a future .coalesce()
    refactor silently lumping untagged rows into every city filter."""
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?city=a")
    names = {row["name"] for row in resp.json()}
    assert "Anonymous Joint" not in names


# ---------------------------------------------------------------------------
# Country filter (exact, case-insensitive normalization)
# ---------------------------------------------------------------------------
def test_list_places_filters_by_country_exact(api, factories, mixed_catalog):
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?country=US")
    names = {row["name"] for row in resp.json()}
    assert names == {"Brooklyn Diner", "Queens Deli"}


def test_list_places_country_filter_normalizes_case(
    api, factories, mixed_catalog
):
    """country_code is stored uppercase (ISO-2 CHECK). Lowercase input
    should still match — normalization happens server-side."""
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?country=gb")
    names = {row["name"] for row in resp.json()}
    assert names == {"London Kebab"}


def test_list_places_country_filter_rejects_non_iso2(
    api, factories, mixed_catalog
):
    """max_length=2 on the Query param bounces long values as 422."""
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?country=USA")
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# Combined city + country filter
# ---------------------------------------------------------------------------
def test_list_places_combines_city_and_country_filters(
    api, factories, mixed_catalog
):
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?country=US&city=brook")
    names = {row["name"] for row in resp.json()}
    assert names == {"Brooklyn Diner"}


# ---------------------------------------------------------------------------
# order_by
# ---------------------------------------------------------------------------
def test_list_places_order_by_name_is_alphabetical(
    api, factories, mixed_catalog
):
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?order_by=name")
    assert resp.status_code == 200, resp.text
    names = [row["name"] for row in resp.json()]
    # Anonymous Joint < Brooklyn Diner < London Kebab < Queens Deli
    assert names == [
        "Anonymous Joint",
        "Brooklyn Diner",
        "London Kebab",
        "Queens Deli",
    ]


def test_list_places_order_by_city_puts_nulls_last(
    api, factories, mixed_catalog
):
    """NULLS LAST matters: unpopulated cities shouldn't clog the top of
    a "sort by city" browse. Brooklyn < London < Queens, then the row
    with NULL city comes after."""
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?order_by=city")
    names = [row["name"] for row in resp.json()]
    assert names == [
        "Brooklyn Diner",
        "London Kebab",
        "Queens Deli",
        "Anonymous Joint",
    ]


def test_list_places_order_by_country_puts_nulls_last(
    api, factories, mixed_catalog
):
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?order_by=country")
    rows = resp.json()
    # GB (London) comes before US (Brooklyn, Queens); the NULL-country
    # place is pushed to the end. Within the US group, secondary order
    # is by name (from the ORDER BY tiebreaker in the repo).
    names = [r["name"] for r in rows]
    assert names[0] == "London Kebab"
    assert names[1] == "Brooklyn Diner"
    assert names[2] == "Queens Deli"
    assert names[3] == "Anonymous Joint"


def test_list_places_invalid_order_by_is_422(api, factories, mixed_catalog):
    """The route's pattern regex validates the enum — a typo bounces as
    422 rather than silently falling back. Keeps admin bugs visible."""
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?order_by=bogus")
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_list_places_rejects_legacy_created_at_sort(api, factories, mixed_catalog):
    """``created_at`` used to be the default sort key. It was retired
    when we decided the CREATED row on ``place_events`` is the source of
    truth for ingest time (the Place model never gained a created_at
    column). Callers stuck on the old key should see a clean 422 —
    better than a surprising fallback — so they notice and update."""
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places?order_by=created_at")
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_list_places_default_sort_is_updated_at_desc(
    api, factories, db_session
):
    """Default (no order_by) → most-recently-edited first. This is what
    an admin wants in a browse: rows that just got touched float up.

    Note: ``mixed_catalog`` fixture creates rows synchronously in the
    same outer transaction, so we have to drive ``updated_at`` deltas
    manually rather than relying on elapsed wall time."""
    from datetime import datetime, timedelta, timezone
    from app.modules.places.models import Place
    from sqlalchemy import select as sa_select

    admin = factories.admin()
    older = factories.place(name="Older Venue")
    newer = factories.place(name="Newer Venue")

    # Pin updated_at explicitly so the sort is deterministic regardless
    # of fixture ordering quirks.
    older.updated_at = datetime.now(timezone.utc) - timedelta(days=2)
    newer.updated_at = datetime.now(timezone.utc)
    db_session.add_all([older, newer])
    db_session.flush()

    resp = api.as_user(admin).get("/admin/places")
    assert resp.status_code == 200, resp.text
    names = [row["name"] for row in resp.json()]
    # Most-recently-touched first.
    assert names.index("Newer Venue") < names.index("Older Venue")


# ---------------------------------------------------------------------------
# /admin/places/countries
# ---------------------------------------------------------------------------
def test_list_place_countries_returns_distinct_sorted(
    api, factories, mixed_catalog
):
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/places/countries")
    assert resp.status_code == 200, resp.text
    # Only GB and US are populated in the fixture; NULL-country rows are
    # excluded. Sorted alphabetically for stable UI display.
    assert resp.json() == ["GB", "US"]


def test_list_place_countries_requires_admin_role(api, factories):
    consumer = factories.consumer()
    resp = api.as_user(consumer).get("/admin/places/countries")
    assert resp.status_code in (401, 403), resp.text


def test_list_place_countries_empty_when_catalog_is_blank(api, factories):
    """No rows with country_code set → empty list, not 500."""
    admin = factories.admin()
    # A single place with no country_code set. No rows contribute to the
    # distinct set, so the result should be [].
    factories.place()
    resp = api.as_user(admin).get("/admin/places/countries")
    assert resp.status_code == 200, resp.text
    assert resp.json() == []
