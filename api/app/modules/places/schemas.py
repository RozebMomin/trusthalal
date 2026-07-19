from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict

from app.modules.places.enums import (
    Cuisine,
    PhotoAttribution,
    PlacePhotoSource,
)


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
    # Curated cuisine tags. Owner-edited from the halal-claim editor;
    # auto-populated on Google Places New ingest where ``primaryType``
    # maps cleanly. Empty list = untagged (the consumer surface
    # renders these places fine, they just don't match cuisine
    # filters).
    cuisine_types: list[Cuisine] = Field(default_factory=list)

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
    # Curated cuisine tags surfaced on consumer search rows so the
    # result card can render cuisine chips alongside the halal
    # badges. Empty list = no cuisines tagged yet.
    cuisine_types: list[Cuisine] = Field(default_factory=list)

    # Hero photo URL for the search-result thumbnail. Null when no
    # owner has marked a photo as hero (or when no photos exist
    # yet). Search list responses deliberately don't carry the full
    # photos array — that'd bloat the payload for every result row;
    # the detail page is where the gallery lives.
    hero_photo_url: str | None = None

    # Google rating + count for the result-card star. Null until synced.
    google_rating: float | None = None
    google_rating_count: int | None = None

    # First-party rating, from Trust Halal diners. Rides alongside Google's
    # rather than replacing it, and clients MUST label which is which — two
    # numbers measuring different things over different populations. The
    # aggregate is denormalized onto places and recomputed from PUBLISHED
    # reviews, so this costs no join.
    review_rating_avg: float | None = None
    review_count: int = 0
    # Server-computed against stored hours + place timezone. True/False when
    # hours are known, null when the place has no hours on file. Drives the
    # "Open now" badge on the card and the ?open_now= filter.
    open_now: bool | None = None

    # True when the place already has an ownership claim in flight or granted
    # (an ownership request in SUBMITTED / NEEDS_EVIDENCE / UNDER_REVIEW /
    # APPROVED). The owner-portal claim flow uses this to stop a restaurant
    # that's already spoken for from being selected. Consumer/mobile search
    # ignores it. Defaults False so older clients are unaffected.
    is_claimed: bool = False

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


class ForwardGeocodeMatch(BaseModel):
    """One result row from the consumer "Pick a city" forward-geocode
    proxy. The consumer dialog renders a small list of these so the
    user can disambiguate ("Springfield, IL" vs "Springfield, MA") on
    a single tap.

    ``label`` is the human-readable string ready for display
    (typically "City, REGION" or Google's full formatted_address).
    ``lat`` / ``lng`` are the resolved coordinates the consumer site
    pushes into the URL to drive the near-me search. ``city`` /
    ``region`` / ``country_code`` mirror the structured-address
    fields used elsewhere on the site.
    """

    label: str
    lat: float
    lng: float
    city: str | None = None
    region: str | None = None
    country_code: str | None = None


