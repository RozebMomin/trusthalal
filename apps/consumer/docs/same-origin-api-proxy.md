# Consumer auth: same-origin API proxy

**Status:** in effect since commit `d854348` (2026-07).
**Applies to:** `apps/consumer` (halalfoodnearme.com).

## The problem this solves

The consumer site is served from **`halalfoodnearme.com`**, but the API is on
**`api.trusthalal.org`**. Those are two different *registrable domains*.

The API authenticates web clients with an HttpOnly `tht_session` cookie set
`SameSite=Lax` (`api/app/modules/auth/router.py`). A `SameSite=Lax` cookie is
only sent on same-site requests and top-level navigations. From
`halalfoodnearme.com`, a `fetch()` to `api.trusthalal.org` is **cross-site**, so
the cookie was never sent. Symptom: sign-in appeared to succeed, the very next
`GET /me` came back unauthenticated, and any authed action (e.g. saving a
favorite) bounced the user to the login screen.

The owner portal (`owner.trusthalal.org`) never hit this because it shares the
`trusthalal.org` registrable domain with the API — same-site.

## How it works now

The browser never talks to `api.trusthalal.org` directly. Instead:

1. **Browser → same origin.** `apiFetch` (`src/lib/api/client.ts`) builds URLs
   against `window.location.origin` under an `/api` prefix, e.g.
   `https://halalfoodnearme.com/api/auth/login`.
2. **Next rewrite proxies to the API.** `next.config.mjs` `rewrites()` maps
   `/api/:path*` → `${API_ORIGIN}/:path*` (server-to-server). Next relays the
   request Cookie header out and the response `Set-Cookie` back.
3. **Cookie becomes first-party.** Because the browser sees the response as
   coming from `halalfoodnearme.com` and the API cookie is *host-only* (no
   explicit `Domain`), the browser scopes `tht_session` to the consumer domain.
   Subsequent `/api/*` calls are same-origin, so `SameSite=Lax` sends it. Works
   in every browser, Safari/iOS included (no third-party-cookie reliance).

## Caveats — read before changing consumer routing or auth

- **`/api/*` is reserved for the API proxy.** Do **not** add Next Route Handlers
  under `app/api/` — they would shadow or collide with the proxy. If the
  consumer ever needs its own server endpoints, use a different prefix
  (e.g. `/_actions/*`) and leave `/api/*` to the proxy.
- **Requires `NEXT_PUBLIC_API_BASE_URL` in the consumer's Vercel env.** It's a
  build-time value that drives BOTH the rewrite `destination` and the CSP
  `connect-src`. If it's missing/wrong, the proxy points at the wrong place.
- **The rewrite target is baked at build time.** If the API origin ever changes,
  **redeploy the consumer** — a running build won't pick up a new value.
- **Keep the API cookie host-only + `SameSite=Lax`.** Do not add an explicit
  `Domain=` to `tht_session`, or it won't rescope to the consumer domain through
  the proxy. `SameSite=None` is *not* needed and should be avoided (Safari/ITP
  blocks third-party cookies regardless).
- **SSR `serverFetch` is unaffected.** `src/lib/api/server.ts` calls the API
  directly for *anonymous* reads (metadata/sitemap/robots) only; it carries no
  auth and does not go through the proxy. Don't route authed SSR through it.
- **Any future consumer-facing app on a different registrable domain than the
  API needs this same pattern** (or a shared parent domain). The mobile app
  sidesteps it entirely by using bearer tokens instead of cookies.

## Quick verification after deploy

1. Sign in on `halalfoodnearme.com`; confirm you stay signed in.
2. Save a favorite — it should persist, not redirect to login.
3. DevTools → Network: auth calls go to `halalfoodnearme.com/api/...`
   (same-origin), and `tht_session` is set on the `halalfoodnearme.com` domain.
