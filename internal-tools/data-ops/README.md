# Trust Halal · data-ops

A **desktop-only** internal tool for bulk data operations against the production
database — e.g. backfilling the `phone` field or re-running Google ingestion
across many places at once. Nothing here is deployed anywhere; you bring it up
and down with `docker compose` on your machine.

## What's inside

Four containers (`docker-compose.yml`):

| service    | role                                                                    |
|------------|-------------------------------------------------------------------------|
| `jobs-db`  | Local Postgres holding the **job queue** (`ops_jobs`). Not your prod DB. |
| `ops-api`  | FastAPI on **:8090** — serves the control-panel UI + enqueue/list endpoints. |
| `worker`   | Polls the queue, runs jobs against **prod**, streams progress + logs.    |
| (volume)   | `jobs-data` persists the queue between restarts.                         |

The worker reuses the API's own ingestion code (`app.modules.places.ingest.
resync_google_place`) so a backfill behaves identically to a real resync:
additive only, never clobbers a value that's already set.

```
browser ──▶ ops-api ──enqueue──▶ jobs-db ──claim (FOR UPDATE SKIP LOCKED)──▶ worker ──▶ PROD DB
                 ▲                                                              │
                 └──────────────── UI polls /api/jobs (progress + logs) ◀───────┘
```

## Setup

1. `cp .env.example .env` and fill in:
   - `PROD_DATABASE_URL` — SQLAlchemy/psycopg URL for production
     (`postgresql+psycopg://USER:PASS@HOST:5432/DB`).
   - `GOOGLE_MAPS_API_KEY` — same server key the API uses.
   - `OPS_THROTTLE_SECONDS` — seconds between Google calls (default `0.5`).

   `.env` is gitignored — it never gets committed.

2. Bring it up (build context is the repo root so it can copy `api/`):

   ```bash
   cd internal-tools/data-ops
   docker compose up --build
   ```

3. Open **http://localhost:8090**.

4. Take it down: `docker compose down` (add `-v` to also wipe the queue).

## Using it

- **Preview count** — resolves how many Google-linked places are missing the
  chosen field, without enqueuing or calling Google.
- **Run job** with **Dry run** checked (the default) — enqueues a job that logs
  what it *would* do, no writes, no Google calls.
- Uncheck **Dry run** to actually resync + backfill. You'll get a confirm prompt
  because it writes to prod.
- The Jobs table polls every 2s: status, progress bar, result summary
  (`upd / unchg / err`), and expandable per-job logs.

## Adding a new operation

1. Write a `run_<kind>(job_id, params) -> dict` in `ops/runners.py` using the
   `jobsdb` helpers (`set_total`, `bump_done`, `add_log`) for progress.
2. Register it in `JOB_KINDS`.
3. (Optional) add a form for it in `ops/static/index.html`.

## Note on history

Today the worker talks **directly** to prod. If you later want an audit trail
for certain operations, route those job kinds through the API instead of
`SessionLocal` — the queue/worker/UI stay the same.
