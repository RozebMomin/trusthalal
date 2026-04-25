"""Provider-agnostic Place ingest orchestration.

This module composes the pure Google extractor in ``integrations/google.py``
with a fetcher (HTTP call or injected fixture), and writes the result into
the database in one transaction.

Ingest is the single entry point shared by:

  * ``POST /admin/places/ingest`` — admin clicks "Add place" in the UI
  * ``scripts/seed_dev.py``       — batch seed script (TBD)
  * ``POST /admin/places/{id}/resync`` — future "refresh from Google" action

Idempotency
-----------
Ingest is idempotent on the ``(GOOGLE, google_place_id)`` pair:

  * If no row exists in ``place_external_ids`` → create a new Place +
    external id + raw_data snapshot + CREATED event.
  * If a row exists and points to a live Place → update the raw_data snapshot
    and ``last_synced_at``, return the existing Place with ``existed=True``.
  * If a row exists and points to a soft-deleted Place → update the snapshot
    and return ``existed=True, was_deleted=True``; the caller (admin UI)
    decides whether to restore.

No mutation of canonical fields on re-ingest yet — we assume the first ingest
is the source of truth and admin edits are respected. Re-sync that actually
overwrites canonical data is a follow-up feature (``resync=True`` flag).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from geoalchemy2.elements import WKTElement
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError
from app.modules.places.enums import ExternalIdProvider, PlaceEventType
from app.modules.places.integrations.google import (
    CanonicalPlaceFields,
    extract_from_google_place,
)
from app.modules.places.integrations.google_client import (
    PlaceDetailsFetcher,
    fetch_place_details_google,
)
from app.modules.places.models import Place, PlaceEvent, PlaceExternalId


@dataclass(frozen=True, slots=True)
class IngestResult:
    place: Place
    existed: bool
    was_deleted: bool


def ingest_google_place(
    db: Session,
    *,
    google_place_id: str,
    actor_user_id: UUID | None = None,
    fetcher: PlaceDetailsFetcher | None = None,
) -> IngestResult:
    """Create-or-return a Place for the given Google Place ID.

    Parameters
    ----------
    db : SQLAlchemy session
    google_place_id : str
        Google's opaque Place ID (``ChIJ...``). Trimmed but otherwise opaque
        to us — Google owns the format.
    actor_user_id : UUID | None
        The admin performing the ingest, recorded on the CREATED event.
    fetcher : PlaceDetailsFetcher | None
        Override for tests / alternate clients. Defaults to the real
        ``fetch_place_details_google``.
    """
    normalized_id = (google_place_id or "").strip()
    if not normalized_id:
        raise BadRequestError(
            "GOOGLE_PLACE_ID_REQUIRED", "google_place_id must not be empty"
        )

    # ------------------------------------------------------------------
    # 1. Idempotent short-circuit: is this Google ID already in the catalog?
    # ------------------------------------------------------------------
    existing = (
        db.execute(
            select(PlaceExternalId)
            .where(PlaceExternalId.provider == ExternalIdProvider.GOOGLE)
            .where(PlaceExternalId.external_id == normalized_id)
        )
        .scalar_one_or_none()
    )
    if existing is not None:
        place = db.execute(
            select(Place).where(Place.id == existing.place_id)
        ).scalar_one()
        # Refresh the snapshot; cheap and useful for debugging drift.
        effective_fetcher = fetcher or fetch_place_details_google
        try:
            payload = effective_fetcher(normalized_id)
            existing.raw_data = payload
            existing.last_synced_at = datetime.now(timezone.utc)
            db.add(existing)
            db.commit()
            db.refresh(place)
        except Exception:
            # Snapshot refresh is best-effort; the primary contract is
            # "return the existing place". Swallow and continue.
            db.rollback()
        return IngestResult(
            place=place, existed=True, was_deleted=bool(place.is_deleted)
        )

    # ------------------------------------------------------------------
    # 2. New ingest: fetch → extract → create
    # ------------------------------------------------------------------
    effective_fetcher = fetcher or fetch_place_details_google
    payload = effective_fetcher(normalized_id)

    fields = extract_from_google_place(payload)
    _require_core_fields(fields)

    now = datetime.now(timezone.utc)
    place = Place(
        name=fields.name,
        address=fields.address,
        city=fields.city,
        region=fields.region,
        country_code=fields.country_code,
        postal_code=fields.postal_code,
        timezone=fields.timezone,
        canonical_source=ExternalIdProvider.GOOGLE,
        lat=fields.lat,
        lng=fields.lng,
        geom=WKTElement(f"POINT({fields.lng} {fields.lat})", srid=4326),
    )
    db.add(place)
    db.flush()  # need place.id for the external row + event

    db.add(
        PlaceExternalId(
            place_id=place.id,
            provider=ExternalIdProvider.GOOGLE,
            external_id=normalized_id,
            raw_data=payload,
            last_synced_at=now,
        )
    )

    db.add(
        PlaceEvent(
            place_id=place.id,
            event_type=PlaceEventType.CREATED.value,
            actor_user_id=actor_user_id,
            message=f"Created via Google ingest (place_id={normalized_id})",
        )
    )

    db.commit()
    db.refresh(place)

    return IngestResult(place=place, existed=False, was_deleted=False)


def _require_core_fields(fields: CanonicalPlaceFields) -> None:
    """Reject payloads that don't carry the minimum we need to create a Place.

    Google's API can return unexpectedly sparse results in rare cases (e.g.
    a place_id that's been superseded or expired). Fail loudly rather than
    inserting a half-baked row.
    """
    missing: list[str] = []
    if not fields.name:
        missing.append("name")
    if fields.lat is None:
        missing.append("lat")
    if fields.lng is None:
        missing.append("lng")
    if missing:
        raise BadRequestError(
            "GOOGLE_PAYLOAD_INCOMPLETE",
            f"Google Place payload missing required fields: {', '.join(missing)}",
        )


# ---------------------------------------------------------------------------
# Retroactive linking: attach a Google place_id to an EXISTING manually-added
# Place. Separate code path from ``ingest_google_place`` because the intent
# is different: "bind these two entities and fill in the blanks" vs.
# "create a new Place from Google data".
# ---------------------------------------------------------------------------

# Columns on ``Place`` we're willing to auto-backfill from Google when the
# admin links an existing row. lat/lng/name/address are deliberately excluded
# — those are the identity of the Place and were set by the admin for a
# reason; overwriting them on a "link" action would violate least-surprise.
_BACKFILLABLE_CANONICAL_FIELDS: tuple[str, ...] = (
    "city",
    "region",
    "country_code",
    "postal_code",
    "timezone",
)


@dataclass(frozen=True, slots=True)
class LinkExternalResult:
    """What ``link_google_place_to_existing`` hands back to the router.

    ``existed`` tells the UI whether this was a no-op (the exact same link
    already existed and we just returned the place as-is). ``fields_updated``
    lists the canonical columns that were populated during this call so the
    success toast can say "Backfilled city, country_code" instead of just
    "Linked."
    """

    place: Place
    existed: bool
    fields_updated: list[str]


def link_google_place_to_existing(
    db: Session,
    *,
    place_id: UUID,
    google_place_id: str,
    actor_user_id: UUID | None = None,
    fetcher: PlaceDetailsFetcher | None = None,
) -> LinkExternalResult:
    """Attach a Google Place ID to an already-existing Place.

    Used for places that were created manually before Google ingest existed
    (or via any other path that didn't set up the provider link). Contract:

      * Place must exist (admin can link deleted places too — seeing the
        Google context may be what helps an admin decide whether to restore).
      * If this ``google_place_id`` is already linked to the SAME Place,
        the call is an idempotent no-op (``existed=True``, empty
        ``fields_updated``). Lets the UI double-click without blowing up.
      * If it's linked to a DIFFERENT Place → 409 GOOGLE_PLACE_ALREADY_LINKED.
        The admin is probably trying to create a duplicate by accident;
        surface it loudly.
      * If the Place already has a DIFFERENT Google link →
        409 PLACE_ALREADY_HAS_GOOGLE_LINK. No unlink endpoint yet, so we
        don't silently overwrite — that'd erase the existing provenance.
      * Otherwise: fetch Google, write a new PlaceExternalId, backfill ONLY
        the canonical fields that are currently NULL, log an EDITED event
        with the link details.

    lat/lng/name/address are never touched by this function — those are the
    admin's own inputs and must be edited explicitly via the patch endpoint.
    """
    normalized_id = (google_place_id or "").strip()
    if not normalized_id:
        raise BadRequestError(
            "GOOGLE_PLACE_ID_REQUIRED", "google_place_id must not be empty"
        )

    # 1. Place must exist (include soft-deleted — see docstring)
    place = db.execute(
        select(Place).where(Place.id == place_id)
    ).scalar_one_or_none()
    if place is None:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    # 2. Is this google_place_id already linked to some Place?
    existing_by_gid = db.execute(
        select(PlaceExternalId)
        .where(PlaceExternalId.provider == ExternalIdProvider.GOOGLE)
        .where(PlaceExternalId.external_id == normalized_id)
    ).scalar_one_or_none()
    if existing_by_gid is not None:
        if existing_by_gid.place_id == place.id:
            # Same link, no-op. Don't refresh raw_data here — that's the
            # job of a (future) /resync endpoint; conflating it with link
            # would make the semantics fuzzy.
            return LinkExternalResult(place=place, existed=True, fields_updated=[])
        raise ConflictError(
            "GOOGLE_PLACE_ALREADY_LINKED",
            (
                f"Google Place {normalized_id!r} is already linked to a"
                f" different Place ({existing_by_gid.place_id})."
            ),
        )

    # 3. Does this Place already have *any* Google link (a different one)?
    existing_by_place = db.execute(
        select(PlaceExternalId)
        .where(PlaceExternalId.place_id == place.id)
        .where(PlaceExternalId.provider == ExternalIdProvider.GOOGLE)
    ).scalar_one_or_none()
    if existing_by_place is not None:
        raise ConflictError(
            "PLACE_ALREADY_HAS_GOOGLE_LINK",
            (
                f"Place is already linked to Google id"
                f" {existing_by_place.external_id!r}. Unlink first before"
                " linking to a different Google Place."
            ),
        )

    # 4. Fetch + extract
    effective_fetcher = fetcher or fetch_place_details_google
    payload = effective_fetcher(normalized_id)
    fields = extract_from_google_place(payload)

    # 5. Write the link + backfill the place
    now = datetime.now(timezone.utc)
    db.add(
        PlaceExternalId(
            place_id=place.id,
            provider=ExternalIdProvider.GOOGLE,
            external_id=normalized_id,
            raw_data=payload,
            last_synced_at=now,
        )
    )

    fields_updated: list[str] = []
    for column in _BACKFILLABLE_CANONICAL_FIELDS:
        current = getattr(place, column)
        if current is None:
            incoming = getattr(fields, column)
            if incoming is not None:
                setattr(place, column, incoming)
                fields_updated.append(column)

    # canonical_source only gets stamped when it's currently unset. Same
    # "don't clobber" principle: if a previous admin marked this as (say)
    # YELP, linking to Google shouldn't silently change the source of
    # truth for non-provider-backed fields.
    if place.canonical_source is None:
        place.canonical_source = ExternalIdProvider.GOOGLE
        fields_updated.append("canonical_source")

    # 6. Audit row. EDITED keeps us from needing a migration for a new
    # enum value; the message text carries the specifics (place_id + which
    # canonical fields got populated).
    suffix = (
        f" Backfilled: {', '.join(fields_updated)}."
        if fields_updated
        else " No canonical fields needed backfill."
    )
    db.add(
        PlaceEvent(
            place_id=place.id,
            event_type=PlaceEventType.EDITED.value,
            actor_user_id=actor_user_id,
            message=f"Linked to Google Place {normalized_id}.{suffix}",
        )
    )

    db.add(place)
    db.commit()
    db.refresh(place)

    return LinkExternalResult(
        place=place, existed=False, fields_updated=fields_updated
    )


# ---------------------------------------------------------------------------
# Resync: refresh the Google snapshot on an already-linked Place
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class ResyncResult:
    """Payload returned from ``resync_google_place``.

    ``fields_updated`` is the same concept as ``LinkExternalResult`` —
    names the canonical columns that were populated during this call so
    the UI can render a specific toast instead of a vague "Synced."
    Empty when nothing was null to begin with (or when Google had
    nothing new to contribute).
    """

    place: Place
    fields_updated: list[str]


def resync_google_place(
    db: Session,
    *,
    place_id: UUID,
    actor_user_id: UUID | None = None,
    fetcher: PlaceDetailsFetcher | None = None,
) -> ResyncResult:
    """Refresh the Google snapshot + backfill null canonical fields.

    Contract:
      * Place must exist (include soft-deleted — an admin triaging a
        restore may want a fresh snapshot before deciding).
      * Place must have a Google ``PlaceExternalId`` link. No link →
        409 ``NO_GOOGLE_LINK``. (Admins wanting to establish a new link
        should use ``/link-external``, not ``/resync`` — different
        intent, different endpoint.)
      * Fetch Google Place Details, update ``raw_data`` + ``last_synced_at``.
      * Backfill only the canonical columns that are currently NULL
        (same "never clobber admin edits" rule as link). Overwrite-mode
        resync is a future feature; today's behavior is strictly
        additive.
      * Log an EDITED event noting which columns got populated (or
        "No canonical fields needed backfill." if everything was
        already filled).
    """
    # 1. Ensure place
    place = db.execute(
        select(Place).where(Place.id == place_id)
    ).scalar_one_or_none()
    if place is None:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    # 2. Ensure Google link
    link = db.execute(
        select(PlaceExternalId)
        .where(PlaceExternalId.place_id == place_id)
        .where(PlaceExternalId.provider == ExternalIdProvider.GOOGLE)
    ).scalar_one_or_none()
    if link is None:
        raise ConflictError(
            "NO_GOOGLE_LINK",
            "Place has no Google link to resync. Use /link-external first.",
        )

    # 3. Fetch fresh payload
    effective_fetcher = fetcher or fetch_place_details_google
    payload = effective_fetcher(link.external_id)
    fields = extract_from_google_place(payload)

    # 4. Update snapshot
    now = datetime.now(timezone.utc)
    link.raw_data = payload
    link.last_synced_at = now
    db.add(link)

    # 5. Backfill null canonical columns only. Same whitelist as link;
    # identity columns (lat/lng/name/address) are intentionally excluded.
    fields_updated: list[str] = []
    for column in ("city", "region", "country_code", "postal_code", "timezone"):
        current = getattr(place, column)
        if current is None:
            incoming = getattr(fields, column)
            if incoming is not None:
                setattr(place, column, incoming)
                fields_updated.append(column)

    if place.canonical_source is None:
        place.canonical_source = ExternalIdProvider.GOOGLE
        fields_updated.append("canonical_source")

    # 6. Audit event. Message is explicit about what happened so the
    # event history distinguishes resync-that-backfilled from
    # resync-that-was-a-pure-refresh.
    suffix = (
        f" Backfilled: {', '.join(fields_updated)}."
        if fields_updated
        else " No canonical fields needed backfill."
    )
    db.add(
        PlaceEvent(
            place_id=place.id,
            event_type=PlaceEventType.EDITED.value,
            actor_user_id=actor_user_id,
            message=f"Resynced Google snapshot ({link.external_id}).{suffix}",
        )
    )

    if fields_updated:
        db.add(place)

    db.commit()
    db.refresh(place)

    return ResyncResult(place=place, fields_updated=fields_updated)
