# End-to-End Fix Tracker

A single living punch-list for the whole Trust Halal stack. The goal is to
capture everything during a full end-to-end pass so fixes can be planned and
applied **in one coordinated sweep**, layer by layer, rather than piecemeal.

- **Owner:** Mohamad
- **Status:** open — collecting items
- **Last updated:** 2026-07-11

Related docs: [`observability-and-rate-limits.md`](./observability-and-rate-limits.md),
[`2026-07-05-consumer-design-audit.md`](./2026-07-05-consumer-design-audit.md).

---

## How to use this file

1. During the walkthrough, drop each observation into the section for the app
   or layer it belongs to. Don't stop to fix — just capture.
2. Give each item a short ID (`API-01`, `CON-02`, `MOB-03`, `X-01`…) so it can
   be referenced in a commit message.
3. When it's time to fix, work **one app at a time**, commit per app with the
   item IDs in the message (the same flow used for the security pass), and
   check the box here.

### Legend

**Severity** — `S1` breaks core flow / data / security · `S2` degraded but
usable · `S3` polish / nice-to-have.
**Effort** — `E1` < 1h · `E2` a few hours · `E3` a day+ / needs design.
**Status** — ⬜ open · 🔧 in progress · ✅ done · ⏸️ deferred · ❌ won't fix.

### Entry format

Copy this row into the relevant table:

```
| ID | <what's wrong — one line> | <where: file/route/screen> | S? | E? | ⬜ | <notes / proposed fix> |
```

---

## API — `api/` (FastAPI · PostGIS · Alembic)

Backend correctness, auth, data lifecycle, migrations, rate limits, proxies.

| ID | Issue | Location | Sev | Eff | Status | Notes |
|----|-------|----------|-----|-----|--------|-------|
| API-01 | _e.g. endpoint returns wrong shape_ | `app/modules/...` | S? | E? | ⬜ | |

---

## Consumer — `apps/consumer` (halalfoodnearme.com)

Public discovery site. Search, place detail, verifier profiles, save/favorite,
SEO/metadata, dispute reporting.

| ID | Issue | Location | Sev | Eff | Status | Notes |
|----|-------|----------|-----|-----|--------|-------|
| CON-01 | _e.g. empty state doesn't match design_ | `src/app/...` | S? | E? | ⬜ | |

---

## Brand — `apps/brand` (trusthalal.org)

Marketing / brand landing, ethics page, become-a-verifier pitch.

| ID | Issue | Location | Sev | Eff | Status | Notes |
|----|-------|----------|-----|-----|--------|-------|
| BRD-01 | | `src/app/...` | S? | E? | ⬜ | |

---

## Owner — `apps/owner` (owner.trusthalal.org)

Restaurant-owner portal. Claim flow, org membership, dispute responses.

| ID | Issue | Location | Sev | Eff | Status | Notes |
|----|-------|----------|-----|-----|--------|-------|
| OWN-01 | Landing on the page after login, the recent places results is not clickable, it should take the user directly to their place details | <where: file/route/screen> | S? | E? | ⬜ | <notes / proposed fix> |

---

## Admin — `apps/admin`

Internal moderation. Place ingest, claim review, org verification, user CRUD.

| ID | Issue | Location | Sev | Eff | Status | Notes |
|----|-------|----------|-----|-----|--------|-------|
| ADM-01 | | `src/app/...` | S? | E? | ⬜ | |

---

## Mobile — `apps/mobile` (Expo · React Native)

Consumer iOS/Android app. Auth, explore/map, place detail, saved, profile,
become-a-verifier, deep links, permissions.

| ID | Issue | Location | Sev | Eff | Status | Notes |
|----|-------|----------|-----|-----|--------|-------|
| MOB-01 | | `app/...` / `src/...` | S? | E? | ⬜ | |

---

## Cross-cutting — data, config, deploy, third-party

Things that span repos: DB/schema, secrets & env, CI/CD, hosting (Render /
Vercel / Supabase), Google Cloud, observability (Sentry / PostHog), universal
links, and anything that has to be changed in more than one place at once.

| ID | Issue | Area | Sev | Eff | Status | Notes |
|----|-------|------|-----|-----|--------|-------|
| X-01 | | | S? | E? | ⬜ | |

---

## Carried over — known-open from prior passes

Pre-seeded so they don't get lost. From the 2026-07-11 security remediation
pass and billing check — mostly items that need action **outside the code** or
a follow-up verification.

| ID | Issue | Area | Sev | Eff | Status | Notes |
|----|-------|------|-----|-----|--------|-------|
| X-SEC-1 | Report-only CSP on consumer / owner / admin needs promotion to enforcing | consumer, owner, admin `next.config.mjs` | S2 | E1 | ⬜ | Watch the console/Sentry CSP reports first, then rename `Content-Security-Policy-Report-Only` → `Content-Security-Policy`. Brand is already enforcing. |
| X-SEC-2 | Confirm Render runs uvicorn with `--proxy-headers` + `--forwarded-allow-ips` scoped to the Render edge | Render service config | S2 | E1 | ⬜ | Without it, per-IP rate limits collapse to the proxy IP (login-lockout DoS) or become spoofable. Start command lives in the Render dashboard, not the repo. |
| X-SEC-3 | Rotate the Supabase service-role key + split dev/prod Google keys | `api/.env` (local), Google Cloud, Supabase | S2 | E2 | ⬜ | Live service-role key sits in plaintext on the dev laptop (never committed). Use a separate Supabase project/scoped key for local dev; verify Google server key is IP-restricted to the API. |
| X-SEC-4 | Add CI with automated secret + dependency scanning | repo (`.github/workflows`) | S3 | E2 | ⬜ | No CI exists yet. When added: pinned actions running gitleaks + `pip-audit` / `npm audit`. |
| X-BILL-1 | Verify Maps JavaScript API (browser key) renders in admin | admin panel + Google Cloud | S2 | E1 | ⬜ | Server-side Geocoding/Places confirmed live 2026-07-11. Browser key is separate — load an admin map, check for `BillingNotEnabledMapError` / grey watermarked map. |
| X-BILL-2 | Verify Cloud Vision SafeSearch on photo upload | owner/admin photo flow | S2 | E1 | ⬜ | Behind auth, couldn't smoke-test remotely. Upload one test photo; a Vision billing lapse fails the moderation step rather than saving. |

---

## Fix-sweep log

Record each coordinated fix pass here as it lands.

| Date | Scope | Commits | Notes |
|------|-------|---------|-------|
| 2026-07-11 | Security remediations (all apps) | `b27e39b`…`de0795f` | JSON-LD XSS escape, security headers/CSP, mobile fixture gating + token hardening, API hardening (X-Role removal, refresh lock, ILIKE escape, CORS guard), gitignore. |
