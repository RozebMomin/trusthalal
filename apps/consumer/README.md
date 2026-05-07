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

## Branding

The consumer site lives under its own brand
(**HalalScout**) so the apex domain
([halalfoodnearme.com](https://halalfoodnearme.com)) feels like a
destination rather than a search-engine URL. The "Powered by Trust
Halal" line in the footer keeps the credentialing platform connected
to the surface so trust transfers without diluting either brand.

Brand strings are centralized in
[`src/lib/branding.ts`](src/lib/branding.ts):

- `BRAND_NAME` — the consumer brand
- `BRAND_TAGLINE` — apex-hero pitch
- `BRAND_DESCRIPTION` — long-form copy used as the default OG / meta
  description
- `SITE_URL` — canonical origin (override via `NEXT_PUBLIC_SITE_URL`
  on Vercel previews)
- `TRUST_HALAL_URL` / `OWNER_PORTAL_URL` — outbound links surfaced in
  the hero + footer

Renaming the consumer site is a single edit to `BRAND_NAME` —
nothing else hard-codes either name.

## SEO

What's wired up:

- `app/layout.tsx` — root metadata, OG defaults, Twitter card,
  `metadataBase`, title template (`%s · HalalScout`).
- `app/places/[id]/page.tsx` — server-rendered `generateMetadata`
  that fetches the place via `serverFetch` and builds per-place
  title, description, canonical URL, and OG tags. Soft-deleted /
  missing places return `noindex`.
- `app/places/[id]/page.tsx` also injects JSON-LD
  (`@type: Restaurant`) so Google can render the listing in rich
  results.
- `app/sitemap.ts` — static sitemap. **TODO** — add a backend
  sitemap-friendly endpoint (`GET /places/sitemap`) and spread
  `/places/{id}` URLs in here. The public `GET /places` requires a
  query string or geo trio by design, so we can't enumerate the
  catalog from the browser.
- `app/robots.ts` — allows public surfaces, disallows the
  signed-in-only routes (`/login`, `/signup`, `/preferences`,
  `/disputes`).

## Deploy (halalfoodnearme.com on Vercel)

The consumer site ships to Vercel with the apex domain
[halalfoodnearme.com](https://halalfoodnearme.com) pointed at it.
Same Sentry project pattern as the admin + owner apps; separate DSN
so issue volume per audience stays distinguishable.

### One-time Vercel project setup

1. **Create a new Vercel project** from the
   [`RozebMomin/trusthalal`](https://github.com/RozebMomin/trusthalal)
   repo.
2. **Root directory:** `apps/consumer`. Vercel auto-detects Next.js
   from there.
3. **Build command:** leave default (`next build`).
4. **Production branch:** `main`.

### Environment variables (Vercel project → Settings → Environment Variables)

Required:

```
NEXT_PUBLIC_API_BASE_URL=https://api.trusthalal.org
NEXT_PUBLIC_SITE_URL=https://halalfoodnearme.com
```

Recommended (Sentry — separate DSN per app):

```
NEXT_PUBLIC_SENTRY_DSN=<consumer DSN>
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_ORG=trusthalal
SENTRY_PROJECT=consumer
SENTRY_AUTH_TOKEN=<auth token>
```

### DNS (halalfoodnearme.com → Vercel)

In the Vercel project, add both `halalfoodnearme.com` and
`www.halalfoodnearme.com`. Vercel will surface the DNS records to
add at the registrar:

- Apex (`halalfoodnearme.com`) — `A` record `76.76.21.21`, **or**
  the registrar's ALIAS / ANAME / flattened CNAME pointing to
  `cname.vercel-dns.com`.
- `www` — `CNAME` to `cname.vercel-dns.com`.

Configure `www` to redirect to the apex (Vercel does this by
default once both are added — pick "Redirect to" and choose the
apex as primary).

### Backend (Render) CORS update

Add the new origins to the API's `CORS_ORIGINS` env var on Render so
browser requests from the consumer domain are accepted with cookies:

```
CORS_ORIGINS=https://admin.trusthalal.org,https://owner.trusthalal.org,https://halalfoodnearme.com,https://www.halalfoodnearme.com
```

The API is already on `api.trusthalal.org`; cookies set by `/auth/login`
are scoped to that origin and ride along on every cross-origin
request via `credentials: "include"`.

### Smoke checklist after first deploy

- `https://halalfoodnearme.com/` loads, hero shows the brand + tagline,
  footer shows "Powered by Trust Halal".
- A search query (e.g. "halal") returns results from the production
  API.
- `https://halalfoodnearme.com/robots.txt` includes a `Sitemap:`
  line and disallows `/login` etc.
- `https://halalfoodnearme.com/sitemap.xml` lists `/` and
  `/preferences`.
- A place detail page (`/places/{id}`) has the restaurant name in
  the `<title>`, a `Restaurant` JSON-LD `<script>` in the markup,
  and the address in the meta description.
