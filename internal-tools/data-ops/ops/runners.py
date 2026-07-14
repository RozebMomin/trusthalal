"""Job runners — the actual data operations.

These run INSIDE the worker container and talk to the PRODUCTION database
via the API's own SQLAlchemy session (app.db.session.SessionLocal, whose
engine is built from DATABASE_URL=<prod>). We deliberately reuse the API's
ingestion code so behavior is identical to a real resync.
"""
from __future__ import annotations

import time
from typing import Any, Callable
from uuid import UUID, uuid4

from sqlalchemy import exists, select

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


# Registry of runnable job kinds. Add new ops here.
JOB_KINDS: dict[str, Callable[[str, dict[str, Any]], dict]] = {
    "backfill_field": run_backfill_field,
    "import_google_hero": run_import_google_hero,
}
