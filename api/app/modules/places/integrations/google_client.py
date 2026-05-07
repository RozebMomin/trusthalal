"""Thin HTTP client around Google Place Details.

Why a dedicated module?
-----------------------
The ingest service in ``app/modules/places/ingest.py`` is easier to unit-test
if "fetch Google" is a swappable dependency. Here we define:

  * ``PlaceDetailsFetcher`` — a Protocol (``(place_id: str) -> dict``)
  * ``fetch_place_details_google(...)`` — the real implementation that hits
    the Places API with ``settings.GOOGLE_MAPS_API_KEY``

Tests can inject a callable that returns captured fixture JSON. Production
uses the real fetcher. No mocks-by-monkeypatch required.

Fields requested
----------------
We ask for the minimum set needed to populate canonical Place fields:

  * place_id              — echo-back, used as the external ID
  * name
  * formatted_address
  * address_components
  * geometry/location
  * types                 — for future filtering
  * business_status       — closed / operational

Add fields sparingly: billing is per-request-field-set. The raw response is
stored on ``PlaceExternalId.raw_data`` so future additions don't require
re-fetching for historical places (as long as the field was present at the
time of fetch).
"""

from __future__ import annotations

from typing import Any, Protocol

import httpx

from app.core.config import settings
from app.core.exceptions import NotFoundError


class PlaceDetailsFetcher(Protocol):
    """Callable that maps a Google Place ID to a raw Place Details payload."""

    def __call__(self, place_id: str) -> dict[str, Any]: ...


# Minimal field mask used against the legacy Places API. Keep small; this is a
# billed endpoint and the raw response goes straight to ``raw_data`` so we
# always have a full snapshot of what was returned.
_DEFAULT_FIELDS = ",".join(
    (
        "place_id",
        "name",
        "formatted_address",
        "address_components",
        "geometry/location",
        "types",
        "business_status",
    )
)


class GoogleAPIError(Exception):
    """Raised when Google returns a non-OK status or HTTP error."""


class PlaceAutocompleteFetcher(Protocol):
    """Callable that maps a free-text query to a list of Google
    Autocomplete predictions.

    Predictions come back as a list of ``{"place_id": ..., "description":
    ..., "structured_formatting": {...}}`` objects per the Places API
    docs. Tests inject a callable that returns captured fixture data so
    we can drive the owner portal's claim-fallback UI without burning
    real Google quota in CI.
    """

    def __call__(self, query: str) -> list[dict[str, Any]]: ...


def fetch_place_autocomplete_google(
    query: str,
    *,
    api_key: str | None = None,
    url: str | None = None,
    timeout_s: float = 10.0,
) -> list[dict[str, Any]]:
    """Fetch Google Place Autocomplete predictions for ``query``.

    Returns just the ``predictions`` array — the caller doesn't need the
    full envelope. The owner-portal proxy maps each prediction to a
    smaller wire shape (place_id + a single human-readable description).

    Empty / whitespace queries short-circuit to ``[]`` to avoid burning
    a billed call on a no-op input.
    """
    trimmed = (query or "").strip()
    if not trimmed:
        return []

    effective_key = api_key or settings.GOOGLE_MAPS_API_KEY
    if not effective_key:
        raise GoogleAPIError(
            "GOOGLE_MAPS_API_KEY is not configured; Place Autocomplete is unavailable."
        )

    effective_url = url or settings.GOOGLE_PLACES_AUTOCOMPLETE_URL

    # ``types=establishment`` filters to businesses (vs. addresses /
    # regions / cities) — owners are looking for restaurants, not
    # geographies. Google docs:
    # https://developers.google.com/maps/documentation/places/web-service/autocomplete
    params = {
        "input": trimmed,
        "key": effective_key,
        "types": "establishment",
    }

    try:
        resp = httpx.get(effective_url, params=params, timeout=timeout_s)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise GoogleAPIError(f"Google Autocomplete HTTP error: {exc}") from exc

    payload = resp.json()
    status = payload.get("status")

    # ZERO_RESULTS is the "no matches" signal — return [] rather than
    # raising, so the proxy can render an empty list cleanly.
    if status == "ZERO_RESULTS":
        return []
    if status != "OK":
        raise GoogleAPIError(
            f"Google Autocomplete returned status={status!r}: "
            f"{payload.get('error_message') or '(no error_message)'}"
        )

    predictions = payload.get("predictions") or []
    return list(predictions)


