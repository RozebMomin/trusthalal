"""The job queue — a tiny Postgres-backed queue (no Redis, no broker).

Lives in the LOCAL `jobs-db` container. Durable jobs with status, progress,
per-job logs, and results. `claim_one` uses FOR UPDATE SKIP LOCKED so multiple
workers can run safely later.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import create_engine, text

from ops.settings import OPS_JOBS_DATABASE_URL

engine = create_engine(OPS_JOBS_DATABASE_URL, pool_pre_ping=True, future=True)

_DDL = """
CREATE TABLE IF NOT EXISTS ops_jobs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        text NOT NULL,
    params      jsonb NOT NULL DEFAULT '{}'::jsonb,
    status      text NOT NULL DEFAULT 'queued',   -- queued|running|succeeded|failed
    total       integer,
    done        integer NOT NULL DEFAULT 0,
    result      jsonb,
    error       text,
    logs        jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    started_at  timestamptz,
    finished_at timestamptz
);
"""


def init_schema() -> None:
    with engine.begin() as c:
        c.execute(text(_DDL))


def enqueue(kind: str, params: dict[str, Any]) -> str:
    with engine.begin() as c:
        row = c.execute(
            text("INSERT INTO ops_jobs (kind, params) VALUES (:k, CAST(:p AS jsonb)) RETURNING id"),
            {"k": kind, "p": json.dumps(params)},
        ).first()
        return str(row.id)


def list_jobs(limit: int = 50) -> list[dict]:
    with engine.begin() as c:
        rows = c.execute(
            text("SELECT * FROM ops_jobs ORDER BY created_at DESC LIMIT :l"),
            {"l": limit},
        ).mappings().all()
        return [dict(r) for r in rows]


def get_job(job_id: str) -> Optional[dict]:
    with engine.begin() as c:
        r = c.execute(
            text("SELECT * FROM ops_jobs WHERE id = :id"), {"id": job_id}
        ).mappings().first()
        return dict(r) if r else None


def claim_one() -> Optional[dict]:
    """Atomically grab the oldest queued job and mark it running."""
    with engine.begin() as c:
        r = c.execute(
            text(
                """
                UPDATE ops_jobs SET status = 'running', started_at = now()
                WHERE id = (
                    SELECT id FROM ops_jobs
                    WHERE status = 'queued'
                    ORDER BY created_at
                    LIMIT 1 FOR UPDATE SKIP LOCKED
                )
                RETURNING *
                """
            )
        ).mappings().first()
        return dict(r) if r else None


def set_total(job_id: str, total: int) -> None:
    with engine.begin() as c:
        c.execute(text("UPDATE ops_jobs SET total = :t WHERE id = :id"), {"t": total, "id": job_id})


def bump_done(job_id: str, n: int = 1) -> None:
    with engine.begin() as c:
        c.execute(text("UPDATE ops_jobs SET done = done + :n WHERE id = :id"), {"n": n, "id": job_id})


def add_log(job_id: str, line: str) -> None:
    with engine.begin() as c:
        c.execute(
            text("UPDATE ops_jobs SET logs = logs || to_jsonb(CAST(:l AS text)) WHERE id = :id"),
            {"l": line, "id": job_id},
        )


def delete_job(job_id: str) -> bool:
    with engine.begin() as c:
        r = c.execute(text("DELETE FROM ops_jobs WHERE id = :id"), {"id": job_id})
        return r.rowcount > 0


def clear_finished() -> int:
    """Delete all jobs that are no longer active (succeeded/failed)."""
    with engine.begin() as c:
        r = c.execute(
            text("DELETE FROM ops_jobs WHERE status IN ('succeeded', 'failed')")
        )
        return r.rowcount


def fail_orphaned() -> int:
    """Any job still 'running' at startup was orphaned by a worker crash/restart.

    Nothing is executing it, so mark it failed rather than leaving it stuck.
    """
    with engine.begin() as c:
        r = c.execute(
            text(
                "UPDATE ops_jobs SET status = 'failed', finished_at = now(), "
                "error = COALESCE(error, 'orphaned: worker restarted before completion') "
                "WHERE status = 'running'"
            )
        )
        return r.rowcount


def finish(job_id: str, status: str, result: Optional[dict] = None, error: Optional[str] = None) -> None:
    with engine.begin() as c:
        c.execute(
            text(
                "UPDATE ops_jobs SET status = :s, result = CAST(:r AS jsonb), "
                "error = :e, finished_at = now() WHERE id = :id"
            ),
            {
                "s": status,
                "r": json.dumps(result) if result is not None else None,
                "e": error,
                "id": job_id,
            },
        )
