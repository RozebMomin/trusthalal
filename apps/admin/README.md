# trusthalal-admin

Internal admin panel for the Trust Halal API. Next.js 14 (App Router) +
shadcn/ui + TanStack Query. Part of the
[trusthalal monorepo](../..); the API it talks to lives at
[`../../api`](../../api).

## Stack

- **Next.js 14** (App Router, React Server Components where helpful)
- **TypeScript** strict mode
- **Tailwind CSS** + **shadcn/ui** primitives (Radix under the hood)
- **TanStack Query** for fetching / mutation / cache
- **openapi-typescript** for typed API client generated from FastAPI's
  OpenAPI schema (committed into `src/lib/api/schema.d.ts`)

## Prerequisites

- Node.js `>=20`
- npm `>=10`
- A running Trust Halal API (default: `http://localhost:8000`). See
  [`../../api/README.md`](../../api/README.md) to stand one up.
- An admin user in `app.users` with `is_active=true` and a password
  hash set. The API's seed script creates one you can use; otherwise
  invite yourself from the Users page once you're in.

## First-time setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local if your API isn't on http://localhost:8000:
#   NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Then generate the typed API client from the committed schema:

```bash
# In api/ (once, or after backend contract changes):
make export-openapi      # writes api/openapi.json

# Back in apps/admin/:
npm run codegen          # writes src/lib/api/schema.d.ts
```

## Run

```bash
npm run dev              # http://localhost:3001
```

Other scripts:

- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — eslint
- `npm run typecheck` — tsc --noEmit
- `npm run codegen` — regenerate `src/lib/api/schema.d.ts` from the
  API's OpenAPI schema

## Authentication

Session-cookie auth, fully server-side. Sign in at `/login` with email
+ password, the API sets a `tht_session` HttpOnly cookie on the API
origin, and every subsequent request carries it via
`credentials: "include"`. No X-User-Id header, no dev shortcut — that
scaffolding was removed once the real auth flow landed.

New admins or verifiers are onboarded via the invite flow on the
Users page: an admin creates a user, the server mints a one-time
invite token, and you share the pre-baked set-password URL with the
invitee. They land on `/set-password`, pick a password, and are
signed in.

Role gating is centralized in `src/lib/auth/panel-access.ts`. Today:

- **ADMIN** — full panel
- **VERIFIER** — `/claims` queue (read-only, no moderation buttons)
- **OWNER** / **CONSUMER** — no panel access; render a friendly
  dead-end page with a sign-out button. Owners will get their own
  portal (future `apps/portal/`).

## Project layout

```
src/
  app/                     App Router routes
    layout.tsx             Root layout (AppShell + Providers)
    providers.tsx          QueryClient provider
    page.tsx               Dashboard (ADMIN only)
    login/                 Public sign-in
    set-password/          Public token-gated set-password landing
    places/                ADMIN only
    claims/                ADMIN + VERIFIER
    users/                 ADMIN only
    organizations/         ADMIN only
    ownership-requests/    ADMIN only
  components/
    ui/                    shadcn/ui primitives
    app-nav.tsx            Sidebar, filtered by role
    app-shell.tsx          Client-side auth + role gate
  lib/
    config.ts              Env-driven runtime config
    utils.ts               shadcn cn() helper
    auth/
      panel-access.ts      Role → home + role → allowed paths
    api/
      client.ts            apiFetch (credentials: include, typed errors)
      hooks.ts             TanStack Query hooks per resource
      schema.d.ts          Generated types (do not edit)
      friendly-errors.ts   ApiError → toast copy with per-code overrides
```

## Contract sync

The admin panel's types are regenerated from `api/openapi.json`.
After any backend route, request body, or response schema change,
run `make export-openapi` in `api/`, commit `openapi.json`, then run
`npm run codegen` here and commit `src/lib/api/schema.d.ts`. The
generated file is committed deliberately so every contract change
shows up in a git diff.
