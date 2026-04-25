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
│   └── admin/            # Next.js 14 admin panel (internal staff)
└── README.md
```

Future siblings under `apps/` will include the owner portal
(`apps/portal`, customer-facing for restaurant owners) and any other
Trust Halal surfaces. A separate consumer-facing site
(`halalfoodnearme.com`) is out-of-tree.

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
```

Sign in with a seeded user (see `api/scripts/seed_dev.py` for default
emails), or invite yourself from the Users page once you have one
admin account bootstrapped.

## Deployment target

The runtime topology, once we're deployed:

```
admin.trusthalal.org      ← internal staff panel (apps/admin)
portal.trusthalal.org     ← owner dashboard (apps/portal, TBD)
api.trusthalal.org        ← Trust Halal API (api/)
```

The session cookie lives on `api.trusthalal.org` and is sent on
same-site subdomain requests from both admin and portal frontends.
Each app gates access by role independently.

## Per-app docs

- [api/README.md](api/README.md) — FastAPI setup, migrations, auth, testing.
- [apps/admin/README.md](apps/admin/README.md) — admin panel setup, codegen, dev auth.

## License

Apache 2.0. See the LICENSE files in each sub-tree.
