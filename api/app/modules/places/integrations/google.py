"""Pure helpers for translating Google Place Details payloads into our model.

Design
------
This module is deliberately I/O-free: no SQLAlchemy, no httpx, no settings
lookups. It's a pair of dataclasses and pure functions so we can unit-test
against captured fixture JSON without any infrastructure.

The network call + persistence live in ``app/modules/places/ingest.py``, which
composes this extractor with the DB session.

Supports both the legacy Google Places API (``result.address_components``) and
the newer Places (New) API (``addressComponents`` / ``displayName.text`` /
``location.latitude``). On-the-wire shapes differ, but both include enough
structured data to derive our canonical fields.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True, slots=True)
class ReverseGeocodeLocality:
    """City-ish summary of a reverse-geocoded coordinate.

    Used by the consumer "near me" pill to render a label like
    "Searching 5 mi around Snellville" rather than the generic
    "around you". Only carries the fields the consumer surface
    needs; the canonical-fields dataclass below is used for ingest.
    """

    city: str | None
    region: str | None
    country_code: str | None


@dataclass(frozen=True, slots=True)
class CanonicalPlaceFields:
    """Shape the ingest service expects from any provider extractor.

    All fields are optional so that a partial payload still yields a valid
    object — callers are responsible for enforcing presence of fields they
    consider required (e.g. ``name``, ``lat``, ``lng``).
    """

    name: str | None
    address: str | None
    lat: float | None
    lng: float | None
    city: str | None
    region: str | None
    country_code: str | None
    postal_code: str | None
    timezone: str | None


# Countries where Google populates ``postal_town`` instead of ``locality``
# for what end-users call "the city". Extend as we learn.
_POSTAL_TOWN_COUNTRIES: frozenset[str] = frozenset({"GB", "IE"})

# Ordered fallback: try the most specific/common city-like component first.
# Different countries encode city at different admin levels.
#
# Ordering rationale:
#   * locality is the default in most countries (New York, Paris, Tokyo).
#   * postal_town is the UK/IE override (handled above via _POSTAL_TOWN_COUNTRIES,
#     but also left in the list as a safety net).
#   * sublocality_* come *before* administrative_area_level_* because in the US,
#     if a Google result is within a borough (Queens, Brooklyn) without a locality
#     component, sublocality_level_1 holds the borough ("Queens") while
#     administrative_area_level_2 holds the county name ("Queens County") — we
#     want the borough.
#   * administrative_area_level_3 precedes level_2 because level_3 is typically a
#     municipality (common in France/Italy) while level_2 is often a region/county.
_CITY_TYPE_PREFERENCE: tuple[str, ...] = (
    "locality",
    "postal_town",
    "sublocality_level_1",
    "sublocality",
    "administrative_area_level_3",
    "administrative_area_level_2",
)


def _normalize_components(
    raw: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Coerce new-API component shape (``longText``/``shortText``) into legacy
    (``long_name``/``short_name``) so the rest of the file has one thing to
    reason about.
    """
    out: list[dict[str, Any]] = []
    for c in raw:
        out.append(
            {
                "long_name": c.get("long_name") or c.get("longText"),
                "short_name": c.get("short_name") or c.get("shortText"),
                "types": list(c.get("types", [])),
            }
        )
    return out


def _find_component(
    components: list[dict[str, Any]], *types: str
) -> dict[str, Any] | None:
    wanted = set(types)
    for c in components:
        if wanted.intersection(c.get("types", [])):
            return c
    return None


def _extract_city(
    components: list[dict[str, Any]], country_code: str | None
) -> str | None:
    # Country-specific override first (UK/IE prefer postal_town over locality).
    if country_code in _POSTAL_TOWN_COUNTRIES:
        hit = _find_component(components, "postal_town")
        if hit:
            return hit.get("long_name")

    for t in _CITY_TYPE_PREFERENCE:
        hit = _find_component(components, t)
        if hit:
            return hit.get("long_name")
    return None


def _extract_name(root: dict[str, Any]) -> str | None:
    # New API: root["displayName"] = {"text": "...", "languageCode": "..."}
    # Legacy API: root["name"] = "..."
    display = root.get("displayName")
    if isinstance(display, dict):
        txt = display.get("text")
        if isinstance(txt, str) and txt:
            return txt
    if isinstance(display, str) and display:
        return display
    nm = root.get("name")
    return nm if isinstance(nm, str) and nm else None


def _first_present(d: dict[str, Any], *keys: str) -> Any:
    """Return the first value in ``d`` whose key is present with a non-None
    value. Unlike ``d.get(k1) or d.get(k2)``, this correctly handles falsy
    numerics like ``0`` / ``0.0`` — critical for lat/lng on the equator/meridian.
    """
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return None


