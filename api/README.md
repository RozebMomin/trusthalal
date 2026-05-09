# TrustHalal API

A trust-layer API for halal verification. Places are modelled as
geospatial entities; ownership is granted through a moderated intake
workflow rather than self-assigned; halal claims live on a multi-stage
lifecycle (`DRAFT → UNDER_REVIEW → APPROVED | NEEDS_MORE_INFO |
REJECTED`) and, on approval, derive a public-facing `HalalProfile` with
a validation tier, menu posture, slaughter method, alcohol policy,
dispute state, and certification metadata. Every state change writes
an auditable event row.

The goal is a backend that can serve not just a single front-end but
any external platform that needs reliable halal data.

Built with FastAPI, PostgreSQL + PostGIS, SQLAlchemy 2.x, Alembic, and
Supabase Storage for owner-uploaded photos + evidence. External
integrations: Google Places (New) for ingest + ingest cuisine
auto-tagging, Google Geocoding for forward / reverse city lookups,
Google Cloud Vision SafeSearch for photo moderation at upload.

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

Public read paths (no auth required):

- **Search places** — `GET /places?q=khan` (text) or
  `GET /places?lat=40.72&lng=-74.05&radius=5000` (geo). Filterable by
  cuisine (`?cuisine=PAKISTANI&cuisine=INDIAN`), validation tier, menu
  posture, slaughter method, certification, and pork / alcohol axes.
- **Place detail** — `GET /places/{place_id}` returns the full place
  + embedded halal profile + photo gallery + cuisine tags.
- **Place photos** — `GET /places/{place_id}/photos` returns the
  hero-first gallery (public).
- **Forward / reverse geocode proxies** —
  `GET /places/google/forward-geocode?q=Atlanta` and
  `GET /places/google/reverse-geocode?lat=…&lng=…` back the consumer
  "Pick a city" + near-me city-label features.

Owner flows (auth required, `OWNER` role on an active org with a
`PlaceOwner` row):

- **Claim a place** — owner-initiated via
  `POST /me/ownership-requests` (with either an existing `place_id`
  or a `google_place_id` for first-time ingest).
- **Submit a halal claim** — `POST /me/halal-claims` creates a
  `DRAFT`; `PATCH /me/halal-claims/{id}` saves the questionnaire;
  `POST /me/halal-claims/{id}/attachments` uploads evidence;
  `POST /me/halal-claims/{id}/submit` flips to `UNDER_REVIEW`.
- **Edit place metadata** — `PATCH /me/places/{place_id}` accepts
  `cuisine_types` (owner-curated tags). Identity columns stay
  admin-only.
- **Photos** — `POST /places/{place_id}/photos` (multipart upload,
  runs HEIC→JPEG + EXIF strip + Cloud Vision SafeSearch before the
  bytes hit the bucket); `PATCH` to set hero / caption; soft
  `DELETE`.

Admin flows (auth required, `ADMIN` role; verifiers see a subset):

- **Ingest from Google** — `POST /admin/places/ingest` runs the
  Google Places (New) extractor + populates city / region /
  country / cuisine.
- **Approve a halal claim** — `POST /admin/halal-claims/{id}/approve`
  derives a `HalalProfile` and supersedes any prior approved
  profile for the same place atomically.
- **Review ownership request** — `POST /admin/ownership-requests/{id}/{approve,reject,request-evidence}`.
  Approval transactionally wires `PlaceOwner`, `OrganizationMember`,
  and promotes the requester's role to `OWNER` when applicable.
- **Disputes** — `POST /me/disputes` (consumer files) →
  `GET /admin/disputes` queue → `POST /admin/disputes/{id}/{uphold,dismiss}`.

Consumer flows (auth optional):

- **Save preferences** —
  `PATCH /me/consumer-preferences` (auth required) seeds default
  filters on subsequent searches.
- **File a dispute** — `POST /places/{place_id}/disputes` (auth
  required).

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
  core/                    config, auth dep, logging, storage,
                           rate-limiter, exception plumbing
  db/                      session, base, aggregated model imports
  modules/
    auth/                  /auth/login + /auth/logout + /auth/signup,
                           invite + set-password flow, /me
    users/                 users model, roles, sessions
    organizations/         orgs, members, place_owners
                           (the authority graph)
    places/                places, external IDs, place events,
                           Google integrations, photos pipeline,
                           cuisine taxonomy, owner edit endpoints
      photos/              place_photos table + image processor +
                           Cloud Vision SafeSearch + repo + router
      integrations/        Google client (forward / reverse geocode,
                           Places New + legacy fallback) + extractor
    halal_claims/          owner submission flow (DRAFT → UNDER_REVIEW
                           → APPROVED | NEEDS_MORE_INFO | REJECTED),
                           questionnaire schema, attachments, events
    halal_profiles/        derived public-facing trust profile
                           (validation tier, menu posture, slaughter
                           method, alcohol policy, dispute state)
    disputes/              consumer-filed disputes against a profile
                           with admin review queue
    verifiers/             verifier applications + visit reports
    consumer_preferences/  per-user default search filters
    ownership_requests/    place-claim intake flow
    evidence/              shared upload helper used by halal_claims
                           + ownership_requests
    audit/                 cross-cutting event logging
    admin/                 moderated control plane (places, claims,
                           disputes, organizations, users, ownership
                           requests, verifiers)
alembic/                   migrations (one file per shipped capability)
scripts/                   seed_dev, issue_invite, export_openapi,
                           reset_db, db_ping,
                           backfill_certificate_urls (one-off — copies
                           cert files from the private evidence bucket
                           into the public certs bucket for approvals
                           that predate the cert-publish slice)
```

Each domain module follows the same shape: `models.py`, `schemas.py`,
`enums.py`, `repo.py`, `service.py`, `router.py`, `deps.py`. Business
logic currently lives in `repo.py`; `service.py` files are intentional
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
- **Soft-delete** for places (admins can restore via
  `/admin/places/{id}/restore`) and place photos (admins can audit /
  restore); halal claims and halal profiles transition through their
  own status lifecycles rather than soft-deleting.
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

Covered lifecycles include: ownership-request submit → admin review
→ approve / reject / request-evidence (terminal-status locks +
duplicate-request conflicts); halal-claim DRAFT → UNDER_REVIEW →
APPROVED with profile derivation + supersession; halal-profile dispute
file → reconcile → admin uphold / dismiss; admin place ingest +
relink + resync against a fixture Google client; place owner revoke;
self-demotion guards on user role + active state.

## License

Apache License 2.0 — see `LICENSE`.
