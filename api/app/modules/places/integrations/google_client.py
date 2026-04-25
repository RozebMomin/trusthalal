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
