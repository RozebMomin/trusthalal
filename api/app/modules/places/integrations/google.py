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

from dataclasses import dataclass, field
from typing import Any, Iterable

from app.modules.places.enums import Cuisine


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

    ``cuisine_types`` is a list (possibly empty) rather than ``None`` because
    the underlying column is also non-null with an empty default — the
    ingest path always has a concrete value to write.
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
    # Curated cuisines derived from Google's ``primaryType`` (Places API
    # New) or the legacy ``types`` array. Empty list = no Google type
    # mapped to a known cuisine — the place still ingests fine, just
    # without auto-tags. See ``_GOOGLE_TYPE_TO_CUISINE`` below.
    cuisine_types: list[Cuisine] = field(default_factory=list)
    # Business phone. Default keeps existing constructors (tests, fixtures)
    # working without passing it. Set by ``extract_from_google_place``.
    phone: str | None = None
    # Listing website (``websiteUri`` new / ``website`` legacy).
    website_url: str | None = None
    # Google star rating (1.0–5.0) + number of user ratings. Volatile.
    rating: float | None = None
    rating_count: int | None = None
    # Normalized opening hours:
    #   {"periods": [{"open": {"day","hour","minute"},
    #                 "close": {"day","hour","minute"} | None}, ...]}
    # ``day`` is Google's 0=Sunday..6=Saturday. None for places Google
    # doesn't publish hours for. ``opening_hours_weekday_text`` is the
    # parallel human-readable list for display.
    opening_hours: dict | None = None
    opening_hours_weekday_text: list | None = None


# Map Google Place types (from the New API ``primaryType`` and the legacy
# ``types`` array) to our curated ``Cuisine`` enum. Google's type vocabulary
# (Table A in their docs) covers the obvious "X_restaurant" cases — anything
# Google doesn't expose with that level of granularity (Pakistani, Yemeni,
# Somali, etc.) stays auto-untagged and waits for an owner to set it
# manually from the claim editor. That's an explicit choice: better to
# under-tag than to mis-tag with a too-broad cuisine.
#
# A single Google place can carry multiple matching types (e.g. a Greek
# restaurant might surface ``["greek_restaurant", "mediterranean_restaurant",
# "restaurant"]``); we extract every matching cuisine and dedupe — the
# column is multi-valued precisely so we don't have to pick a winner.
_GOOGLE_TYPE_TO_CUISINE: dict[str, Cuisine] = {
    # South / Central Asian — Google has limited coverage here, but
    # ``afghani_restaurant`` and ``indian_restaurant`` exist in Table A.
    "afghani_restaurant": Cuisine.AFGHAN,
    "indian_restaurant": Cuisine.INDIAN,
    # East Asian
    "chinese_restaurant": Cuisine.CHINESE,
    "japanese_restaurant": Cuisine.JAPANESE,
    "korean_restaurant": Cuisine.KOREAN,
    "ramen_restaurant": Cuisine.JAPANESE,
    "sushi_restaurant": Cuisine.JAPANESE,
    # Southeast Asian
    "indonesian_restaurant": Cuisine.INDONESIAN,
    "thai_restaurant": Cuisine.THAI,
    # Middle Eastern
    "lebanese_restaurant": Cuisine.LEBANESE,
    "turkish_restaurant": Cuisine.TURKISH,
    # Mediterranean / European
    "mediterranean_restaurant": Cuisine.MEDITERRANEAN,
    "greek_restaurant": Cuisine.GREEK,
    "italian_restaurant": Cuisine.ITALIAN,
    "spanish_restaurant": Cuisine.SPANISH,
    "pizza_restaurant": Cuisine.PIZZA,
    # Americas
    "american_restaurant": Cuisine.AMERICAN,
    "mexican_restaurant": Cuisine.MEXICAN,
    "barbecue_restaurant": Cuisine.BBQ,
    "hamburger_restaurant": Cuisine.BURGERS,
    # NOTE: ``fast_food_restaurant`` is intentionally NOT mapped here.
    # Google attaches it to anything fast-casual regardless of actual
    # cuisine — halal sandwich shops, wing joints, and delis routinely
    # pick it up alongside their real category. Mapping it to BURGERS
    # was the original v1 behavior; it produced incorrect tags often
    # enough to roll back. The more specific Google types
    # (``hamburger_restaurant``, ``sandwich_shop``,
    # ``chicken_wings_restaurant``, etc.) cover the actual cases.
    "steak_house": Cuisine.STEAKHOUSE,
    "seafood_restaurant": Cuisine.SEAFOOD,
    # Format / generic
    "sandwich_shop": Cuisine.SANDWICHES,
    "deli": Cuisine.DELI,
    "chicken_wings_restaurant": Cuisine.WINGS,
    "hot_dog_restaurant": Cuisine.HOT_DOGS,
    "bakery": Cuisine.BAKERY,
    "bagel_shop": Cuisine.BAKERY,
    "cafe": Cuisine.CAFE,
    "cafeteria": Cuisine.CAFE,
    "coffee_shop": Cuisine.CAFE,
    "tea_house": Cuisine.CAFE,
    "breakfast_restaurant": Cuisine.BREAKFAST,
    "brunch_restaurant": Cuisine.BREAKFAST,
    "diner": Cuisine.AMERICAN,
    "dessert_restaurant": Cuisine.DESSERTS,
    "dessert_shop": Cuisine.DESSERTS,
    "ice_cream_shop": Cuisine.DESSERTS,
    "donut_shop": Cuisine.DESSERTS,
    "confectionery": Cuisine.DESSERTS,
}