def fetch_place_details_google(
    place_id: str,
    *,
    api_key: str | None = None,
    url: str | None = None,
    fields: str = _DEFAULT_FIELDS,
    timeout_s: float = 10.0,
) -> dict[str, Any]:
    """Fetch a Google Place Details payload synchronously.

    Returns the full JSON response (including the ``{"status": "...", "result":
    {...}}`` envelope). Callers are expected to persist the full response to
    ``PlaceExternalId.raw_data`` and pass it through the extractor to derive
    canonical fields.
    """
    effective_key = api_key or settings.GOOGLE_MAPS_API_KEY
    if not effective_key:
        raise GoogleAPIError(
            "GOOGLE_MAPS_API_KEY is not configured; Place Details ingest is unavailable."
        )

    effective_url = url or settings.GOOGLE_PLACES_DETAILS_URL

    params = {
        "place_id": place_id,
        "fields": fields,
        "key": effective_key,
    }

    try:
        resp = httpx.get(effective_url, params=params, timeout=timeout_s)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise GoogleAPIError(f"Google Places HTTP error: {exc}") from exc

    payload = resp.json()

    status = payload.get("status")
    if status == "NOT_FOUND" or status == "ZERO_RESULTS":
        # Let the caller decide whether this is a 404 or a soft miss.
        raise NotFoundError(
            "GOOGLE_PLACE_NOT_FOUND",
            f"Google Places returned {status} for place_id {place_id!r}",
        )
    if status != "OK":
        # INVALID_REQUEST, OVER_QUERY_LIMIT, REQUEST_DENIED, UNKNOWN_ERROR
        raise GoogleAPIError(
            f"Google Places returned status={status!r}: "
            f"{payload.get('error_message') or '(no error_message)'}"
        )

    return payload


class ReverseGeocodeFetcher(Protocol):
    """Callable that maps a (lat, lng) pair to a Google Geocoding payload.

    Same swappable-dependency posture as the autocomplete + place-details
    fetchers above so tests can inject captured fixture JSON without
    burning real Google quota.
    """

    def __call__(self, lat: float, lng: float) -> dict[str, Any]: ...


def fetch_reverse_geocode_google(
    lat: float,
    lng: float,
    *,
    api_key: str | None = None,
    url: str | None = None,
    timeout_s: float = 10.0,
) -> dict[str, Any]:
    """Reverse-geocode a lat/lng to a Google Geocoding payload.

    Returns the full JSON response (``{"status": "OK", "results": [...]}``).
    Caller is responsible for picking the most appropriate result and
    parsing address_components — the helper in
    ``app/modules/places/integrations/google.py`` already knows how to
    extract city / region / country, so the proxy endpoint reuses it.

    Status handling mirrors ``fetch_place_details_google``:
      * ``OK`` → return payload
      * ``ZERO_RESULTS`` → return payload as-is so the caller can render
        a "no city" outcome cleanly. Reverse-geocoding the middle of an
        ocean isn't an error condition; it's just empty.
      * Anything else → raise ``GoogleAPIError``.
    """
    effective_key = api_key or settings.GOOGLE_MAPS_API_KEY
    if not effective_key:
        raise GoogleAPIError(
            "GOOGLE_MAPS_API_KEY is not configured; reverse geocoding is unavailable."
        )

    effective_url = url or settings.GOOGLE_GEOCODE_URL

    # `result_type=locality|...` would let Google pre-filter, but the
    # legacy Geocoding API doesn't support a useful filter for "the
    # city of this point". Letting Google return the full ranked list
    # and picking client-side via the existing component-priority
    # ladder is more reliable across countries.
    params = {
        "latlng": f"{lat},{lng}",
        "key": effective_key,
    }

    try:
        resp = httpx.get(effective_url, params=params, timeout=timeout_s)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise GoogleAPIError(
            f"Google Geocoding HTTP error: {exc}"
        ) from exc

    payload = resp.json()
    status = payload.get("status")

    if status == "ZERO_RESULTS":
        return payload
    if status != "OK":
        raise GoogleAPIError(
            f"Google Geocoding returned status={status!r}: "
            f"{payload.get('error_message') or '(no error_message)'}"
        )

    return payload
