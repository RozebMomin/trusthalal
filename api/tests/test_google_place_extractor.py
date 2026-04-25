"""Unit tests for the Google Place Details address extractor.

The extractor is pure (no DB, no network) so these tests don't need the
database fixtures in conftest.py — they just load JSON fixtures from disk and
call ``extract_from_google_place``.

Each fixture exercises a real-world shape:
  * us_brooklyn.json      — sublocality_level_1 fallback (no locality comp)
  * us_nyc_locality.json  — locality is present; standard US layout
  * uk_london.json        — postal_town override for GB/IE
  * new_api_shape.json    — new Places (New) API payload shape
  * minimal.json          — sparse payload; verifies graceful None-return
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.modules.places.integrations.google import (
    CanonicalPlaceFields,
    extract_from_google_place,
)


_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "google_places"


def _load(name: str) -> dict:
    with (_FIXTURE_DIR / name).open("r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# US — locality is the city
# ---------------------------------------------------------------------------
def test_us_locality_extracts_city_from_locality_component():
    payload = _load("us_nyc_locality.json")
    out = extract_from_google_place(payload)

    assert out.name == "Halal Test Diner"
    assert out.city == "Brooklyn"
    assert out.region == "New York"
    assert out.country_code == "US"
    assert out.postal_code == "11201"
    assert out.lat == pytest.approx(40.6892)
    assert out.lng == pytest.approx(-73.9903)
    assert out.address == "123 Main St, Brooklyn, NY 11201, USA"
    # Legacy Place Details doesn't include timezone.
    assert out.timezone is None


# ---------------------------------------------------------------------------
# US — locality missing; falls back through the preference chain
# ---------------------------------------------------------------------------
def test_us_without_locality_falls_back_to_sublocality():
    """Woodside is a neighborhood; the city-like value is 'Queens' under
    sublocality_level_1. The extractor should find it via fallback order."""
    payload = _load("us_brooklyn.json")
    out = extract_from_google_place(payload)

    assert out.city == "Queens"
    assert out.country_code == "US"
    assert out.region == "New York"
    assert out.postal_code == "11377"


# ---------------------------------------------------------------------------
# UK — postal_town is the city, not locality
# ---------------------------------------------------------------------------
def test_gb_uses_postal_town_for_city():
    payload = _load("uk_london.json")
    out = extract_from_google_place(payload)

    assert out.country_code == "GB"
    assert out.city == "London"
    # region should be the top-level admin area (England)
    assert out.region == "England"
    assert out.postal_code == "WC2H 9FB"


# ---------------------------------------------------------------------------
# New API shape
# ---------------------------------------------------------------------------
def test_new_api_payload_shape_is_normalized():
    payload = _load("new_api_shape.json")
    out = extract_from_google_place(payload)

    assert out.name == "New API Test Kitchen"
    assert out.city == "San Francisco"
    assert out.region == "California"
    assert out.country_code == "US"
    assert out.postal_code == "94105"
    assert out.lat == pytest.approx(37.7898)
    assert out.lng == pytest.approx(-122.4002)
    assert out.address == "555 Market St, San Francisco, CA 94105, USA"
    # New API exposes IANA timezone
    assert out.timezone == "America/Los_Angeles"


# ---------------------------------------------------------------------------
# Minimal payload — no exceptions, just Nones
# ---------------------------------------------------------------------------
def test_minimal_payload_returns_nones_gracefully():
    payload = _load("minimal.json")
    out = extract_from_google_place(payload)

    assert out.name == "Barely Any Data"
    assert out.city is None
    assert out.region is None
    assert out.country_code is None
    assert out.postal_code is None
    assert out.timezone is None
    assert out.lat == pytest.approx(0.0)
    assert out.lng == pytest.approx(0.0)
    assert out.address is None


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------
def test_empty_payload_is_safe():
    out = extract_from_google_place({})
    assert out == CanonicalPlaceFields(
        name=None,
        address=None,
        lat=None,
        lng=None,
        city=None,
        region=None,
        country_code=None,
        postal_code=None,
        timezone=None,
    )


def test_payload_without_result_envelope_works():
    """If callers pass the inner result dict directly (without the
    ``{"status": "OK", "result": {...}}`` envelope), extraction still works."""
    payload = _load("us_nyc_locality.json")
    inner = payload["result"]
    out = extract_from_google_place(inner)
    assert out.city == "Brooklyn"
    assert out.country_code == "US"


def test_country_code_is_uppercased():
    payload = {
        "address_components": [
            {"long_name": "Lower", "short_name": "lo", "types": ["country"]}
        ]
    }
    out = extract_from_google_place(payload)
    assert out.country_code == "LO"


def test_malformed_latlng_does_not_raise():
    payload = {
        "geometry": {"location": {"lat": "not-a-number", "lng": None}},
        "addressComponents": [],
    }
    out = extract_from_google_place(payload)
    assert out.lat is None
    assert out.lng is None
