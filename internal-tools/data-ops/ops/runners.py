"""Job runners — the actual data operations.

These run INSIDE the worker container and talk to the PRODUCTION database
via the API's own SQLAlchemy session (app.db.session.SessionLocal, whose
engine is built from DATABASE_URL=<prod>). We deliberately reuse the API's
ingestion code so behavior is identical to a real resync.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import UUID, uuid4

from sqlalchemy import exists, or_, select

# Registers EVERY model on Base.metadata in one place. Without this, only the
# Place models get imported and SQLAlchemy can't resolve cross-model foreign
# keys (e.g. places.deleted_by_user_id -> app.users) when it configures mappers
# for the write path. The read-only dry run never triggers that; a live resync
# does. Import for the side effect only.
import app.db.models  # noqa: F401
from app.core.storage import get_photos_storage_client
from app.db.session import SessionLocal
from app.modules.places.enums import PlacePhotoSource
from app.modules.places.ingest import resync_google_place
from app.modules.places.models import (
    ExternalIdProvider,
    Place,
    PlaceExternalId,
    PlacePhoto,
)
from app.modules.places.photos.processor import process_image
from app.modules.places.photos.storage_cleanup import (
    StorageOrphan,
    enqueue_orphans,
)

from ops import jobsdb
from ops.google_photos import fetch_place_hero_photo
from ops.settings import THROTTLE_SECONDS

# Columns that a Google resync is allowed to backfill (mirrors ingest.py).
BACKFILLABLE = {"phone", "city", "region", "country_code", "postal_code", "timezone"}


def _resolve_ids(db, field: str, limit: int | None) -> list[UUID]:
    """IDs of Google-linked places whose `field` is currently NULL."""
    col = getattr(Place, field)
    stmt = (
        select(Place.id)
        .join(PlaceExternalId, PlaceExternalId.place_id == Place.id)
        .where(PlaceExternalId.provider == ExternalIdProvider.GOOGLE)
        .where(col.is_(None))
        .order_by(Place.id)
    )
    if limit:
        stmt = stmt.limit(limit)
    return [row[0] for row in db.execute(stmt).all()]


def run_backfill_field(job_id: str, params: dict[str, Any]) -> dict:
    """Resync each Google-linked place missing `field`, backfilling from Google.

    params: { field?: str = "phone", limit?: int, dry_run?: bool = true,
              throttle_seconds?: float }
    """
    field = params.get("field", "phone")
    if field not in BACKFILLABLE:
        raise ValueError(f"field must be one of {sorted(BACKFILLABLE)}, got {field!r}")

    limit = params.get("limit")
    dry_run = bool(params.get("dry_run", True))
    throttle = float(params.get("throttle_seconds", THROTTLE_SECONDS))

    updated = 0
    unchanged = 0
    errors: list[dict] = []

    db = SessionLocal()
    try:
        ids = _resolve_ids(db, field, limit)
        jobsdb.set_total(job_id, len(ids))
        jobsdb.add_log(
            job_id,
            f"{'DRY RUN — ' if dry_run else ''}{len(ids)} place(s) missing '{field}' "
            f"(throttle {throttle}s).",
        )

        for pid in ids:
            try:
                if dry_run:
                    jobsdb.add_log(job_id, f"[dry-run] would resync {pid}")
                else:
                    result = resync_google_place(db, place_id=pid)
                    if field in result.fields_updated:
                        updated += 1
                        jobsdb.add_log(job_id, f"backfilled {field} for {pid}")
                    else:
                        unchanged += 1
                        jobsdb.add_log(
                            job_id,
                            f"resynced {pid} — {field} still empty "
                            f"(Google had no value)",
                        )
            except Exception as exc:  # per-record isolation
                db.rollback()
                errors.append({"place_id": str(pid), "error": str(exc)})
                jobsdb.add_log(job_id, f"ERROR {pid}: {exc}")
            finally:
                jobsdb.bump_done(job_id, 1)
                if throttle:
                    time.sleep(throttle)
    finally:
        db.close()

    return {
        "field": field,
        "dry_run": dry_run,
        "candidates": updated + unchanged + len(errors),
        "updated": updated,
        "unchanged": unchanged,
        "errors": errors,
    }


def count_backfill_candidates(field: str = "phone", limit: int | None = None) -> int:
    """How many places a backfill would touch — used by the /api/preview endpoint."""
    if field not in BACKFILLABLE:
        raise ValueError(f"field must be one of {sorted(BACKFILLABLE)}, got {field!r}")
    db = SessionLocal()
    try:
        return len(_resolve_ids(db, field, limit))
    finally:
        db.close()


def _google_link_id(db, place_id: UUID) -> str | None:
    return db.execute(
        select(PlaceExternalId.external_id)
        .where(PlaceExternalId.place_id == place_id)
        .where(PlaceExternalId.provider == ExternalIdProvider.GOOGLE)
    ).scalar_one_or_none()


def _places_without_photos(db, limit: int | None) -> list[UUID]:
    """Google-linked places that currently have NO active photos at all.

    Purely gap-filling: never touches a place where an owner/consumer already
    uploaded (so we can't clobber a curated hero).
    """
    has_photo = exists().where(
        (PlacePhoto.place_id == Place.id) & (PlacePhoto.deleted_at.is_(None))
    )
    stmt = (
        select(Place.id)
        .join(PlaceExternalId, PlaceExternalId.place_id == Place.id)
        .where(PlaceExternalId.provider == ExternalIdProvider.GOOGLE)
        .where(~has_photo)
        .order_by(Place.id)
    )
    if limit:
        stmt = stmt.limit(limit)
    return [row[0] for row in db.execute(stmt).all()]


def count_hero_candidates(limit: int | None = None) -> int:
    db = SessionLocal()
    try:
        return len(_places_without_photos(db, limit))
    finally:
        db.close()


def run_import_google_hero(job_id: str, params: dict[str, Any]) -> dict:
    """Fetch each photo-less place's headline Google photo and store it as hero.

    params: { limit?: int, dry_run?: bool = true, throttle_seconds?: float,
              max_px?: int = 1600 }

    Only targets Google-linked places with zero active photos. Uses the
    official Place Photos API, runs bytes through the app's image pipeline
    (EXIF strip + resize), uploads to the public place-photos bucket, and
    inserts a PlacePhoto row (source=GOOGLE, is_hero=true, caption=attribution).
    """
    limit = params.get("limit")
    dry_run = bool(params.get("dry_run", True))
    throttle = float(params.get("throttle_seconds", THROTTLE_SECONDS))
    max_px = int(params.get("max_px", 1600))

    imported = 0
    no_photo = 0
    errors: list[dict] = []

    storage = None if dry_run else get_photos_storage_client()

    db = SessionLocal()
    try:
        ids = _places_without_photos(db, limit)
        jobsdb.set_total(job_id, len(ids))
        jobsdb.add_log(
            job_id,
            f"{'DRY RUN — ' if dry_run else ''}{len(ids)} place(s) with no photos "
            f"(throttle {throttle}s).",
        )

        for pid in ids:
            try:
                google_id = _google_link_id(db, pid)
                if not google_id:
                    no_photo += 1
                    jobsdb.add_log(job_id, f"skip {pid}: no Google link")
                    continue

                if dry_run:
                    jobsdb.add_log(job_id, f"[dry-run] would import hero for {pid}")
                    continue

                gp = fetch_place_hero_photo(google_id, max_px=max_px)
                if gp is None:
                    no_photo += 1
                    jobsdb.add_log(job_id, f"{pid}: Google listing has no photos")
                    continue

                processed = process_image(gp.bytes_, source_content_type=gp.content_type)

                photo_id = uuid4()
                storage_path = f"{pid}/{photo_id}.{processed.extension}"
                storage.upload_bytes(
                    storage_path, processed.bytes_, content_type=processed.content_type
                )

                caption = f"Photo via Google — {gp.attribution}" if gp.attribution else "Photo via Google"
                db.add(
                    PlacePhoto(
                        id=photo_id,
                        place_id=pid,
                        uploaded_by_user_id=None,
                        source=PlacePhotoSource.GOOGLE.value,
                        storage_path=storage_path,
                        content_type=processed.content_type,
                        size_bytes=len(processed.bytes_),
                        width_px=processed.width_px,
                        height_px=processed.height_px,
                        caption=caption,
                        is_hero=True,  # safe: these places have no other photo
                    )
                )
                db.commit()
                imported += 1
                jobsdb.add_log(job_id, f"imported hero for {pid} ({processed.width_px}x{processed.height_px})")
            except Exception as exc:
                db.rollback()
                errors.append({"place_id": str(pid), "error": str(exc)})
                jobsdb.add_log(job_id, f"ERROR {pid}: {exc}")
            finally:
                jobsdb.bump_done(job_id, 1)
                if throttle:
                    time.sleep(throttle)
    finally:
        db.close()

    return {
        "dry_run": dry_run,
        "candidates": imported + no_photo + len(errors),
        "imported": imported,
        "no_photo": no_photo,
        "errors": errors,
    }


def _all_google_linked(
    db, limit: int | None, stale_days: int | None = None
) -> list[UUID]:
    stmt = (
        select(Place.id)
        .join(PlaceExternalId, PlaceExternalId.place_id == Place.id)
        .where(PlaceExternalId.provider == ExternalIdProvider.GOOGLE)
        .order_by(Place.id)
    )
    # Only refresh rows that are stale: never synced, or last synced more than
    # `stale_days` ago. Lets a monthly cadence skip fresh rows and spread the
    # (Enterprise-tier) Google call cost — and naturally resume mid-batch.
    if stale_days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=stale_days)
        stmt = stmt.where(
            or_(
                Place.google_synced_at.is_(None),
                Place.google_synced_at < cutoff,
            )
        )
    if limit:
        stmt = stmt.limit(limit)
    return [row[0] for row in db.execute(stmt).all()]


def count_google_linked(
    limit: int | None = None, stale_days: int | None = None
) -> int:
    db = SessionLocal()
    try:
        return len(_all_google_linked(db, limit, stale_days))
    finally:
        db.close()


def run_sync_google_data(job_id: str, params: dict[str, Any]) -> dict:
    """Refresh volatile Google data (rating, hours, website) for every
    Google-linked place — the weekly/biweekly sync.

    params: { limit?: int, dry_run?: bool = true, throttle_seconds?: float,
              stale_days?: int }

    Reuses resync_google_place, which now overwrites rating/hours and stamps
    google_synced_at on each call (website stays additive). When ``stale_days``
    is set, only places never synced or last synced more than that many days
    ago are touched — the lever for a cheap monthly cadence.
    """
    limit = params.get("limit")
    dry_run = bool(params.get("dry_run", True))
    throttle = float(params.get("throttle_seconds", THROTTLE_SECONDS))
    stale_days = params.get("stale_days")
    stale_days = int(stale_days) if stale_days not in (None, "") else None

    synced = 0
    errors: list[dict] = []

    db = SessionLocal()
    try:
        ids = _all_google_linked(db, limit, stale_days)
        jobsdb.set_total(job_id, len(ids))
        stale_note = f", stale>{stale_days}d" if stale_days is not None else ""
        jobsdb.add_log(
            job_id,
            f"{'DRY RUN — ' if dry_run else ''}{len(ids)} Google-linked place(s) "
            f"(throttle {throttle}s{stale_note}).",
        )
        for pid in ids:
            try:
                if dry_run:
                    jobsdb.add_log(job_id, f"[dry-run] would sync {pid}")
                else:
                    resync_google_place(db, place_id=pid)
                    synced += 1
                    jobsdb.add_log(job_id, f"synced {pid}")
            except Exception as exc:
                db.rollback()
                errors.append({"place_id": str(pid), "error": str(exc)})
                jobsdb.add_log(job_id, f"ERROR {pid}: {exc}")
            finally:
                jobsdb.bump_done(job_id, 1)
                if throttle:
                    time.sleep(throttle)
    finally:
        db.close()

    return {
        "dry_run": dry_run,
        "candidates": synced + len(errors),
        "synced": synced,
        "errors": errors,
    }


def run_purge_storage_orphans(job_id: str, params: dict[str, Any]) -> dict:
    """Delete bucket objects that no longer belong to any live photo.

    params: { retention_days?: int = 30, limit?: int = 500,
              dry_run?: bool = true, throttle_seconds?: float }

    Two phases, because there are two ways bytes get stranded:

    **Phase 1 — retire expired soft deletes.** ``soft_delete_photo`` sets
    ``deleted_at`` and keeps the object so admin restore is a one-column
    update. Past ``retention_days`` that restore isn't coming, so the row's
    path moves to the outbox and the row itself goes. The row has to go with
    it: a surviving row pointing at deleted bytes would render as a broken
    image the moment anyone un-deleted it.

    **Phase 2 — drain the outbox.** ``storage_orphans`` rows come from here,
    from review deletion (where a DB-level cascade takes the photo rows before
    any application code can read them), and from upload failures that wrote
    bytes but not a row. Delete the object, stamp ``purged_at``.

    Failures are recorded in ``purge_error`` and left pending, so a transient
    storage outage self-heals on the next run. The flip side is that a
    permanently unresolvable path retries forever — visible as a row whose
    ``created_at`` is old and whose ``purge_error`` keeps changing, which is
    the intended way to notice it.

    Deletion is idempotent on the Supabase side: removing an object that isn't
    there is not an error, so a job interrupted mid-drain is safe to re-run.
    """
    retention_days = int(params.get("retention_days", 30))
    limit = int(params.get("limit", 500))
    dry_run = bool(params.get("dry_run", True))
    throttle = float(params.get("throttle_seconds", 0))

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

    retired = 0
    purged = 0
    errors: list[dict] = []

    db = SessionLocal()
    storage = get_photos_storage_client()
    try:
        # ---- Phase 1: expired soft deletes -> outbox ----
        expired = list(
            db.execute(
                select(PlacePhoto)
                .where(PlacePhoto.deleted_at.is_not(None))
                .where(PlacePhoto.deleted_at < cutoff)
                .order_by(PlacePhoto.deleted_at)
                .limit(limit)
            )
            .scalars()
            .all()
        )
        jobsdb.add_log(
            job_id,
            f"{'DRY RUN — ' if dry_run else ''}{len(expired)} photo(s) "
            f"soft-deleted before {cutoff.date()} (retention {retention_days}d).",
        )
        if not dry_run and expired:
            enqueue_orphans(
                db,
                bucket=storage.bucket,
                storage_paths=[p.storage_path for p in expired],
                reason="soft_delete_expired",
            )
            for photo in expired:
                db.delete(photo)
            db.commit()
            retired = len(expired)
            jobsdb.add_log(job_id, f"retired {retired} expired soft-deleted row(s)")

        # ---- Phase 2: drain the outbox ----
        pending = list(
            db.execute(
                select(StorageOrphan)
                .where(StorageOrphan.purged_at.is_(None))
                .order_by(StorageOrphan.created_at)
                .limit(limit)
            )
            .scalars()
            .all()
        )
        jobsdb.set_total(job_id, len(pending))
        jobsdb.add_log(job_id, f"{len(pending)} object(s) pending deletion.")

        for orphan in pending:
            try:
                if dry_run:
                    jobsdb.add_log(
                        job_id,
                        f"[dry-run] would delete {orphan.bucket}/"
                        f"{orphan.storage_path} ({orphan.reason})",
                    )
                else:
                    storage.delete_object(orphan.storage_path)
                    orphan.purged_at = datetime.now(timezone.utc)
                    orphan.purge_error = None
                    db.add(orphan)
                    db.commit()
                    purged += 1
                    jobsdb.add_log(job_id, f"deleted {orphan.storage_path}")
            except Exception as exc:
                db.rollback()
                errors.append(
                    {"storage_path": orphan.storage_path, "error": str(exc)}
                )
                jobsdb.add_log(job_id, f"ERROR {orphan.storage_path}: {exc}")
                # Record the failure without clearing the row — it stays
                # pending and gets another attempt next run.
                try:
                    orphan.purge_error = str(exc)[:2000]
                    db.add(orphan)
                    db.commit()
                except Exception:
                    db.rollback()
            finally:
                jobsdb.bump_done(job_id, 1)
                if throttle:
                    time.sleep(throttle)
    finally:
        db.close()

    return {
        "dry_run": dry_run,
        "retention_days": retention_days,
        "soft_deletes_retired": retired,
        "objects_purged": purged,
        "errors": errors,
    }


# Registry of runnable job kinds. Add new ops here.
JOB_KINDS: dict[str, Callable[[str, dict[str, Any]], dict]] = {
    "backfill_field": run_backfill_field,
    "import_google_hero": run_import_google_hero,
    "sync_google_data": run_sync_google_data,
    "purge_storage_orphans": run_purge_storage_orphans,
}