class ForwardGeocodeResults(BaseModel):
    """Wrapper around ``list[ForwardGeocodeMatch]`` so the consumer
    forward-geocode endpoint can grow extra metadata (e.g. an
    ``attribution`` field, a "did you mean" suggestion) without
    breaking the wire shape.
    """

    matches: list[ForwardGeocodeMatch] = Field(default_factory=list)


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
    # Business phone (from Google ingest); null for hand-entered places or
    # ones ingested before phone capture. Powers the "Call" action.
    phone: str | None = None
    # Listing website (from Google ingest). Powers the "Website" link.
    website_url: str | None = None
    # Google rating (1.0–5.0) + number of user ratings, and when they were
    # last refreshed — surfaces to consumers as "4.6 (312) · as of <date>".
    google_rating: float | None = None
    google_rating_count: int | None = None

    # First-party rating, from Trust Halal diners. Rides alongside Google's
    # rather than replacing it, and clients MUST label which is which — two
    # numbers measuring different things over different populations. The
    # aggregate is denormalized onto places and recomputed from PUBLISHED
    # reviews, so this costs no join.
    review_rating_avg: float | None = None
    review_count: int = 0

    # Whether anyone can actually respond to reviews here. An unclaimed place
    # has no verified owner, so its reviews block should invite a claim rather
    # than sit there unanswered. Mirrors the flag already on search results.
    is_claimed: bool = False
    google_synced_at: datetime | None = None
    # Human-readable opening hours for display, one string per day, e.g.
    # ["Monday: 9 AM–9 PM", ...]. Null when Google has no hours on file.
    opening_hours_weekday_text: list[str] | None = None
    # Server-computed "open now" against stored hours + timezone. Null when
    # hours are unknown.
    open_now: bool | None = None
    # Curated cuisine tags. See PlaceSearchResult.cuisine_types.
    cuisine_types: list[Cuisine] = Field(default_factory=list)
    # We intentionally skip a ``created_at`` field: the CREATED row on
    # ``place_events`` carries ingest time + actor, so a top-level
    # created_at would duplicate that with strictly less information.
    updated_at: datetime | None = None

    # Place photo gallery — owner + consumer uploads. Hero photo
    # comes first (sorted server-side via the
    # ``PlacePhoto.is_hero.desc()`` order on the relationship),
    # followed by the rest in newest-first order. Empty list when
    # no photos have been uploaded. ``hero_photo_url`` is the
    # convenience shortcut used by surfaces that only need the
    # cover image (search-result cards). Null when no hero is set.
    photos: list["PlacePhotoRead"] = Field(default_factory=list)
    hero_photo_url: str | None = None

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
    # Direct link to the halal certificate document (None when no
    # cert is on file or the copy step failed during approval). See
    # the rationale on ``HalalProfileRead.certificate_url``.
    certificate_url: str | None = None
    # MIME type of the cert; drives consumer-side viewer choice.
    certificate_content_type: str | None = None
    caveats: str | None
    dispute_state: str
    last_verified_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None
    updated_at: datetime


class HalalHistoryEventRead(BaseModel):
    """Consumer-facing verification-history entry for a place's halal
    profile — powers the "verification history" section on the expanded
    trust profile. Deliberately narrow vs the admin ``HalalProfileEventRead``:
    no actor/user id and no internal related-record ids, just the
    event type, a human summary, and when it happened.
    """

    model_config = ConfigDict(from_attributes=True)

    event_type: str
    description: str | None = None
    created_at: datetime
    # Attributed actor — only populated for verifier visits today, driving the
    # avatar + "Visit by @handle" line. Null for system/admin/owner milestones,
    # which the consumer timeline shows without exposing a person.
    actor_display_name: str | None = None
    actor_handle: str | None = None


