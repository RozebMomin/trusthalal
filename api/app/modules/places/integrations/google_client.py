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
        "formatted_phone_number",
        "website",
        "rating",
        "user_ratings_total",
        "opening_hours",
    )
)


# Field mask for the Places API New (sent via the X-Goog-FieldMask header
# rather than as a query param). The New API uses different field paths
# than the legacy ``fields`` query string — they're billed per field set
# the same way, so keep this minimal. ``primaryType`` is the headline
# add: it's how we auto-tag cuisine on ingest. ``types`` is included as
# a fallback for places where Google didn't pick a primary.
_DEFAULT_FIELDS_NEW = ",".join(
    (
        "id",
        "displayName",
        "formattedAddress",
        "addressComponents",
        "location",
        "primaryType",
        "types",
        "businessStatus",
        "nationalPhoneNumber",
        # Added for the website/rating/hours capture. NOTE: websiteUri,
        # rating, userRatingCount, and regularOpeningHours push the call
        # into Google's pricier Pro/Enterprise/Atmosphere SKU tiers — the
        # weekly volatile-field sync is intentionally low-frequency for
        # this reason.
        "websiteUri",
        "rating",
        "userRatingCount",
        "regularOpeningHours",
        # IANA timezone (e.g. {"id": "America/New_York"}). REQUIRED for
        # "open now": is_open_now() needs the place's timezone to evaluate
        # the stored hours. Without this field the extractor got null and
        # every place read back as open_now=unknown ("No hours available")
        # even when hours were present.
        "timeZone",
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


def _fetch_place_details_legacy(
    place_id: str,
    *,
    api_key: str,
    url: str,
    fields: str,
    timeout_s: float,
) -> dict[str, Any]:
    """Legacy ``maps.googleapis.com/maps/api/place/details/json`` path.

    Kept for ``GOOGLE_PLACES_USE_NEW=false`` rollback / regional mirrors.
    Response shape: ``{"status": "OK", "result": {...}}``.
    """
    params = {
        "place_id": place_id,
        "fields": fields,
        "key": api_key,
    }

    try:
        resp = httpx.get(url, params=params, timeout=timeout_s)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise GoogleAPIError(f"Google Places HTTP error: {exc}") from exc

    payload = resp.json()

    status = payload.get("status")
    if status == "NOT_FOUND" or status == "ZERO_RESULTS":
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


def _fetch_place_details_new(
    place_id: str,
    *,
    api_key: str,
    base_url: str,
    field_mask: str,
    timeout_s: float,
) -> dict[str, Any]:
    """Places API New: ``places.googleapis.com/v1/places/{id}``.

    Different conventions from legacy:
      * GET on a per-place URL (``{base}/{place_id}``) instead of a query
        param.
      * API key goes in the ``X-Goog-Api-Key`` header.
      * Field mask goes in the ``X-Goog-FieldMask`` header (no envelope
        — the response root IS the place result).
      * Errors come back as standard HTTP statuses with a JSON
        ``{"error": {...}}`` body; there's no ``status: "ZERO_RESULTS"``
        soft-miss anymore. 404 → NotFoundError, anything else 4xx/5xx →
        GoogleAPIError.

    Returns the raw New-API result dict. The extractor handles both
    legacy + new shapes natively, so callers don't need to branch.
    """
    # Per-place URL. The base config doesn't end with a slash, so add one.
    url = f"{base_url.rstrip('/')}/{place_id}"
    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": field_mask,
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=timeout_s)
    except httpx.HTTPError as exc:
        raise GoogleAPIError(f"Google Places (New) HTTP error: {exc}") from exc

    if resp.status_code == 404:
        raise NotFoundError(
            "GOOGLE_PLACE_NOT_FOUND",
            f"Google Places (New) returned 404 for place_id {place_id!r}",
        )
    if resp.status_code >= 400:
        # Surface Google's error message verbatim in the exception body —
        # makes debugging "why is ingest failing in prod" much faster.
        try:
            err_body = resp.json()
        except ValueError:
            err_body = resp.text
        raise GoogleAPIError(
            f"Google Places (New) returned HTTP {resp.status_code}: {err_body}"
        )

    return resp.json()


def fetch_place_details_google(
    place_id: str,
    *,
    api_key: str | None = None,
    url: str | None = None,
    fields: str = _DEFAULT_FIELDS,
    timeout_s: float = 10.0,
) -> dict[str, Any]:
    """Fetch a Google Place Details payload synchronously.

    Dispatches between the legacy ``/maps/api/place/details`` endpoint and
    the New API (``places.googleapis.com/v1/places/{id}``) based on
    ``settings.GOOGLE_PLACES_USE_NEW``. New is the default — it surfaces
    ``primaryType`` which the cuisine extractor relies on to auto-tag
    places on ingest.

    Returns the raw JSON response. Callers persist the full response to
    ``PlaceExternalId.raw_data`` and run it through the extractor — which
    is shape-agnostic between legacy and New, so the caller doesn't
    branch.
    """
    effective_key = api_key or settings.GOOGLE_MAPS_API_KEY
    if not effective_key:
        raise GoogleAPIError(
            "GOOGLE_MAPS_API_KEY is not configured; Place Details ingest is unavailable."
        )

    if settings.GOOGLE_PLACES_USE_NEW:
        # ``url`` is the legacy override; for tests that explicitly pass
        # a URL we honor it (against the legacy endpoint). Otherwise use
        # the New API base from settings.
        if url is not None:
            return _fetch_place_details_legacy(
                place_id,
                api_key=effective_key,
                url=url,
                fields=fields,
                timeout_s=timeout_s,
            )
        return _fetch_place_details_new(
            place_id,
            api_key=effective_key,
            base_url=settings.GOOGLE_PLACES_DETAILS_NEW_URL,
            field_mask=_DEFAULT_FIELDS_NEW,
            timeout_s=timeout_s,
        )

    return _fetch_place_details_legacy(
        place_id,
        api_key=effective_key,
        url=url or settings.GOOGLE_PLACES_DETAILS_URL,
        fields=fields,
        timeout_s=timeout_s,
    )


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


class ForwardGeocodeFetcher(Protocol):
    """Callable that maps a free-text place query (e.g. ``"Atlanta GA"``)
    to a Google Geocoding payload of matching candidates.

    Same swappable-dependency posture as the other fetchers so the
    consumer "Pick a city" dialog can be tested without real Google
    quota.
    """

    def __call__(self, query: str) -> dict[str, Any]: ...


def fetch_forward_geocode_google(
    query: str,
    *,
    api_key: str | None = None,
    url: str | None = None,
    timeout_s: float = 10.0,
) -> dict[str, Any]:
    """Forward-geocode a free-text place query to a Google Geocoding
    payload of matching candidates.

    Used by the consumer "Pick a city" fallback when geolocation is
    denied or unsupported. Returns the full JSON response so the
    caller can pick the best result and parse address_components via
    the existing extractor.

    Status handling mirrors ``fetch_reverse_geocode_google``:
      * ``OK`` → return payload
      * ``ZERO_RESULTS`` → return payload as-is. The caller renders
        an empty-state ("Couldn't find that place") rather than
        throwing.
      * Anything else → raise ``GoogleAPIError``.

    Empty / whitespace queries short-circuit to a ZERO_RESULTS-shaped
    payload so we don't burn a billed Google call on a no-op input.
    """
    trimmed = (query or "").strip()
    if not trimmed:
        return {"status": "ZERO_RESULTS", "results": []}

    effective_key = api_key or settings.GOOGLE_MAPS_API_KEY
    if not effective_key:
        raise GoogleAPIError(
            "GOOGLE_MAPS_API_KEY is not configured; forward geocoding is unavailable."
        )

    effective_url = url or settings.GOOGLE_GEOCODE_URL

    params = {
        "address": trimmed,
        "key": effective_key,
    }

    try:
        resp = httpx.get(effective_url, params=params, timeout=timeout_s)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise GoogleAPIError(
            f"Google Forward Geocoding HTTP error: {exc}"
        ) from exc

    payload = resp.json()
    status = payload.get("status")

    if status == "ZERO_RESULTS":
        return payload
    if status != "OK":
        raise GoogleAPIError(
            f"Google Forward Geocoding returned status={status!r}: "
            f"{payload.get('error_message') or '(no error_message)'}"
        )

    return payload
