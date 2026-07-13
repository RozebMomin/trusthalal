"""ops-api — FastAPI that serves the control-panel UI and the queue endpoints.

Enqueues jobs into the local queue (the worker container executes them) and
exposes read endpoints the UI polls. Also a /api/preview that counts backfill
candidates against PROD without enqueuing anything.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ops import jobsdb
from ops.runners import JOB_KINDS, count_backfill_candidates

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Trust Halal data-ops", docs_url="/docs")


@app.on_event("startup")
def _startup() -> None:
    jobsdb.init_schema()


class EnqueueBody(BaseModel):
    kind: str
    params: dict[str, Any] = {}


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "kinds": sorted(JOB_KINDS.keys())}


@app.get("/api/preview")
def preview(field: str = "phone", limit: int | None = None) -> dict:
    """Count of places a backfill_field job would touch (no enqueue)."""
    try:
        return {"field": field, "candidates": count_backfill_candidates(field, limit)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/jobs")
def create_job(body: EnqueueBody) -> dict:
    if body.kind not in JOB_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown kind {body.kind!r}; valid: {sorted(JOB_KINDS)}",
        )
    job_id = jobsdb.enqueue(body.kind, body.params)
    return {"id": job_id}


@app.get("/api/jobs")
def list_jobs(limit: int = 50) -> list[dict]:
    return jobsdb.list_jobs(limit)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = jobsdb.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
