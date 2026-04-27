# Observability and rate limits

This document covers the two operational add-ons wired up alongside
the alpha-to-beta hardening pass: Sentry (error + perf) on all three
surfaces, and rate limiting on the FastAPI side.

Both default to off in local dev (no Sentry DSN, in-memory rate
counters that reset on restart) so you can run the stack the same way
you always have. Turning them on for an environment is a matter of
filling in env vars on the platform that runs that environment.

## Sentry — what gets captured

| Surface       | Captures                                          | DSN env var                |
| ------------- | ------------------------------------------------- | -------------------------- |
| `api`         | Server-side exceptions, slow SQL, request traces  | `SENTRY_DSN`               |
| `apps/admin`  | Browser errors, failed fetch breadcrumbs, perf    | `NEXT_PUBLIC_SENTRY_DSN`   |
| `apps/owner`  | Browser errors, failed fetch breadcrumbs, perf    | `NEXT_PUBLIC_SENTRY_DSN`   |

Every server response carries an `X-Request-ID` header. The browser
SDKs read it on each response and tag the next Sentry event with
`last_request_id`; the FastAPI middleware attaches the same value as
`request_id` on its own scope. Same value, two tag names — searchable
across browser + server in the issues UI.

PII is off by default and an extra scrub strips `Authorization`,
`Cookie`, `Set-Cookie`, and `X-User-Id` from any event headers before
send.

### Setting it up

1. Sign up at sentry.io. Free tier handles ~5k errors / month per
   project, fine for alpha + most of beta.
2. Create three projects (or one if you don't want to split them):
   `trusthalal-api`, `trusthalal-admin`, `trusthalal-owner`.
3. Drop each project's DSN into the appropriate env var on the
   platform that runs that surface:
   * **Render** (api): `SENTRY_DSN`, `APP_ENV=production`,
     `SENTRY_TRACES_SAMPLE_RATE=0.1`. Render auto-populates
     `RENDER_GIT_COMMIT` which the SDK reads as the release.
   * **Vercel** (admin): `NEXT_PUBLIC_SENTRY_DSN`,
     `NEXT_PUBLIC_APP_ENV=production`,
     `NEXT_PUBLIC_APP_RELEASE_SHA=$VERCEL_GIT_COMMIT_SHA`.
   * **Vercel** (owner): same shape as admin.
4. (Optional, recommended) Wire source-map upload from Vercel builds
   so stack traces are demangled. Set `SENTRY_ORG`, `SENTRY_PROJECT`,
   and `SENTRY_AUTH_TOKEN` on each Vercel project. The wrapper auto-
   skips upload when `SENTRY_AUTH_TOKEN` is empty, so leaving these
   off just gives you minified frames in the issues UI.

### Verifying after deploy

* Hit a route that should 500 — for example, in dev tools force a
  failed `fetch('/me')` while logged out. The error should appear
  in Sentry within ~30s with `last_request_id` set.
* Check the FastAPI side from the Render logs — you should see
  `Sentry initialized: env=...` on boot.

## Rate limits — what's protected

All limits live in `api/app/core/rate_limit.py`. Two key strategies:

* **Per-IP** — for unauthenticated or pre-auth endpoints. Uses
  client IP as the bucket.
* **Per-session** — for authenticated owner endpoints. Buckets on
  the session cookie value so users behind a NAT (an office, a
  coffee shop) don't burn each other's quota.

Current limits (subject to tuning):

| Endpoint                                          | Limit                       | Bucket  |
| ------------------------------------------------- | --------------------------- | ------- |
| `POST /auth/signup`                               | 5/min, 20/hr                | IP      |
| `POST /auth/login`                                | 10/min, 100/hr              | IP      |
| `POST /auth/logout`                               | 30/min                      | IP      |
| `GET /auth/invite/{token}`                        | 30/min                      | IP      |
| `POST /auth/set-password`                         | 10/min, 50/hr               | IP      |
| `GET /places/google/autocomplete`                 | 30/min, 300/hr              | IP      |
| `POST /me/organizations`                          | 10/hr                       | Session |
| `POST /me/organizations/{id}/submit`              | 10/hr                       | Session |
| `POST /me/organizations/{id}/attachments`         | 60/hr                       | Session |
| `POST /me/ownership-requests`                     | 20/hr                       | Session |
| `POST /me/ownership-requests/{id}/attachments`    | 60/hr                       | Session |

When a request is throttled the API returns 429 with the standard
error envelope:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "You've sent too many requests. Please slow down and try again in a moment.",
    "detail": { "limit": "5 per 1 minute" }
  }
}
```

Frontends already handle this code via `friendlyApiError` — the user
sees a "slow down, try again" toast.

### In-memory vs Redis

Counters live in-process on the FastAPI worker. That's fine while
we're on a single Render instance; limits reset on every deploy.

To swap to Redis (when scaling out, or when you want limits to
survive deploys):

1. Provision a Redis instance (Render add-on or Upstash).
2. Set `RATE_LIMIT_REDIS_URL=redis://default:pass@host:6379/0` in
   the API's env.
3. Redeploy. No code change.

### Tuning the limits

Edit the `@limiter.limit("...")` decorators in the route files. The
syntax is `count/period` where period is `second`, `minute`, `hour`,
or `day`. Stack multiple decorators on a single endpoint to enforce
short + long windows (we already do this on `/auth/login`).

If you want to whitelist an internal load-balancer or ops tooling,
the cleanest path is a small middleware that sets
`request.state.limiter_skip = True` and a custom `key_func` that
returns a sentinel for those keys. Not wired today — add when
needed.