def _extract_cuisines(root: dict[str, Any]) -> list[Cuisine]:
    """Pull cuisine tags from Google's primaryType + types vocabulary.

    New API: ``primaryType`` is a single string (most specific category
    Google picked). ``types`` is a parallel list with the broader bucket.
    Legacy API: only ``types`` is populated (an array). We read both and
    dedupe so a single payload can yield multiple cuisines (e.g. a Greek
    place tagged greek + mediterranean).
    """
    candidates: list[str] = []
    primary = root.get("primaryType")
    if isinstance(primary, str) and primary:
        candidates.append(primary)
    raw_types = root.get("types")
    if isinstance(raw_types, list):
        for t in raw_types:
            if isinstance(t, str) and t:
                candidates.append(t)

    out: list[Cuisine] = []
    seen: set[Cuisine] = set()
    for raw in candidates:
        cuisine = _GOOGLE_TYPE_TO_CUISINE.get(raw)
        if cuisine is None or cuisine in seen:
            continue
        seen.add(cuisine)
        out.append(cuisine)
    return out


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


def _as_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _normalize_hour_point(point: Any) -> dict | None:
    """Coerce a Google open/close point into ``{day, hour, minute}``.

    New API: ``{"day": 0, "hour": 9, "minute": 0}``.
    Legacy API: ``{"day": 0, "time": "0900"}``.
    """
    if not isinstance(point, dict):
        return None
    day = _as_int(point.get("day"))
    if day is None:
        return None
    hour = _as_int(point.get("hour"))
    minute = _as_int(point.get("minute"))
    if hour is None:
        # Legacy "HHMM" string.
        t = point.get("time")
        if isinstance(t, str) and len(t) == 4 and t.isdigit():
            hour = int(t[:2])
            minute = int(t[2:])
    return {"day": day, "hour": hour or 0, "minute": minute or 0}


def _extract_hours(root: dict[str, Any]) -> tuple[dict | None, list | None]:
    """Normalize Google opening hours to ``(opening_hours, weekday_text)``.

    Reads ``regularOpeningHours`` (New API) or ``opening_hours`` (legacy).
    Returns ``(None, None)`` when Google didn't publish hours. Only the
    canonical weekly schedule (periods) + human weekday strings are kept;
    Google's point-in-time ``openNow`` is intentionally dropped — we compute
    "open now" ourselves against the place timezone so it stays correct
    between syncs.
    """
    hours = root.get("regularOpeningHours") or root.get("opening_hours")
    if not isinstance(hours, dict):
        return (None, None)

    periods_out: list[dict] = []
    for p in hours.get("periods") or []:
        if not isinstance(p, dict):
            continue
        open_pt = _normalize_hour_point(p.get("open"))
        if open_pt is None:
            continue
        close_pt = _normalize_hour_point(p.get("close"))
        periods_out.append({"open": open_pt, "close": close_pt})

    weekday_text = (
        hours.get("weekdayDescriptions")
        or hours.get("weekday_text")
        or None
    )
    if not isinstance(weekday_text, list):
        weekday_text = None

    if not periods_out and weekday_text is None:
        return (None, None)
    return ({"periods": periods_out}, weekday_text)


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

    # Phone: prefer national display format; accept both New API
    # (nationalPhoneNumber/internationalPhoneNumber) and legacy
    # (formatted_phone_number/international_phone_number) keys.
    phone = (
        root.get("nationalPhoneNumber")
        or root.get("internationalPhoneNumber")
        or root.get("formatted_phone_number")
        or root.get("international_phone_number")
        or None
    )

    website = root.get("websiteUri") or root.get("website") or None
    rating = _as_float(root.get("rating"))
    rating_count = _as_int(
        root.get("userRatingCount")
        if root.get("userRatingCount") is not None
        else root.get("user_ratings_total")
    )
    opening_hours, weekday_text = _extract_hours(root)

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
        cuisine_types=_extract_cuisines(root),
        phone=phone if isinstance(phone, str) else None,
        website_url=website if isinstance(website, str) else None,
        rating=rating,
        rating_count=rating_count,
        opening_hours=opening_hours,
        opening_hours_weekday_text=weekday_text,
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
