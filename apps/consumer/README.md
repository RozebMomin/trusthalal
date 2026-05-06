# trusthalal-consumer

Public-facing halal-restaurant directory for Trust Halal. Next.js 14
(App Router) + shadcn/ui + TanStack Query. Part of the
[trusthalal monorepo](../..); the API it talks to lives at
[`../../api`](../../api).

This is the third app in the family, joining
[`../admin`](../admin/README.md) (staff review surface) and
[`../owner`](../owner/README.md) (restaurant-owner self-service).
Posture is intentionally lighter than the other two — anonymous
visitors browse the directory; an account is only required to save
preferences or file a dispute.

## Stack

- **Next.js 14** (App Router, React Server Components where helpful)
- **TypeScript** strict mode
- **Tailwind CSS** + **shadcn/ui** primitives (Radix under the hood)
- **TanStack Query** for fetching / mutation / cache
- **openapi-typescript** for typed API client generated from
  FastAPI's OpenAPI schema (committed into `src/lib/api/schema.d.ts`)

## Phase 9 plan

The consumer site lands across four feature branches:

1. **Phase 9a (this app's foundation)** — scaffold + auth + AppShell.
   You're reading the README that lives on that branch.
2. **Phase 9b** — search surface (text + halal filters + results).
   Hits the public `/places` endpoint with the filters Phase 4 wired.
3. **Phase 9c** — place detail page with halal profile rendering,
   dispute badge, and the consumer-side file-a-dispute flow.
4. **Phase 9d** — saved consumer preferences (minimum validation
   tier, slaughter method, alcohol policy, etc.).

## Prerequisites

- Node.js `>=20`
- npm `>=10`
- A running Trust Halal API (default: `http://localhost:8000`). See
  [`../../api/README.md`](../../api/README.md) to stand one up.

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

# Back in apps/consumer/:
npm run codegen          # writes src/lib/api/schema.d.ts
```

## Run

```bash
npm run dev              # http://localhost:3003
```

Other scripts:

- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — eslint
- `npm run typecheck` — tsc --noEmit
- `npm run codegen` — regenerate `src/lib/api/schema.d.ts` from the
  API's OpenAPI schema

## Authentication

Same single-cookie session auth as the other two apps. Sign in at
`/login` or sign up at `/signup`; the API sets a `tht_session`
HttpOnly cookie on the API origin, and every subsequent request
carries it via `credentials: "include"`. Anonymous browsing is fine
— `useCurrentUser` returns null on a 401 from `/me` instead of
throwing, so the AppShell can branch on signed-in state without
gating page rendering.

Signups from this app are hard-coded to `role=CONSUMER` so users
created here don't show up in the owner portal's role gate or the
admin panel's staff list.

## Project layout

```
src/
  app/                     App Router routes
    layout.tsx             Root layout (AppShell + Providers)
    providers.tsx          QueryClient provider
    page.tsx               Home (Phase 9b replaces the stub with search)
    login/                 Public sign-in
    signup/                Public sign-up (role=CONSUMER hard-coded)
  components/
    ui/                    shadcn/ui primitives
    app-shell.tsx          Public-friendly chrome (no role gate)
    version-tag.tsx        Tiny build-SHA chip
  lib/
    config.ts              Env-driven runtime config
    utils.ts               shadcn cn() helper
    api/
      client.ts            apiFetch (credentials: include, typed errors)
      hooks.ts             TanStack Query hooks per resource
      schema.d.ts          Generated types (do not edit)
      friendly-errors.ts   ApiError → toast copy with per-code overrides
```

## Contract sync

Same posture as the other two apps. The consumer site's types are
regenerated from `api/openapi.json`. After any backend route or
schema change, run `make export-openapi` in `api/`, commit
`openapi.json`, then run `npm run codegen` here and commit
`src/lib/api/schema.d.ts`. The generated file is checked in
deliberately so every contract change shows up in the diff.

## Deploy

Phase 9a is local-only — Vercel project setup happens once 9b's
search surface lands and the site has something worth deploying.
Plan: `consumer.trusthalal.org` → Vercel, same Sentry project as
the other two apps but with a separate DSN so issue volume per
audience stays distinguishable.
