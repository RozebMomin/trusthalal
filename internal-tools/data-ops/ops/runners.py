"""Job runners — the actual data operations.

These run INSIDE the worker container and talk to the PRODUCTION database
via the API's own SQLAlchemy session (app.db.session.SessionLocal, whose
engine is built from DATABASE_URL=<prod>). We deliberately reuse the API's
ingestion code so behavior is identical to a real resync.
"""
from __future__ import annotations

import time
from typing import Any, Callable
from uuid import UUID

from sqlalchemy import select

# Registers EVERY model on Base.metadata in one place. Without this, only the
# Place models get imported and SQLAlchemy can't resolve cross-model foreign
# keys (e.g. places.deleted_by_user_id -> app.users) when it configures mappers
# for the write path. The read-only dry run never triggers that; a live resync
# does. Import for the side effect only.
import app.db.models  # noqa: F401
from app.db.session import SessionLocal
from app.modules.places.ingest import resync_google_place
from app.modules.places.models import (
    ExternalIdProvider,
    Place,
    PlaceExternalId,
)

from ops import jobsdb
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


# Registry of runnable job kinds. Add new ops here.
JOB_KINDS: dict[str, Callable[[str, dict[str, Any]], dict]] = {
    "backfill_field": run_backfill_field,
}
