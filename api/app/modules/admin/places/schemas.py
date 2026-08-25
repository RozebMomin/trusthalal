from datetime import datetime
from enum import Enum
from typing import Annotated
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from app.modules.places.enums import DelistReason, ExternalIdProvider


# Upper bound on a single bulk preview/import batch. Deliberately small: the
# admin flow is "search a handful of names, select, import," not "seed a city."
# The cap keeps the synchronous import loop well inside the request timeout
# (each import is a billed, up-to-~10s Google Place Details call) and bounds
# the blast radius of a mistaken paste. Raise it only alongside an async /
# chunked execution model — see the bulk router for the loop.
BULK_PLACE_LIMIT = 25

# A single Google Place ID as it arrives from the browser Autocomplete widget:
# opaque to us, but never empty and never absurdly long. Reused by both bulk
# request bodies so the per-item validation is identical.
GooglePlaceId = Annotated[str, Field(min_length=1, max_length=255)]


class PlaceCountResponse(BaseModel):
    """Total places matching the admin browse filters (catalog size readout)."""

    total: int


class PlaceAdminRead(BaseModel):
    """Admin view of a place — exposes the soft-delete fields the public
    `PlaceRead` schema deliberately hides (the public `/places/{id}` 404s
    on deleted rows, so it has no reason to surface them). Used by the
    admin browse and detail endpoints so the UI can show a "Deleted"
    badge and flip between Delete / Restore actions.

    Also exposes canonical address fields (city, region, country_code,
    postal_code, timezone) — populated by ``/admin/places/ingest`` from the
    ``canonical_source`` provider. Admin list/detail pages use these for
    sorting, filtering, and display.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: str | None
    lat: float
    lng: float
    is_deleted: bool
    deleted_at: datetime | None = None
    # De-list state. A soft-deleted place with a non-NULL ``delist_reason`` is
    # a public tombstone (removed for cause), vs a plain junk delete (NULL).
    # Lets the admin UI show "De-listed: <reason>" and offer Re-list.
    delist_reason: DelistReason | None = None
    delist_note: str | None = None

    # Canonical address fields — nullable until a provider ingest populates them.
    city: str | None = None
    region: str | None = None
    country_code: str | None = None
    postal_code: str | None = None
    timezone: str | None = None
    canonical_source: ExternalIdProvider | None = None

    # Bumped by SQLAlchemy on every UPDATE. Drives the admin list's default
    # "most-recently touched" sort, and the detail page's "Last edited X"
    # header. Nullable on the type so the field survives a pre-migration
    # row briefly — post-migration the DB guarantees it's populated.
    updated_at: datetime | None = None


class PlaceIngestRequest(BaseModel):
    """Admin asks the API to create-or-find a Place from an external provider ID.

    Only Google is wired today. ``place_id`` is the opaque Google Place ID the
    admin UI obtains via the browser-side Places Autocomplete widget.
    """

    model_config = ConfigDict(extra="forbid")

    google_place_id: str = Field(..., min_length=1, max_length=255)


class PlaceIngestResponse(BaseModel):
    """Wraps the created-or-existing Place with flags the UI uses to pick a
    follow-up action (navigate, toast "already in catalog", offer Restore)."""

    model_config = ConfigDict(from_attributes=False)

    place: PlaceAdminRead
    existed: bool
    was_deleted: bool


# ---------------------------------------------------------------------------
# Bulk add — stage a handful of Google places, preview their dedup status,
# then import the selected subset. Both endpoints reuse the single-place
# ingest machinery; the only new concept is the batch wrapper + per-item
# results. See app/modules/admin/places/router.py for the loop.
# ---------------------------------------------------------------------------


class PlaceBulkPreviewStatus(str, Enum):
    """What a staged Google place would do on import — the cheap, Google-free
    signal the preview step surfaces so the admin can deselect duplicates
    before spending a billed import call.

    * ``NEW``          — no catalog row for this Google ID; import creates one.
    * ``EXISTS``       — already a live place; import is a safe no-op.
    * ``SOFT_DELETED`` — a soft-deleted place carries this Google ID; import
                         will NOT auto-restore it (matches single ingest).
    """

    NEW = "NEW"
    EXISTS = "EXISTS"
    SOFT_DELETED = "SOFT_DELETED"


class PlaceBulkPreviewRequest(BaseModel):
    """Ask the API which of these Google IDs already exist in the catalog.

    Pure DB lookup on ``(GOOGLE, external_id)`` — no Google Place Details
    call, so preview costs nothing. The admin UI already has each place's
    name/address from the Autocomplete widget, so the response only needs to
    add a dedup verdict per ID.
    """

    model_config = ConfigDict(extra="forbid")

    google_place_ids: list[GooglePlaceId] = Field(
        ..., min_length=1, max_length=BULK_PLACE_LIMIT
    )


class PlaceBulkPreviewItem(BaseModel):
    """One staged Google ID's dedup verdict.

    ``existing_place_id`` / ``existing_name`` are populated only when the ID
    already maps to a catalog row (EXISTS or SOFT_DELETED), letting the UI
    link to and name the place it collides with.
    """

    model_config = ConfigDict(from_attributes=False)

    google_place_id: str
    status: PlaceBulkPreviewStatus
    existing_place_id: UUID | None = None
    existing_name: str | None = None


class PlaceBulkPreviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=False)

    items: list[PlaceBulkPreviewItem]


class PlaceBulkImportOutcome(str, Enum):
    """Per-item result of a bulk import.

    * ``CREATED``      — new place ingested from Google.
    * ``EXISTED``      — already a live place; ingest returned it unchanged.
    * ``SOFT_DELETED`` — Google ID maps to a soft-deleted place; left as-is
                         (restore is a deliberate, separate admin action).
    * ``FAILED``       — this item errored (bad Google payload, fetch failure,
                         etc.); other items in the batch are unaffected.
    """

    CREATED = "CREATED"
    EXISTED = "EXISTED"
    SOFT_DELETED = "SOFT_DELETED"
    FAILED = "FAILED"


class PlaceBulkImportRequest(BaseModel):
    """Import the selected Google IDs. Each is ingested in its own
    transaction so one failure never rolls back the rest of the batch.
    """

    model_config = ConfigDict(extra="forbid")

    google_place_ids: list[GooglePlaceId] = Field(
        ..., min_length=1, max_length=BULK_PLACE_LIMIT
    )


class PlaceBulkImportItem(BaseModel):
    """Outcome for one imported Google ID.

    ``place_id`` / ``place_name`` are set on any non-FAILED outcome (the
    place that was created or matched); ``error_code`` / ``error_message``
    are set only on FAILED so the UI can explain what went wrong per row.
    """

    model_config = ConfigDict(from_attributes=False)

    google_place_id: str
    outcome: PlaceBulkImportOutcome
    place_id: UUID | None = None
    place_name: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class PlaceBulkImportSummary(BaseModel):
    """Roll-up counts for the batch, for the results toast/header."""

    model_config = ConfigDict(from_attributes=False)

    created: int = 0
    existed: int = 0
    soft_deleted: int = 0
    failed: int = 0


class PlaceBulkImportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=False)

    items: list[PlaceBulkImportItem]
    summary: PlaceBulkImportSummary


class PlaceLinkExternalRequest(BaseModel):
    """Attach a Google Place ID to an existing (usually manually-added) Place.

    Only Google is wired today. The admin UI obtains ``google_place_id`` via
    the browser-side Places Autocomplete widget — same widget the New Place
    modal uses.
    """

    model_config = ConfigDict(extra="forbid")

    google_place_id: str = Field(..., min_length=1, max_length=255)


class PlaceLinkExternalResponse(BaseModel):
    """Result of ``POST /admin/places/{id}/link-external``.

    ``existed=True`` means the exact same (place_id, google_place_id) link
    was already in the database — caller should treat it as a no-op and
    can show a subtle "already linked" toast instead of a success toast.

    ``fields_updated`` lists canonical columns that were populated by the
    link call (empty when ``existed=True`` or when Google's payload had
    nothing new to contribute). The admin UI uses it to compose a specific
    success message like "Backfilled: city, country_code".
    """

    model_config = ConfigDict(from_attributes=False)

    place: PlaceAdminRead
    existed: bool
    fields_updated: list[str] = Field(default_factory=list)


class PlaceExternalIdAdminRead(BaseModel):
    """One ``place_external_ids`` row, admin-facing.

    Returned from ``GET /admin/places/{id}/external-ids``. Deliberately
    omits ``raw_data`` — the Google payload is large, and the listing UI
    only needs enough to render a row with last-synced context + an
    unlink/resync action. Admins that need the raw JSON can hit the
    resync endpoint (which refreshes and could return it separately in
    the future) or inspect via the DB.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    provider: ExternalIdProvider
    external_id: str
    last_synced_at: datetime | None = None
    created_at: datetime | None = None


