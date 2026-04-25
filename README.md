# Trust Halal

Trust Halal is a trust-layer platform for halal verification — a canonical
source of truth for restaurants, halal claims, and the evidence behind
them. The goal is to be the data authority that consumer-facing sites,
mobile apps, and partner integrations license, rather than another
walled-garden directory.

This monorepo contains the three pieces that make up the current stack.

## Layout

```
trusthalal/
├── api/                  # FastAPI + PostgreSQL (PostGIS) + Alembic
├── apps/
│   ├── admin/            # Next.js 14 admin panel (internal staff)
│   └── owner/            # Next.js 14 owner portal (restaurant owners)
└── README.md
```

A separate consumer-facing site (`halalfoodnearme.com`) is out-of-tree.

## Quickstart

Each app has its own detailed README with role-specific setup. For a
zero-to-running-stack pass:

```bash
# 1. Start Postgres + PostGIS via docker compose
cd api
docker compose up -d db

# 2. Install + migrate + seed + run the API
cp .env.example .env   # edit if your DB creds differ
poetry install
poetry run alembic upgrade head
poetry run python -m scripts.seed_dev
poetry run uvicorn app.main:app --reload   # → http://localhost:8000

# 3. In another shell, start the admin panel
cd ../apps/admin
npm install
cp .env.local.example .env.local           # edit NEXT_PUBLIC_API_BASE_URL if needed
npm run dev                                # → http://localhost:3001

# 4. (optional) In a third shell, start the owner portal
cd ../owner
npm install
cp .env.local.example .env.local
npm run dev                                # → http://localhost:3002
```

The seed script provisions users but does not set passwords. To get
into the admin panel locally, mint an invite token for a seeded user
(or bootstrap the very first admin in a fresh DB):

```bash
cd api
poetry run python -m scripts.issue_invite admin@example.com --role ADMIN
# Or for an empty database, --create makes the user too:
poetry run python -m scripts.issue_invite me@example.com --role ADMIN --create
```

The script prints a one-time set-password URL — open it, set a
password, then sign in normally at `/login`.

## Production topology

```
api.trusthalal.org        ← Trust Halal API   (api/, Render + Supabase)
admin.trusthalal.org      ← Admin panel       (apps/admin, Vercel)
owner.trusthalal.org      ← Owner portal      (apps/owner, Vercel)
```

Hosting:

- **API** runs on Render (free tier) with a pre-deploy hook for
  `alembic upgrade head`. Postgres + PostGIS is hosted on Supabase
  (Session pooler for IPv4 compatibility with Render).
- **Admin and owner** are separate Vercel projects, each pinned to its
  own root directory (`apps/admin` and `apps/owner`).
- **DNS** is on Cloudflare in DNS-only mode (proxy off) so SSL
  passes through to Vercel and Render.

Auth is a single session cookie on the API origin
(`api.trusthalal.org`, HttpOnly, SameSite=Lax). Both frontends
attach it on cross-origin requests with `credentials: "include"`;
the API's CORS middleware allow-lists both panels via the
`CORS_ORIGINS` env var (currently `admin.trusthalal.org` and
`owner.trusthalal.org`, plus `*.vercel.app` aliases for previews) and
runs with `allow_credentials=True`. Each app gates access by role
independently — admin allows ADMIN + VERIFIER, owner allows OWNER
only.

### Branching

Vercel auto-deploys non-`main` branches as preview URLs. The
convention is: feature work happens on `feat/*` branches, lands on
`main` only when ready, and Render's auto-deploy is wired to `main`.
This keeps prod stable while every PR still gets a live preview URL
on Vercel for quick review.

## Per-app docs

- [api/README.md](api/README.md) — FastAPI setup, migrations, auth, testing.
- [apps/admin/README.md](apps/admin/README.md) — admin panel setup, codegen, dev auth.
- [apps/owner/README.md](apps/owner/README.md) — owner portal setup, codegen, dev auth.

## License

Apache 2.0. See the LICENSE files in each sub-tree.
