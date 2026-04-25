from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from geoalchemy2.elements import WKTElement
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.admin.places.schemas import PlaceAdminPatch
from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.places.enums import ExternalIdProvider, PlaceEventType
from app.modules.places.models import Place, PlaceEvent, PlaceExternalId
from app.modules.places.repo import get_place, log_place_event


# Allowed ``order_by`` values for ``admin_list_places``. Kept as a
# module-level constant so both the repo and the router's Query() alias
# share the same source of truth. Adding a new sort = one line here +
# one mapping below.
#
# ``created_at`` is intentionally absent: the CREATED audit row on
# ``place_events`` records ingest time, so the column was never added to
# ``places``. Default sort is ``updated_at`` DESC — "most-recently
# touched first," which matches what an admin actually wants in a browse.
_ORDER_BY_VALUES = ("updated_at", "name", "city", "country")


def admin_list_places(
    db: Session,
    *,
    deleted: str = "false",  # "true" | "false" | "all"
    q: str | None = None,
    city: str | None = None,
    country: str | None = None,
    order_by: str = "updated_at",
    limit: int = 50,
    offset: int = 0,
) -> list[Place]:
    """List places for the admin browse.

    Filters
    -------
    * ``deleted``  — "false" (default), "true", or "all" — include-deleted flag.
    * ``q``        — ILIKE substring on name + address (case-insensitive).
    * ``city``     — ILIKE substring on Place.city (case-insensitive). Rows
                     with NULL city are excluded when this is set.
    * ``country``  — exact match on Place.country_code. The CHECK constraint
                     keeps values ISO-2, so we uppercase the input to avoid
                     a lowercase "us" silently matching nothing.

    Sort
    ----
    ``order_by`` accepts one of ``updated_at`` (default, DESC —
    most-recently edited first), ``name`` (ASC), ``city`` (ASC, NULLS
    LAST), ``country`` (ASC, NULLS LAST). NULLS LAST on city/country
    keeps unpopulated rows from cluttering the top when an admin sorts
    by location.

    Invalid ``order_by`` falls back to ``updated_at`` rather than
    erroring — the router validates the enum up-front, but we stay
    defensive in case the repo is called from a non-HTTP caller (seed
    scripts, etc.).
    """
    stmt = select(Place)

    include_deleted = deleted in ("true", "all")
    if not include_deleted:
        stmt = stmt.where(Place.is_deleted.is_(False))

    # Text search: ILIKE on name + address. Case-insensitive substring match
    # is enough for an admin browse; we don't need trigram/full-text yet.
    if q:
        needle = f"%{q.strip()}%"
        if needle != "%%":
            stmt = stmt.where(
                or_(
                    Place.name.ilike(needle),
                    Place.address.ilike(needle),
                )
            )

    if city:
        city_needle = f"%{city.strip()}%"
        if city_needle != "%%":
            stmt = stmt.where(Place.city.ilike(city_needle))

    if country:
        # country_code is stored uppercase (ISO-2 CHECK constraint); normalize
        # the input so "us" or "Us" matches "US" rows.
        stmt = stmt.where(Place.country_code == country.strip().upper())

    # Apply ordering. ``updated_at`` is the default (most-recently-touched
    # first) and is a real column backed by an index — see the b4f1c8e2a7d5
    # migration. Unknown values fall back to the default instead of erroring
    # so non-HTTP callers (seed scripts, etc.) can't accidentally 500.
    if order_by == "name":
        stmt = stmt.order_by(Place.name.asc())
    elif order_by == "city":
        stmt = stmt.order_by(Place.city.asc().nulls_last(), Place.name.asc())
    elif order_by == "country":
        stmt = stmt.order_by(
            Place.country_code.asc().nulls_last(), Place.name.asc()
        )
    else:
        stmt = stmt.order_by(Place.updated_at.desc())

    stmt = stmt.limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def admin_list_place_countries(db: Session) -> list[str]:
    """Return every distinct ISO-2 country code in the catalog.

    Feeds the admin filter dropdown so it reflects the actual data, not a
    hardcoded list of countries we happen to have at design time. Result
    is sorted alphabetically and excludes NULL (places without a country
    code don't belong in a filter-by-country control).

    Soft-deleted places are included — an admin filtering to "show deleted
    places in the UK" needs GB to appear in the dropdown even if every
    GB row is currently soft-deleted.
    """
    stmt = (
        select(Place.country_code)
        .where(Place.country_code.is_not(None))
        .distinct()
        .order_by(Place.country_code.asc())
    )
    return [code for code, in db.execute(stmt).all()]