class PlaceUnlinkExternalRequest(BaseModel):
    """Optional justification attached to unlinking a provider.

    Same shape + limits as ``PlaceDeleteRequest`` / ``PlaceRestoreRequest``
    so the admin UI's "why are you unlinking this?" dialog has consistent
    validation. Reason is logged on the EDITED event row that records the
    unlink, so the event history shows *why* a provider link went away.
    """

    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(
        default=None,
        min_length=3,
        max_length=500,
        description=(
            "Free-form justification surfaced in the place's event history."
        ),
    )


class PlaceResyncResponse(BaseModel):
    """Result of ``POST /admin/places/{id}/resync``.

    Mirrors the link response on ``fields_updated`` so the UI can reuse
    the same "Backfilled: city, country_code" toast logic. No ``existed``
    flag — resync is always a refresh against an existing link, never a
    creation, so the flag would have no meaning.
    """

    model_config = ConfigDict(from_attributes=False)

    place: PlaceAdminRead
    fields_updated: list[str] = Field(default_factory=list)


class PlaceOwnerRevokeRequest(BaseModel):
    """Optional justification attached to revoking a place owner.

    Same 3–500 validation as the delete/restore/unlink-external bodies —
    we deliberately kept these windows aligned so admins don't have to
    re-learn the field rules for each destructive action.

    The reason is logged on the EDITED PlaceEvent row that records the
    revocation so the audit trail explains *why* an ownership
    relationship ended, not just *when*.
    """

    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(
        default=None,
        min_length=3,
        max_length=500,
        description=(
            "Free-form justification surfaced in the place's event history."
        ),
    )


class PlaceAdminPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=500)

    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)

    # Only include if your Place model actually has this column # TODO
    # google_place_id: str | None = Field(default=None, min_length=1, max_length=255)


class PlaceDeleteRequest(BaseModel):
    """Optional justification attached to a soft-delete.

    The admin panel's Delete dialog collects a reason and passes it here.
    Stored on the PlaceEvent audit row so the event history page makes
    clear *why* something was removed, not just *when*.

    Optional on the API so existing scripts, Bruno requests, and tests
    that DELETE without a body keep working. The admin UI enforces a
    non-empty reason at the form layer.
    """

    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(
        default=None,
        min_length=3,
        max_length=500,
        description=(
            "Free-form justification surfaced in the place's event history."
            " Keep it under 500 chars; the UI collects a one-liner."
        ),
    )


class PlaceRestoreRequest(BaseModel):
    """Optional justification attached to a restore action.

    Mirrors PlaceDeleteRequest — the admin UI nudges the operator to
    explain *why* they're bringing a place back, which is usually more
    interesting than the why of a delete (recovered from a bad bulk
    action, appeals decision, etc.). Kept optional at the API for the
    same backward-compat reasons.
    """

    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(
        default=None,
        min_length=3,
        max_length=500,
        description=(
            "Free-form justification surfaced in the place's event history."
            " Keep it under 500 chars; the UI collects a one-liner."
        ),
    )


class PlaceDelistRequest(BaseModel):
    """De-list a place for cause — leaves a public tombstone.

    Distinct from soft-delete: a ``reason`` is *required* (it drives the
    consumer-facing tombstone copy), and an optional free-text ``note`` adds
    specifics. Reversible via the re-list endpoint.
    """

    model_config = ConfigDict(extra="forbid")

    reason: DelistReason = Field(
        ...,
        description=(
            "Why the place is being removed. Drives the public tombstone "
            "message (e.g. NOT_HALAL renders 'verified not to serve halal "
            "food')."
        ),
    )
    note: str | None = Field(
        default=None,
        max_length=1000,
        description="Optional specifics, surfaced on the place event history.",
    )


class PlaceRelistRequest(BaseModel):
    """Reverse a de-list. Optional note flows into the RELISTED event."""

    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=1000)


class PlaceEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    event_type: str
    message: str | None
    actor_user_id: UUID | None
    created_at: datetime


class OrganizationSummaryAdmin(BaseModel):
    """Compact org view nested inside a place-owner row.

    Carries just enough for the admin place-detail page to identify
    and contact the owning org without a second fetch. ``member_count``
    is the number of rows in ``organization_members`` with
    ``status='ACTIVE'`` — a signal of whether anyone can actually
    respond if the admin reaches out.
    """

    model_config = ConfigDict(from_attributes=False)

    id: UUID
    name: str
    contact_email: str | None = None
    member_count: int = 0


class PlaceOwnerAdminRead(BaseModel):
    """One ``place_owners`` link row, admin-facing.

    Returned from ``GET /admin/places/{id}/owners``. The admin UI renders
    one of these per row on the place detail page, ordered ACTIVE first
    so the "who's actually managing this place today" answer is at the top.
    """

    model_config = ConfigDict(from_attributes=False)

    # PlaceOwner row id — separate from the org id so future admin actions
    # (e.g. "unlink this owner") can target the join row, not the org.
    id: UUID
    organization: OrganizationSummaryAdmin
    role: str
    status: str
    created_at: datetime