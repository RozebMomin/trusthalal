# TrustHalal API

A trust-layer API for halal verification. Places are modelled as geospatial
entities, claims are verifiable assertions with a full lifecycle
(`PENDING → VERIFIED → EXPIRED | DISPUTED | REJECTED`), ownership is granted
through a moderated intake workflow rather than self-assigned, and every
state change produces an auditable event. The goal is a backend that can
serve not just a single front-end but any external platform that needs
reliable halal data.

Built with FastAPI, PostgreSQL + PostGIS, SQLAlchemy 2.x, and Alembic.

## Prerequisites

- Python **3.11+** (project targets `>=3.11,<3.13`)
- [Poetry](https://python-poetry.org/) for dependency management
- Docker (for the Postgres + PostGIS container)

## Quickstart

```bash
# 1. Install dependencies
poetry install

# 2. Create your local env file
cp .env.example .env
# (edit DATABASE_URL if you're not using the compose defaults below)

# 3. Start Postgres + PostGIS
docker compose up -d db

# 4. Apply migrations
poetry run alembic upgrade head

# 5. Seed development data
poetry run python -m scripts.seed_dev

# 6. Run the API
poetry run uvicorn app.main:app --reload
```

Once the server is running:

- OpenAPI docs: <http://localhost:8000/docs>
- Health check: <http://localhost:8000/health>

## Authentication

Session-cookie auth. Clients sign in at `POST /auth/login` with email +
password; the server hashes with argon2id, creates a `sessions` row, and
sets an `HttpOnly` `tht_session` cookie (SameSite=Lax) that every
subsequent request carries. `GET /me` resolves the cookie back to the
acting user, and `POST /auth/logout` revokes the session and clears
the cookie.

```bash
curl -c cookies.txt -X POST http://localhost:8000/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email": "admin@trusthalal.dev", "password": "<password>"}'

curl -b cookies.txt http://localhost:8000/me
```

New users are onboarded via a single-use invite token:
`POST /admin/users` returns a `invite_url` the admin shares; the
invitee opens it, picks a password, and is auto-logged-in.
`GET /auth/invite/{token}` and `POST /auth/set-password` back that
flow.

Seeded users (passwords set by `scripts/seed_dev.py` — inspect the
script for the current defaults or override via env):

| Role     | Email                       |
| -------- | --------------------------- |
| ADMIN    | `admin@trusthalal.dev`      |
| VERIFIER | `verifier@trusthalal.dev`   |
| OWNER    | `owner@trusthalal.dev`      |
| CONSUMER | `consumer@trusthalal.dev`   |

For the test suite only, `DEV_HEADER_AUTH_ENABLED=true` (set in
`tests/conftest.py`) re-enables a narrow `X-User-Id` header fallback so
integration tests can pretend to be different roles without a full
login dance per request. It is off in every non-test environment.

## Core flows you can exercise with seed data

- **Search places nearby**: `GET /places?lat=40.72&lng=-74.05&radius=5000`
- **Inspect a place**: `GET /places/{place_id}` (claims + confidence score)
- **Submit ownership request (public)**:
  `POST /places/{place_id}/ownership-requests`
- **Admin approve ownership**:
  `POST /admin/ownership-requests/{id}/approve`
  — transactionally wires `PlaceOwner`, `OrganizationMember`, and promotes the
  requester's user role where applicable.
- **Create a claim (owner/admin)**: `POST /claims`
- **Attach evidence**: `POST /claims/{claim_id}/evidence`
- **Verify a claim (verifier/admin)**: `POST /claims/{claim_id}/verify`
- **Dispute a claim (consumer/admin)**: `POST /claims/{claim_id}/dispute`
- **Refresh a claim nearing expiry (owner/admin)**: `POST /claims/{claim_id}/refresh`

An out-of-process batch job expires claims whose `expires_at` has passed:

```bash
poetry run python scripts/expire_claims.py
```

## Request collection

A [Bruno](https://www.usebruno.com/) collection with every route lives in
`requests/`. Open the folder in Bruno, select the `local` environment, and
the `X-User-Id` header is driven by env variables you fill in once.

## Contract export for trusthalal-admin

The admin panel at [`../apps/admin`](../apps/admin) generates its typed
API client from this repo's committed `openapi.json`. After any change
to public routes, request bodies, or response models, regenerate and
commit the schema:

```bash
make export-openapi      # writes ./openapi.json
git add openapi.json
```

Then run `npm run codegen` in `apps/admin` to propagate the new shapes.
The committed file is deliberate — it turns contract changes into
reviewable diffs.

## Project layout

```
app/
  core/            config, auth dep, logging, exception plumbing
  db/              session, base, aggregated model imports
  modules/
    auth/          X-User-Id identity, /me, /auth/dev-login
    users/         users model + enums
    organizations/ orgs, members, place_owners (authority graph)
    places/        places, external ids, place events (geospatial core)
    claims/        halal claims, lifecycle, evidence, claim events
    evidence/      (wired into claims for v1)
    ownership_requests/ public intake flow (submit + status)
    admin/         moderated control plane (places, claims, users,
                   organizations, ownership requests)
alembic/           migrations (one file per shipped capability)
scripts/           seed_dev, expire_claims, db_ping
```

Each domain module follows the same shape: `models.py`, `schemas.py`,
`enums.py`, `repo.py`, `service.py`, `router.py`, `deps.py`. Business logic
currently lives in `repo.py`; the `service.py` files are intentional
placeholders for policy extraction as the codebase grows.

## Standards worth knowing

- **SQLAlchemy 2.x typed style** (`Mapped[...]` + `mapped_column(...)`).
- **All enums are `StrEnum`, stored as VARCHAR + CHECK** (not Postgres
  native enum types) so they can evolve via migrations.
- **Single `app` Postgres schema** — all tables set
  `__table_args__ = {"schema": "app"}`.
- **Timezone-aware datetimes everywhere.** Use
  `datetime.now(timezone.utc)` in Python and `DateTime(timezone=True)` on
  the DB side.
- **Structured errors** via `AppError` in `app/core/exceptions.py`. Raise
  `NotFoundError`, `ConflictError`, `ForbiddenError`, `BadRequestError`
  with a short `code` and a human-readable `detail`.
- **Soft-delete** for places (admins can restore); claims deactivate via
  status transitions (`EXPIRED`, `REJECTED`, `DISPUTED`).
- **Role-based access** via `require_roles(UserRole.X, ...)` plus a
  per-place membership check through
  `app/modules/organizations/deps.py::assert_can_manage_place` when an
  OWNER acts on a place.

## Running tests

The integration suite runs against a real Postgres/PostGIS database. Each
test wraps its work in a SAVEPOINT-joined session that rolls back at
teardown, so tests do not leak state.

One-time setup — create an empty test database alongside the dev one:

```bash
docker compose exec db psql -U trusthalal -d trusthalal \
    -c "CREATE DATABASE trusthalal_test;"
```

Run the suite:

```bash
poetry install --with dev
poetry run pytest -v
```

The harness auto-installs the `postgis` extension, runs every Alembic
migration to head, and truncates `app.*` once per session before the first
test. Override the target DB with:

```bash
TEST_DATABASE_URL=postgresql+psycopg://trusthalal:trusthalal@localhost:5432/my_other_test_db \
    poetry run pytest
```

Covered lifecycles: claim submit → evidence → verify → refresh → dispute
(including expired/idempotency/window gating), and ownership-request
submit → admin review → approve (existing + new org) / reject /
request-evidence (including terminal-status locks and duplicate-request
conflicts).

## License

Apache License 2.0 — see `LICENSE`.