def _extract_latlng(root: dict[str, Any]) -> tuple[float | None, float | None]:
    # New API puts lat/lng at root.location.{latitude,longitude}.
    # Legacy API puts them at root.geometry.location.{lat,lng}.
    lat: float | None = None
    lng: float | None = None

    loc_new = root.get("location")
    if isinstance(loc_new, dict):
        lat = _as_float(_first_present(loc_new, "latitude", "lat"))
        lng = _as_float(_first_present(loc_new, "longitude", "lng"))

    geom = root.get("geometry")
    if isinstance(geom, dict):
        loc = geom.get("location") or {}
        if lat is None:
            lat = _as_float(_first_present(loc, "lat", "latitude"))
        if lng is None:
            lng = _as_float(_first_present(loc, "lng", "longitude"))

    return lat, lng


def _extract_timezone(root: dict[str, Any]) -> str | None:
    # New API exposes ``timeZone.id`` (IANA). Legacy Place Details doesn't
    # include timezone — that's a separate Timezone API call. Callers can
    # backfill later via lat/lng if they want it.
    tz = root.get("timeZone") or root.get("time_zone")
    if isinstance(tz, dict):
        val = tz.get("id") or tz.get("name")
        return val if isinstance(val, str) and val else None
    if isinstance(tz, str) and tz:
        return tz
    return None


def _as_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def extract_from_google_place(payload: dict[str, Any]) -> CanonicalPlaceFields:
    """Map a Google Place Details response into canonical Place fields.

    Accepts either:
      * A legacy envelope: ``{"status": "OK", "result": {...}}``
      * A raw result dict (legacy or new API shape)

    Unknown / missing fields become ``None`` — no exceptions for partial data.
    """
    root = payload.get("result") if isinstance(payload.get("result"), dict) else payload

    components = _normalize_components(
        root.get("address_components") or root.get("addressComponents") or []
    )

    country_comp = _find_component(components, "country")
    country_code: str | None = None
    if country_comp:
        sc = country_comp.get("short_name")
        if isinstance(sc, str) and sc:
            country_code = sc.upper()

    city = _extract_city(components, country_code)

    region_comp = _find_component(components, "administrative_area_level_1")
    region = region_comp.get("long_name") if region_comp else None

    postal_comp = _find_component(components, "postal_code")
    postal_code = postal_comp.get("long_name") if postal_comp else None

    lat, lng = _extract_latlng(root)

    address = (
        root.get("formatted_address")
        or root.get("formattedAddress")
        or None
    )

    return CanonicalPlaceFields(
        name=_extract_name(root),
        address=address if isinstance(address, str) else None,
        lat=lat,
        lng=lng,
        city=city if isinstance(city, str) else None,
        region=region if isinstance(region, str) else None,
        country_code=country_code,
        postal_code=postal_code if isinstance(postal_code, str) else None,
        timezone=_extract_timezone(root),
    )


def extract_locality_from_geocode(
    payload: dict[str, Any],
) -> ReverseGeocodeLocality:
    """Map a Google Geocoding API response (``{"status": ..., "results":
    [...]}``) to a ``ReverseGeocodeLocality``.

    Strategy: scan each result's ``address_components`` and use the
    existing component-priority ladder (locality → postal_town →
    sublocality → admin levels) to pick the best city-like name. The
    first result Google returns is typically the most specific (street
    address); its components include the city for that point. If the
    first result's components don't contain anything we can call a
    city, walk through the rest of the list looking for one that does.

    Returns ``ReverseGeocodeLocality(None, None, None)`` for empty /
    ZERO_RESULTS payloads — callers (the proxy endpoint) translate
    that into "no city resolved" and the consumer pill falls back to
    "around you".
    """
    results = payload.get("results") or []
    if not isinstance(results, list):
        return ReverseGeocodeLocality(None, None, None)

    for result in results:
        if not isinstance(result, dict):
            continue
        components = _normalize_components(
            result.get("address_components")
            or result.get("addressComponents")
            or []
        )
        if not components:
            continue

        country_comp = _find_component(components, "country")
        country_code: str | None = None
        if country_comp:
            sc = country_comp.get("short_name")
            if isinstance(sc, str) and sc:
                country_code = sc.upper()

        city = _extract_city(components, country_code)
        if not city:
            # No city-like component on this result — try the next one.
            continue

        region_comp = _find_component(
            components, "administrative_area_level_1"
        )
        # Prefer the short region name (e.g. "GA") since the consumer
        # pill stays terse; fall back to the long name if Google didn't
        # ship a short_name.
        region: str | None = None
        if region_comp:
            sn = region_comp.get("short_name")
            ln = region_comp.get("long_name")
            region = sn if isinstance(sn, str) and sn else ln

        return ReverseGeocodeLocality(
            city=city if isinstance(city, str) else None,
            region=region if isinstance(region, str) else None,
            country_code=country_code,
        )

    # Walked every result, none had a usable city.
    return ReverseGeocodeLocality(None, None, None)
