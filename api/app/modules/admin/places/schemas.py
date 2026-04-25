from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from app.modules.places.enums import ExternalIdProvider


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