class PlacePhotoRead(BaseModel):
    """Owner- or consumer-uploaded photo as it lands on the
    consumer-facing place detail.

    ``url`` is the public Supabase Storage URL — the bucket is
    configured public-readable so the consumer can ``<img>`` it
    directly without a signing round-trip. Server fills this in
    by combining the storage path with the bucket's public URL
    template.

    ``uploaded_by_display_name`` is included so the gallery can
    render a "by Khan Halal" credit under each photo without an
    extra fetch. Null when the uploading user has been deleted
    (FK ON DELETE SET NULL leaves the photo intact, which is the
    right call — the photo's about the place, not the person).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    url: str
    source: PlacePhotoSource
    #: Display-level provenance, derived server-side. Prefer this over
    #: ``source`` for anything user-visible — it folds in review attachment,
    #: which ``source`` can't express, and it means clients stop each
    #: maintaining their own (divergent, incomplete) label map.
    attribution: PhotoAttribution = PhotoAttribution.DINER
    #: Set when this photo was attached to a review. Lets the gallery link
    #: the photo back to the words that explain it.
    review_id: UUID | None = None
    #: The attached review's rating, so a caption can read "from a 2★
    #: review" without a second fetch per photo.
    review_rating: int | None = None
    width_px: int | None = None
    height_px: int | None = None
    caption: str | None = None
    is_hero: bool = False
    uploaded_by_display_name: str | None = None
    created_at: datetime


class PlacePhotoUpdate(BaseModel):
    """PATCH body for ``PATCH /places/{place_id}/photos/{photo_id}``.

    Two independently-optional fields:

      * ``is_hero`` — owner-only mutation. Setting to true marks
        this photo the hero and atomically clears any previous
        hero on the same place (server enforces via DB partial
        unique index). Setting to false unmarks; the place ends
        up with no hero unless another is set.
      * ``caption`` — uploader-or-owner can edit. Pass an empty
        string to clear; pass ``null`` (or omit) to leave
        unchanged. Pydantic ``Field(default=...)`` with a sentinel
        gives us the omit-vs-null distinction.

    Setting ``is_hero`` on a CONSUMER-source photo is **refused**
    (409 ``PHOTO_NOT_HERO_ELIGIBLE``). This reverses the earlier
    policy, which allowed it so an owner could say "this customer
    photo is the best shot of the dining room."

    Why it changed: once diners can attach photos to reviews, that
    same permission lets an owner promote a photo out of a two-star
    review into the image every search result shows — or, read the
    other way, lets them bury an unflattering one by curating around
    it. On a platform whose product is trustworthy provenance, the
    cover image asserting "this is the restaurant, from the
    restaurant" is worth more than the flexibility. Google reserves
    the same right in the other direction: it overrides an owner's
    cover with a user photo when the owner's is poor.

    Owners who want a diner's shot as their cover can ask for it and
    upload it themselves, which also settles the permission question
    the honest way.
    """

    model_config = ConfigDict(extra="forbid")

    is_hero: bool | None = Field(
        default=None,
        description=(
            "Mark or unmark this photo as the place's hero. Only "
            "owners (or admins) can change this; consumer callers "
            "get a 403."
        ),
    )
    caption: str | None = Field(
        default=None,
        max_length=500,
        description=(
            "Free-text caption. Empty string clears the existing "
            "caption; null / omitted leaves it unchanged. Max 500 "
            "chars."
        ),
    )


# Resolve the forward reference to HalalProfileEmbed declared above.
PlaceDetail.model_rebuild()
PlaceSearchResult.model_rebuild()


class OwnedPlaceUpdate(BaseModel):
    """PATCH body for ``PATCH /me/places/{place_id}``.

    Today the only patchable field is ``cuisine_types`` — the curated
    cuisine tags surfaced on consumer search rows. Identity columns
    (name / address / lat / lng / city / country) stay admin-only,
    since those are the canonical address record populated by Google
    ingest. We intentionally use a non-Optional list (rather than a
    PATCH-style ``cuisine_types | None`` partial) — submitting the
    payload always replaces the full set, including with ``[]`` to
    clear all tags. Simpler model, no merge ambiguity.

    Empty list is allowed. Duplicates in the input are tolerated and
    deduped server-side. Each entry must be a member of the curated
    ``Cuisine`` enum; unknown values 422 with FastAPI's standard
    validation error.
    """

    model_config = ConfigDict(extra="forbid")

    cuisine_types: list[Cuisine] = Field(
        default_factory=list,
        description=(
            "Replace the place's full cuisine tag set. Pass [] to "
            "clear. Duplicates are deduped."
        ),
    )


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

class SearchRelaxationRead(BaseModel):
    """One filter that is individually responsible for an empty result set.

    ``field`` is the machine key so a client can clear exactly that filter
    rather than nuking all of them. No label: the API stays neutral about how
    each surface words its own chips (same posture as ``Cuisine``), and the
    consumer, mobile and owner filter sheets already disagree slightly on
    wording for good reasons.
    """

    model_config = ConfigDict(from_attributes=True)

    field: str
    count_if_removed: int


class SearchDiagnosticsResponse(BaseModel):
    """Why a search came back empty, and what would fix it."""

    model_config = ConfigDict(from_attributes=True)

    #: Places in range before any halal or cuisine filtering. Zero means the
    #: catalogue doesn't cover here yet — a different problem from filters
    #: being too strict, and it needs different words on screen.
    total_in_area: int = 0
    #: Clear any one of these and you get results. Ordered by how much each
    #: opens up. Empty when several filters overlap, in which case no single
    #: change helps and ``without_halal_filters`` is the honest advice.
    single_filter_relaxations: list[SearchRelaxationRead] = Field(
        default_factory=list
    )
    without_halal_filters: int = 0
    without_cuisines: int = 0
    wider_radius_m: Optional[int] = None
    wider_radius_count: Optional[int] = None
