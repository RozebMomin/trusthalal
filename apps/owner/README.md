# trusthalal-owner

Customer-facing dashboard for restaurant owners on Trust Halal. Part
of the [trusthalal monorepo](../..); the API it talks to lives at
[`../../api`](../../api).

This is a **separate app from the staff admin panel** by design.
Owners are external customers, admins are internal staff — different
audiences, different design language, eventually different deploy
cadences. They share one backend (the Trust Halal API) and one auth
posture (session cookie on `api.trusthalal.org`).

## Stack

- **Next.js 14** (App Router)
- **TypeScript** strict mode
- **Tailwind CSS** + **shadcn/ui** primitives
- **TanStack Query** for fetching / mutation / cache
- **openapi-typescript** wired but the owner-portal types are still
  largely hand-typed in `src/lib/api/hooks.ts`. Codegen scaffolding
  is set up via `npm run codegen`; a future pass will swap each
  hand-typed shape for `components["schemas"][...]` once the
  schemas stabilize.

## Prerequisites

- Node.js `>=20`
- npm `>=10`
- A running Trust Halal API (default: `http://localhost:8000`). See
  [`../../api/README.md`](../../api/README.md) to stand one up.
- An OWNER user with a password set. The seed script creates one;
  alternatively bootstrap one with `scripts/issue_invite.py
  --create --role OWNER --display-name "Test Owner"
  owner@example.com`.

## First-time setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local if your API isn't on http://localhost:8000:
#   NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Run

```bash
npm run dev              # http://localhost:3002
```

The admin panel runs on 3001 and the owner portal on 3002, so both
can run side-by-side during dev.

Other scripts:

- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — eslint
- `npm run typecheck` — tsc --noEmit
- `npm run codegen` — regenerate `src/lib/api/schema.d.ts` from the
  API's OpenAPI schema (run after backend contract changes)

## Authentication + role gate

Same session-cookie auth as the admin panel. Sign in at `/login`
with email + password, the API sets a `tht_session` HttpOnly cookie
on `api.trusthalal.org`, and every subsequent request carries it via
`credentials: "include"`.

The portal's `AppShell` enforces a strict role gate: only the
**OWNER** role gets the dashboard chrome. Anyone else (ADMIN,
VERIFIER, CONSUMER) lands on a friendly "this portal isn't for you"
screen with a sign-out button. This mirrors the admin panel's
inverse gate (admin allows ADMIN + VERIFIER, blocks others) and
keeps the two surfaces from blending into each other.

## Project layout

```
src/
  app/
    layout.tsx              Root layout (AppShell + Providers)
    providers.tsx           QueryClient provider
    page.tsx                Owner home (places overview)
    login/  signup/         Public auth surfaces
    claim/                  "Claim a place" intake flow (Google
                            autocomplete + ingest fallback)
    my-claims/              Ownership-request lifecycle list
                            (legacy URL — surfaced by the home + the
                            "see all claims" link on /my-places)
    my-places/              Owned place management
      [id]/                 Place detail: cuisine tags, photos
                            (upload + hero), halal claims for this
                            place
    my-halal-claims/        Halal-only surface — questionnaire,
                            evidence attachments, submit-for-review
      new/                  Single + batch claim creation
      [id]/                 Halal claim editor + activity timeline
    my-organizations/       Org self-service: create, edit, attach
                            verification documents, submit
  components/
    ui/                     shadcn/ui primitives
    app-shell.tsx           Auth + role gate, header chrome,
                            mobile bottom-tab bar
    halal-claim-status-badge.tsx, halal-claim-timeline.tsx,
    google-place-autocomplete.tsx, certifying-authority-select.tsx
  lib/
    config.ts               Env-driven runtime config
    utils.ts                shadcn cn() helper
    api/
      client.ts             apiFetch (credentials: include, typed errors)
      hooks.ts              TanStack Query hooks (mostly hand-typed)
      friendly-errors.ts    ApiError → toast copy with per-code overrides
```

## Mobile-first nav

Desktop gets a top bar with three primary destinations: Halal
claims, Places, Organizations. Mobile gets a fixed bottom tab bar
with the same three (claims / places / orgs) plus iOS safe-area
inset handling so the bar floats above the home indicator. The
single nav surface scales from phone to desktop without a separate
mobile drawer.

The classic admin-panel left rail is intentionally absent here —
owners don't navigate between many internal modules; they're
focused on their restaurants and claims.

## Deployment

Owns its own Vercel project (`trusthalal-owner`), deploys to
`owner.trusthalal.org` once DNS is wired. Production deploys only
trigger on `main`; preview deploys happen for every other branch
and PR.