def admin_list_place_events(
    db: Session,
    *,
    place_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> list[PlaceEvent]:
    # Ensure place exists (admin can view even if deleted)
    place = get_place(db, place_id, include_deleted=True)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    stmt = (
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place_id)
        .order_by(PlaceEvent.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.execute(stmt).scalars().all())


def admin_get_place_by_id(db: Session, *, place_id: UUID) -> Place:
    place = get_place(db, place_id, include_deleted=True)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")
    return place


def admin_list_place_owners(db: Session, *, place_id: UUID) -> list[dict]:
    """Return organization ownership links for a place.

    Shape: each row carries the PlaceOwner link's own metadata (role, status,
    created_at) plus an embedded ``organization`` dict with id/name/contact_email
    and the org's active-member count.

    One query, no N+1: the active-member count is an aggregated subquery
    joined once. The result is ordered with ACTIVE links first so the admin
    UI surfaces "who's running this today" before historical / pending links.

    Raises NotFoundError if the place doesn't exist (admin can see deleted
    places, so we check with include_deleted=True).
    """
    place = get_place(db, place_id, include_deleted=True)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    # Per-org active member tally. Using COUNT over a filtered subquery
    # keeps this a single trip to Postgres. OUTER JOIN later so orgs with
    # zero active members still show up with count=0.
    member_count_subq = (
        select(
            OrganizationMember.organization_id.label("organization_id"),
            func.count(OrganizationMember.id).label("member_count"),
        )
        .where(OrganizationMember.status == "ACTIVE")
        .group_by(OrganizationMember.organization_id)
        .subquery()
    )

    # Sort key: ACTIVE=0, everything else=1. Puts live relationships at
    # the top of the list; within a status group we fall back to newest
    # first so "most recently added" wins ties.
    active_first = case((PlaceOwner.status == "ACTIVE", 0), else_=1)

    stmt = (
        select(
            PlaceOwner,
            Organization,
            func.coalesce(member_count_subq.c.member_count, 0).label("member_count"),
        )
        .join(Organization, Organization.id == PlaceOwner.organization_id)
        .outerjoin(
            member_count_subq,
            member_count_subq.c.organization_id == Organization.id,
        )
        .where(PlaceOwner.place_id == place_id)
        .order_by(active_first, PlaceOwner.created_at.desc())
    )

    rows = db.execute(stmt).all()
    return [
        {
            "id": po.id,
            "role": po.role,
            "status": po.status,
            "created_at": po.created_at,
            "organization": {
                "id": org.id,
                "name": org.name,
                "contact_email": org.contact_email,
                "member_count": int(member_count),
            },
        }
        for po, org, member_count in rows
    ]


def admin_patch_place(
    db: Session,
    *,
    place_id: UUID,
    patch: PlaceAdminPatch,
    actor_user_id: UUID | None = None,
) -> Place:
    place = get_place(db, place_id, include_deleted=True)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    data = patch.model_dump(exclude_unset=True)  # only fields provided by client
    changed_fields: list[str] = []

    # Handle coords as a special case
    lat = data.pop("lat", None)
    lng = data.pop("lng", None)

    if (lat is None) ^ (lng is None):
        raise ConflictError("COORDS_BOTH_REQUIRED", "Both lat and lng must be provided together")

    # Generic field updates (schema already forbids unknown fields)
    for field, new_value in data.items():
        old_value = getattr(place, field)
        if new_value != old_value:
            setattr(place, field, new_value)
            changed_fields.append(field)

    # Coordinate update
    if lat is not None and lng is not None:
        if lat != place.lat or lng != place.lng:
            place.lat = lat
            place.lng = lng
            place.geom = WKTElement(f"POINT({lng} {lat})", srid=4326)
            changed_fields.extend(["lat", "lng", "geom"])

    if not changed_fields:
        raise ConflictError("NO_FIELDS", "No changes detected")

    # Log audit in the same transaction as the update
    log_place_event(
        db,
        place_id=place_id,
        event_type=PlaceEventType.EDITED,
        actor_user_id=actor_user_id,
        message=f"Admin edited fields: {', '.join(changed_fields)}",
    )

    db.add(place)
    db.commit()
    db.refresh(place)
    return place


def admin_soft_delete_place(
    db: Session,
    *,
    place_id: UUID,
    actor_user_id: UUID | None = None,
    reason: str | None = None,
) -> None:
    place: Place | None = get_place(db, place_id, include_deleted=True)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    # Idempotent: deleting an already-deleted place should be a no-op
    if place.is_deleted:
        return

    place.is_deleted = True
    place.deleted_at = datetime.now(timezone.utc)
    if actor_user_id is not None and hasattr(place, "deleted_by_user_id"):
        place.deleted_by_user_id = actor_user_id

    # Compose an event message that surfaces the reason when provided. The
    # event history UI just renders `message` verbatim, so embedding the
    # reason here is enough — no extra column or join needed for the
    # "why was this deleted?" question to have an answer on-page.
    trimmed_reason = reason.strip() if isinstance(reason, str) else None
    event_message = "Admin soft-deleted place"
    if trimmed_reason:
        event_message = f"{event_message}. Reason: {trimmed_reason}"

    log_place_event(
        db,
        place_id=place_id,
        event_type=PlaceEventType.DELETED,
        actor_user_id=actor_user_id,
        message=event_message,
    )

    db.add(place)
    db.commit()


def admin_restore_place(
    db: Session,
    *,
    place_id: UUID,
    actor_user_id: UUID | None = None,
    reason: str | None = None,
) -> None:
    place = get_place(db, place_id, include_deleted=True)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    # Idempotent: restoring an already-active place is a no-op. No new
    # event logged, regardless of reason — the "restore of a live place"
    # is a no-op by design, so a fake audit row would mislead.
    if place.is_deleted is False:
        return

    place.is_deleted = False
    place.deleted_at = None

    if hasattr(place, "deleted_by_user_id"):
        place.deleted_by_user_id = None

    # Mirror the delete-reason composition: embed when present, plain
    # message otherwise. Keeps the event history's "why" answer on-page
    # without a second lookup or a join.
    trimmed_reason = reason.strip() if isinstance(reason, str) else None
    event_message = "Admin restored place"
    if trimmed_reason:
        event_message = f"{event_message}. Reason: {trimmed_reason}"

    log_place_event(
        db,
        place_id=place_id,
        event_type=PlaceEventType.RESTORED,
        actor_user_id=actor_user_id,
        message=event_message,
    )

    db.add(place)
    db.commit()


# ---------------------------------------------------------------------------
# Provider links (PlaceExternalId)
# ---------------------------------------------------------------------------
def admin_list_place_external_ids(
    db: Session, *, place_id: UUID
) -> list[PlaceExternalId]:
    """Return every ``place_external_ids`` row for a place.

    Admin uses this to see what external providers are linked and to pick
    a row to unlink or resync. Works on soft-deleted places too — an
    admin triaging a restore may want to see the provider context before
    making a call.

    ``raw_data`` is still loaded with the row (it's a single column on
    the table) but the caller's response schema deliberately omits it so
    callers don't accidentally ship 20KB Google payloads to the UI.
    """
    place = get_place(db, place_id, include_deleted=True)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    stmt = (
        select(PlaceExternalId)
        .where(PlaceExternalId.place_id == place_id)
        # created_at on PlaceExternalId is a plain timestamp; order oldest
        # first so the "original" link surfaces at the top of the listing
        # if a place ever accumulates multiples (not supported today).
        .order_by(PlaceExternalId.created_at.asc())
    )
    return list(db.execute(stmt).scalars().all())


def admin_unlink_place_external(
    db: Session,
    *,
    place_id: UUID,
    provider: ExternalIdProvider,
    actor_user_id: UUID | None = None,
    reason: str | None = None,
) -> None:
    """Remove the provider link for a place.

    Steps:
      1. Ensure the place exists (404 otherwise).
      2. Find the PlaceExternalId row for (place_id, provider) — 404 if
         there's no link to remove.
      3. Capture the external_id on the row for the audit message before
         deleting it (so the history says "was ChIJxxx" not "was None").
      4. Delete the PlaceExternalId row. Canonical backfilled fields on
         the Place stay — they're still valid data points, just not
         provider-backed anymore. Admins who explicitly want to wipe
         them can edit via the patch endpoint.
      5. If ``place.canonical_source`` pointed at the unlinked provider,
         clear it. This is the signal the admin UI uses to re-show the
         "Link to Google" button.
      6. Log an EDITED event recording the unlink + reason (if any).

    No unique/composite key lookup beyond (place_id, provider) — the
    link endpoint guarantees at most one link per provider per place,
    so a single row comes back.
    """
    place = get_place(db, place_id, include_deleted=True)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    link = db.execute(
        select(PlaceExternalId)
        .where(PlaceExternalId.place_id == place_id)
        .where(PlaceExternalId.provider == provider)
    ).scalar_one_or_none()
    if link is None:
        raise NotFoundError(
            "EXTERNAL_ID_NOT_FOUND",
            f"Place has no {provider.value} link to unlink",
        )

    removed_external_id = link.external_id
    db.delete(link)

    # Only clear canonical_source when it points at the provider we're
    # unlinking. If it points somewhere else (a hypothetical future case
    # with multiple providers), leave it alone — we're not the authority
    # over *that* provider's relationship to the place.
    if place.canonical_source == provider:
        place.canonical_source = None
        db.add(place)

    trimmed_reason = reason.strip() if isinstance(reason, str) else None
    suffix = f". Reason: {trimmed_reason}" if trimmed_reason else ""
    log_place_event(
        db,
        place_id=place_id,
        event_type=PlaceEventType.EDITED,
        actor_user_id=actor_user_id,
        message=(
            f"Unlinked {provider.value} provider (was {removed_external_id})"
            + suffix
        ),
    )

    db.commit()


def admin_revoke_place_owner(
    db: Session,
    *,
    place_id: UUID,
    owner_id: UUID,
    actor_user_id: UUID | None = None,
    reason: str | None = None,
) -> None:
    """Revoke an ownership relationship by flipping its status to REVOKED.

    Soft-unlink rather than hard delete: the historical PlaceOwner row
    survives so the event history and future admin browses can see
    "Acme Inc used to own this place." The schema's
    ``uq_place_owners_one_active_owner`` partial unique index
    specifically excludes REVOKED, so this operation also frees up the
    place to be linked to a new live owner afterward.

    Steps:
      1. Ensure the place exists (admin can revoke on soft-deleted
         places too, since ownership context matters during restore
         triage).
      2. Find the PlaceOwner by (owner_id, place_id). Requiring BOTH
         prevents an admin from accidentally revoking an ownership row
         that belongs to a different place by typo'ing the URL.
      3. Idempotent: if the row is already REVOKED, return without
         logging a new event — a double-click on the Revoke button
         shouldn't stack audit noise.
      4. Flip status to REVOKED. The org row + relationship row both
         stay so the history tells the audit story.
      5. Log an EDITED event with the org name + role + reason.
    """
    place = get_place(db, place_id, include_deleted=True)
    if not place:
        raise NotFoundError("PLACE_NOT_FOUND", "Place not found")

    # Join on Organization so the audit message names the org (and not
    # just its id) without a second round-trip.
    row = db.execute(
        select(PlaceOwner, Organization)
        .join(Organization, Organization.id == PlaceOwner.organization_id)
        .where(PlaceOwner.id == owner_id)
        .where(PlaceOwner.place_id == place_id)
    ).one_or_none()
    if row is None:
        raise NotFoundError(
            "OWNERSHIP_NOT_FOUND",
            "No ownership link with this id on this place",
        )

    owner, org = row

    # Idempotent no-op: already-revoked rows don't stack events. Mirrors
    # the admin_soft_delete_place / admin_restore_place idempotency.
    if owner.status == "REVOKED":
        return

    previous_status = owner.status
    previous_role = owner.role
    owner.status = "REVOKED"
    db.add(owner)

    trimmed_reason = reason.strip() if isinstance(reason, str) else None
    suffix = f". Reason: {trimmed_reason}" if trimmed_reason else ""
    log_place_event(
        db,
        place_id=place_id,
        event_type=PlaceEventType.EDITED,
        actor_user_id=actor_user_id,
        message=(
            f"Revoked {org.name}'s ownership"
            f" (role={previous_role}, was {previous_status})"
            + suffix
        ),
    )

    db.commit()