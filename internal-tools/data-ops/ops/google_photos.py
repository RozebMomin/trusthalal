"""Fetch a place's hero image from the official Google Place Photos API.

Two-step, per Google's Places API (New):

  1. GET places/{id} with FieldMask "photos" -> list of photo resources,
     each with a `name` ("places/PID/photos/REF") and `authorAttributions`.
  2. GET {photo.name}/media?skipHttpRedirect=true -> JSON with `photoUri`,
     then download that URI for the actual bytes.

This is the sanctioned API (billed against GOOGLE_MAPS_API_KEY), not an HTML
scrape. Google requires the author attribution to be displayed wherever the
photo is shown — we return it so the caller can persist it on the photo row.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import httpx

from app.core.config import settings

# The photo `name` already starts with "places/", so media lives under the v1
# root. Derive the root from the configured details URL to stay in sync with
# any regional-mirror override.
_PLACES_DETAILS_URL = settings.GOOGLE_PLACES_DETAILS_NEW_URL.rstrip("/")  # .../v1/places
_V1_ROOT = _PLACES_DETAILS_URL.rsplit("/places", 1)[0]  # .../v1


@dataclass(frozen=True, slots=True)
class GooglePhoto:
    bytes_: bytes
    content_type: str
    attribution: Optional[str]  # e.g. "John D" — Google's authorAttributions[0].displayName


def fetch_place_hero_photo(
    google_place_id: str,
    *,
    api_key: Optional[str] = None,
    max_px: int = 1600,
    timeout_s: float = 20.0,
) -> Optional[GooglePhoto]:
    """Return the first (headline) photo for a Google place, or None if the
    listing has no photos. Raises on API/transport errors."""
    key = api_key or settings.GOOGLE_MAPS_API_KEY
    if not key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY is not configured")

    # 1. Photo references
    details_url = f"{_PLACES_DETAILS_URL}/{google_place_id}"
    r = httpx.get(
        details_url,
        headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "photos"},
        timeout=timeout_s,
    )
    r.raise_for_status()
    photos = r.json().get("photos") or []
    if not photos:
        return None

    photo = photos[0]
    name = photo.get("name")
    if not name:
        return None
    attributions = photo.get("authorAttributions") or []
    attribution = None
    if attributions:
        attribution = attributions[0].get("displayName") or None

    # 2. Resolve media to a concrete image URI, then download it.
    media_url = f"{_V1_ROOT}/{name}/media"
    m = httpx.get(
        media_url,
        params={"maxWidthPx": max_px, "skipHttpRedirect": "true"},
        headers={"X-Goog-Api-Key": key},
        timeout=timeout_s,
    )
    m.raise_for_status()
    photo_uri = m.json().get("photoUri")
    if not photo_uri:
        return None

    img = httpx.get(photo_uri, timeout=timeout_s, follow_redirects=True)
    img.raise_for_status()
    content_type = (img.headers.get("content-type") or "image/jpeg").split(";")[0].strip()

    return GooglePhoto(bytes_=img.content, content_type=content_type, attribution=attribution)
