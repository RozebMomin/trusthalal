"""Mapbox Geocoding v6 client — alternate provider for forward + reverse
city/place lookups.

Why Mapbox alongside Google
---------------------------
The consumer "Pick a city" picker and the near-me city pill both
forward / reverse-geocode user input to translate it into a search
center. We started with Google's Geocoding API, which is fine but has
two paper cuts:

  1. Free tier sits at ~40k calls/month under the $200 credit. A
     city-picker that fires a call per debounced keystroke can chew
     through that surprisingly fast.
  2. The same project + key already runs Places (autocomplete,
     ingest details) which has its own constraints. Restricting the
     key to "Places API only" is the right security posture but
     immediately breaks Geocoding (REQUEST_DENIED) — easy to
     misconfigure on a fresh deploy.

Mapbox's Geocoding API gives 100k requests/month free, doesn't share
its quota with anything else we use, and ships a single token that
isn't tangled up with our Places key restrictions. When the
``MAPBOX_ACCESS_TOKEN`` env var is set, the geocoding routes prefer
Mapbox; without it they fall back to Google so existing
deployments keep working unchanged.

What this module owns
---------------------
* ``MapboxAPIError`` — uniform exception so the router can render
  the same "geocoding currently unavailable" 502/503 path for both
  providers.
* ``fetch_forward_geocode_mapbox(query)`` — returns up to 5
  ``ForwardGeocodeRow`` tuples ready to drop into the existing
  ``_cached_forward_geocode_payload`` cache value. Same shape the
  Google extractor already produces; the router doesn't have to
  branch on provider.
* ``fetch_reverse_geocode_mapbox(lat, lng)`` — returns a
  ``ReverseGeocodeLocality``, matching what
  ``extract_locality_from_geocode`` produces for Google responses.

The Google client stays untouched. The router picks between the two
in one place; everywhere else (cache, downstream consumers) stays
provider-agnostic.

Why a hand-written httpx client (no Mapbox SDK)
-----------------------------------------------
Same reasoning as ``google_client.py``: three HTTP calls don't
justify pulling in another transitive dependency tree. ``httpx`` is
already a project dep.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.core.config import settings
from app.modules.places.integrations.google import ReverseGeocodeLocality


# A single forward-geocode row, shaped to match the cache value the
# router already stores. Keeping the tuple flat (not a dataclass) so
# it stays hashable for ``functools.lru_cache``.
ForwardGeocodeRow = tuple[
    str,        # label  ("Atlanta, GA, USA")
    float,      # lat
    float,      # lng
    str | None, # city
    str | None, # region
    str | None, # country_code
]


class MapboxAPIError(Exception):
    """Raised when Mapbox returns a non-success or the wire format
    drifts from what we expect.

    The router translates this into a generic 502/503 with the same
    error code the Google path uses, so the consumer dialog renders
    the same "geocoding unavailable" message regardless of which
    provider was attempted.
    """


# ---------------------------------------------------------------------------
# Forward geocode
# ---------------------------------------------------------------------------


def fetch_forward_geocode_mapbox(
    query: str,
    *,
    access_token: str | None = None,
    base_url: str | None = None,
    timeout_s: float = 10.0,
    limit: int = 5,
) -> list[ForwardGeocodeRow]:
    """Forward-geocode a free-text place query against Mapbox v6.

    Returns up to ``limit`` rows in the cache shape the existing
    router already understands. Empty / whitespace queries
    short-circuit to an empty list so we don't burn an API call on
    a no-op input.

    Status handling: Mapbox returns 200 with an empty
    ``features`` array on no-results — same posture as Google's
    ZERO_RESULTS — and we surface that as ``[]``. Non-2xx HTTP
    raises ``MapboxAPIError``.
    """
    trimmed = (query or "").strip()
    if not trimmed:
        return []

    effective_token = access_token or settings.MAPBOX_ACCESS_TOKEN
    if not effective_token:
        raise MapboxAPIError(
            "MAPBOX_ACCESS_TOKEN is not configured; Mapbox forward "
            "geocoding is unavailable."
        )

    effective_base = base_url or settings.MAPBOX_GEOCODE_BASE_URL
    url = f"{effective_base.rstrip('/')}/forward"

    # ``types`` narrows the result set to city-shaped features. The
    # picker is "where do I want to search?", not "find this exact
    # restaurant", so neighborhoods and addresses are useful but POIs
    # would be noise. ``proximity=ip`` would bias toward the caller's
    # location but our caller is a server (the API) so the IP would
    # always be ours, not the visitor's — skip it.
    params = {
        "q": trimmed,
        "access_token": effective_token,
        "limit": str(limit),
        "types": "place,locality,district,neighborhood,address,postcode",
    }

    try:
        resp = httpx.get(url, params=params, timeout=timeout_s)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise MapboxAPIError(
            f"Mapbox forward-geocode HTTP error: {exc}"
        ) from exc

    payload = resp.json()
    return _extract_forward_rows(payload, limit=limit)


def _extract_forward_rows(
    payload: dict[str, Any],
    *,
    limit: int,
) -> list[ForwardGeocodeRow]:
    """Pull ``ForwardGeocodeRow`` tuples out of a Mapbox v6
    FeatureCollection response.

    Defensive: anything missing or off-shape gets skipped rather than
    raising. The picker dialog shows whatever it can; one malformed
    feature shouldn't blank out the whole list.
    """
    features = payload.get("features") or []
    if not isinstance(features, list):
        return []

    out: list[ForwardGeocodeRow] = []
    for feat in features[:limit]:
        if not isinstance(feat, dict):
            continue

        coords = (
            (feat.get("geometry") or {}).get("coordinates") or []
        )
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        try:
            lng = float(coords[0])
            lat = float(coords[1])
        except (TypeError, ValueError):
            continue

        props = feat.get("properties") or {}
        city, region, country_code = _locality_from_properties(props)

        # Build a label that always round-trips legibly. Prefer
        # Mapbox's pre-built ``full_address`` ("Atlanta, Georgia,
        # United States") — it's the right shape for a one-tap
        # disambiguation list. Fall back to ``place_formatted`` +
        # name, then to the structured fields.
        label = (
            props.get("full_address")
            or props.get("name_preferred")
            or props.get("name")
            or _compose_label(city, region, country_code)
            or "Unnamed location"
        )

        out.append((str(label), lat, lng, city, region, country_code))

    return out


# ---------------------------------------------------------------------------
# Reverse geocode
# ---------------------------------------------------------------------------


def fetch_reverse_geocode_mapbox(
    lat: float,
    lng: float,
    *,
    access_token: str | None = None,
    base_url: str | None = None,
    timeout_s: float = 10.0,
) -> ReverseGeocodeLocality:
    """Reverse-geocode a lat/lng to the city/region/country triple
    used by the consumer near-me pill ("Searching 5 mi around
    Snellville, GA").

    Returns a ``ReverseGeocodeLocality`` with all-None when Mapbox
    has no place-shaped feature for the point (middle of an ocean,
    etc.) so the caller can render "around you" cleanly. Non-2xx
    HTTP raises ``MapboxAPIError``.
    """
    effective_token = access_token or settings.MAPBOX_ACCESS_TOKEN
    if not effective_token:
        raise MapboxAPIError(
            "MAPBOX_ACCESS_TOKEN is not configured; Mapbox reverse "
            "geocoding is unavailable."
        )

    effective_base = base_url or settings.MAPBOX_GEOCODE_BASE_URL
    url = f"{effective_base.rstrip('/')}/reverse"

    params = {
        "longitude": str(lng),
        "latitude": str(lat),
        "access_token": effective_token,
        "limit": "1",
        "types": "place,locality,district,neighborhood",
    }

    try:
        resp = httpx.get(url, params=params, timeout=timeout_s)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise MapboxAPIError(
            f"Mapbox reverse-geocode HTTP error: {exc}"
        ) from exc

    payload = resp.json()
    features = payload.get("features") or []
    if not isinstance(features, list) or not features:
        return ReverseGeocodeLocality(None, None, None)

    feat = features[0]
    if not isinstance(feat, dict):
        return ReverseGeocodeLocality(None, None, None)

    props = feat.get("properties") or {}
    city, region, country_code = _locality_from_properties(props)
    return ReverseGeocodeLocality(
        city=city,
        region=region,
        country_code=country_code,
    )


# ---------------------------------------------------------------------------
# Shared property → (city, region, country_code) extractor
# ---------------------------------------------------------------------------


def _locality_from_properties(
    props: dict[str, Any],
) -> tuple[str | None, str | None, str | None]:
    """Pull the structured city / region / country triple out of a
    Mapbox v6 feature's ``properties``.

    Mapbox stores parent-administrative info on ``properties.context``
    as a dict keyed by feature_type ("country", "region", "place",
    etc.). We pick:

      * ``city``         — feature's own ``name`` when feature_type
                           is place/locality, else look in
                           ``context.place.name`` or
                           ``context.locality.name``.
      * ``region``       — ``context.region.region_code`` (e.g.,
                           "GA"); falls back to ``region.name``.
      * ``country_code`` — ``context.country.country_code`` (ISO
                           alpha-2, uppercased).
    """
    context = props.get("context") or {}
    if not isinstance(context, dict):
        context = {}

    feature_type = props.get("feature_type") or ""
    name = props.get("name")

    # City: feature's own name when the feature itself is city-
    # shaped; otherwise consult the context map.
    if feature_type in ("place", "locality") and isinstance(name, str):
        city: str | None = name
    else:
        place_ctx = context.get("place") or {}
        locality_ctx = context.get("locality") or {}
        city = (
            place_ctx.get("name")
            if isinstance(place_ctx, dict) and isinstance(place_ctx.get("name"), str)
            else None
        )
        if not city and isinstance(locality_ctx, dict):
            city = (
                locality_ctx.get("name")
                if isinstance(locality_ctx.get("name"), str)
                else None
            )

    # Region — prefer the short code so the consumer pill stays terse.
    region: str | None = None
    region_ctx = context.get("region") or {}
    if isinstance(region_ctx, dict):
        rc = region_ctx.get("region_code")
        rn = region_ctx.get("name")
        if isinstance(rc, str) and rc:
            region = rc
        elif isinstance(rn, str) and rn:
            region = rn

    # Country code — ISO alpha-2, uppercased.
    country_code: str | None = None
    country_ctx = context.get("country") or {}
    if isinstance(country_ctx, dict):
        cc = country_ctx.get("country_code")
        if isinstance(cc, str) and cc:
            country_code = cc.upper()

    return city, region, country_code


def _compose_label(
    city: str | None, region: str | None, country_code: str | None
) -> str | None:
    """Mirror of the Google client's same-named helper. Builds a
    "City, REGION" label from the structured fields when Mapbox
    didn't ship a usable ``full_address``.
    """
    parts = [p for p in (city, region, country_code) if p]
    return ", ".join(parts) if parts else None


