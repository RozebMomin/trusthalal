from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict


class PlaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    address: Optional[str] = Field(None, max_length=500)

    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class PlaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: Optional[str]
    lat: float
    lng: float
    # Canonical address fields — populated by external provider ingest.
    # All nullable because hand-entered places and pre-ingest rows may lack them.
    city: str | None = None
    region: str | None = None
    country_code: str | None = None
    postal_code: str | None = None

class PlaceNearby(BaseModel):
    distance_m: float


class PlaceSearchResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: str | None
    lat: float
    lng: float
    city: str | None = None
    region: str | None = None
    country_code: str | None = None

    # Embedded halal profile so consumer-site search results can render
    # validation tier + menu posture badges without an N+1 fetch per
    # row. Null when the place has no approved halal claim, or when its
    # most recent profile was revoked. Same shape as the embed on
    # ``PlaceDetail`` — kept inline (not imported) for the same
    # forward-reference reason explained below.
    halal_profile: "HalalProfileEmbed | None" = None


class GoogleAutocompletePrediction(BaseModel):
    """Slim shape returned by the owner-portal Google Autocomplete proxy.

    We deliberately collapse Google's verbose response (which includes
    structured_formatting, types, terms, matched_substrings, etc.) into
    just what the claim flow needs: an opaque place_id to send back on
    submit, plus a single human-readable description to render in the
    list. Anything else can come from the Place Details ingest later
    when the owner actually picks one and submits.
    """

    google_place_id: str
    description: str
    primary_text: str | None = None
    secondary_text: str | None = None


class ReverseGeocodeResult(BaseModel):
    """City-ish summary returned by the consumer "near me" reverse-
    geocode proxy.

    Powers the active-state pill on the search surface ("Searching X
    mi around Snellville"). All three fields are optional because
    Google can return a result with a country but no locality (rural
    coordinates, oceans, etc.) and the consumer surface degrades
    gracefully — the pill falls back to "around you" when ``city`` is
    null. Region is the short code (e.g. "GA") so the pill can read
    "Snellville, GA" without taking too much horizontal space on a
    phone.
    """

    city: str | None = None
    region: str | None = None
    country_code: str | None = None


class PlaceDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: str | None
    lat: float
    lng: float
    is_deleted: bool  # consumer will never see deleted b/c 404, but ok to include or omit
    city: str | None = None
    region: str | None = None
    country_code: str | None = None
    postal_code: str | None = None
    timezone: str | None = None
    # We intentionally skip a ``created_at`` field: the CREATED row on
    # ``place_events`` carries ingest time + actor, so a top-level
    # created_at would duplicate that with strictly less information.
    updated_at: datetime | None = None

    # Embedded halal profile (Phase 4 of the halal-trust v2 rebuild).
    # Null when:
    #   * The place has no approved halal claim yet, OR
    #   * The most recent profile was revoked by an admin.
    # Frontends that want to render the consumer trust labels read
    # from here directly. The dedicated
    # ``GET /places/{id}/halal-profile`` endpoint returns the same
    # shape with a 404 when the embedded value would be null —
    # useful for "did this place lose its profile?" semantics.
    halal_profile: "HalalProfileEmbed | None" = None


class HalalProfileEmbed(BaseModel):
    """Inline halal-profile shape, kept here (rather than imported
    from app.modules.halal_profiles.schemas) to avoid a Pydantic-
    forward-reference rebuild dance. Field set MUST stay in lock-step
    with ``HalalProfileRead`` over there — when one changes, update
    the other.

    Why duplicate the shape: importing HalalProfileRead here would
    create an import cycle (halal_profiles → places.schemas references
    halal_profiles → halal_profiles is being imported). Cheaper to
    duplicate the column list than to refactor.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    validation_tier: str
    menu_posture: str
    has_pork: bool
    alcohol_policy: str
    alcohol_in_cooking: bool
    chicken_slaughter: str
    beef_slaughter: str
    lamb_slaughter: str
    goat_slaughter: str
    seafood_only: bool
    has_certification: bool
    certifying_body_name: str | None
    certificate_expires_at: datetime | None
    caveats: str | None
    dispute_state: str
    last_verified_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None
    updated_at: datetime


# Resolve the forward reference to HalalProfileEmbed declared above.
PlaceDetail.model_rebuild()
PlaceSearchResult.model_rebuild()


class OwnedPlaceRead(BaseModel):
    """A place the calling user can submit halal information for.

    "Owns" here means: there's an ACTIVE PlaceOwner row for some org
    the user is an ACTIVE OrganizationMember of. This is what backs
    the picker on the owner portal's "New halal claim" flow — the
    owner shouldn't be searching the catalog for a place they
    already run; they should be picking from their own list.

    A user might own a place via more than one org (rare, but
    possible). Each owning org gets its own row in the response, so
    the picker can show "Khan Halal LLC owns 5 places" alongside
    "Khan Catering Co. owns 2 places" without deduping.
    """

    model_config = ConfigDict(from_attributes=True)

    place_id: UUID
    place_name: str
    place_address: str | None = None
    place_city: str | None = None
    place_country_code: str | None = None
    organization_id: UUID
    organization_name: str
    # Whether this place currently has a non-revoked halal profile.
    # Drives the picker's "first-time submission" vs "renewal /
    # update" copy on the new-claim screen.
    has_halal_profile: bool = False