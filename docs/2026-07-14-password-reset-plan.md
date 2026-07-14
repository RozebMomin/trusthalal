# Forgot-password across all Trust Halal domains — implementation plan

## Goal

Add self-service **"Forgot password"** to every surface that has a
password login: the consumer site, the owner portal, the admin panel, and
the mobile app. Today there is no self-service reset — a locked-out user
must be manually re-invited by an admin (the existing invite /
`set-password` flow doubles as the reset path). This plan closes that gap
with a dedicated, secure reset flow and per-domain links.

## What already exists (reused, not rebuilt)

- **Email delivery** — Resend, via `app/core/email.py`, with Jinja
  templates in `app/emails/templates/` (`_base.html.jinja` +
  `_base.txt.jinja`). Config: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
  (`Trust Halal <noreply@trusthalal.org>`), `RESEND_REPLY_TO`.
- **A token → set-password pattern** — `auth_invite_tokens`,
  `invite_repo`, `POST /auth/set-password`, `GET /auth/invite/{token}`,
  and a `/set-password` page. We mirror this shape for reset but keep it
  a **separate** token type (different semantics + TTL).
- **Auth model** — session cookies for web (consumer/owner/admin),
  mobile tokens for the app, hashed passwords on `users`.

## The core gap: per-domain origins

The API only knows one frontend origin today — `ADMIN_PANEL_ORIGIN`
(default `http://localhost:3001`) — and every invite link points there.
Reset links must land on the **right domain per audience**, so we add a
small, allowlisted origin map in config. The requesting app declares its
audience; the API maps that to a configured origin and builds the link.
The client never supplies a raw URL (prevents open-redirect abuse).

| Audience   | App              | Reset page origin (config)        | Request page        | Reset page          |
|------------|------------------|-----------------------------------|---------------------|---------------------|
| `consumer` | halalfoodnearme  | `CONSUMER_ORIGIN`                 | `/forgot-password`  | `/reset-password`   |
| `owner`    | owner portal     | `OWNER_PORTAL_ORIGIN`             | `/forgot-password`  | `/reset-password`   |
| `admin`    | admin panel      | `ADMIN_PANEL_ORIGIN` (exists)     | `/forgot-password`  | `/reset-password`   |
| mobile     | Expo app         | → uses `CONSUMER_ORIGIN` page     | in-app email screen | web `/reset-password` |

Mobile users are consumers, so the mobile flow reuses the **consumer**
web reset page — no deep-link/universal-link setup needed for v1.

## API design

### New table — `password_reset_tokens`

Separate from invites. Store only a **hash** of the token (never the raw
value), same posture as the invite tokens.

- `id` (uuid, pk)
- `user_id` (uuid, fk → app.users, on delete cascade, indexed)
- `token_hash` (text, unique) — SHA-256 of the random token
- `audience` (text) — `consumer` | `owner` | `admin` (which app's page the
  email linked to; useful for auditing, not trusted for routing at redeem)
- `created_at`, `expires_at` (timestamptz), `used_at` (nullable)

TTL: **1 hour** (`PASSWORD_RESET_TTL_MINUTES`, default 60) — short, unlike
the 7-day invite TTL.

### Config additions (`app/core/config.py`)

```
CONSUMER_ORIGIN: str = "http://localhost:3003"
OWNER_PORTAL_ORIGIN: str = "http://localhost:3002"   # confirm prod domain
# ADMIN_PANEL_ORIGIN already exists (3001)
PASSWORD_RESET_TTL_MINUTES: int = 60
```

A single `_reset_origin_for(audience)` helper maps audience → origin from
this allowlist; unknown audience → 400.

### Endpoints (`app/modules/auth/router.py`)

1. **`POST /auth/forgot-password`** — body `{ email, audience }`.
   - **Always returns 200** with a generic "if an account exists, we sent
     a link" message — no user enumeration.
   - If a matching **active** user exists: mint a token, store its hash,
     send the reset email with `{origin}/reset-password?token=<raw>`.
   - Rate-limited per IP **and** per email (e.g. 5/hour each) via the
     existing `app/core/rate_limit.py`.
   - Best-effort send: a Resend outage is logged, response unchanged.

2. **`GET /auth/reset/{token}`** — prefetch for the reset page.
   - Returns the masked email (e.g. `m•••@gmail.com`) + display name so
     the page can show "Resetting password for …", mirroring
     `GET /auth/invite/{token}`.
   - 404 (generic message) on invalid / expired / already-used.

3. **`POST /auth/reset-password`** — body `{ token, new_password }`.
   - Resolve + validate token; enforce password policy (reuse signup
     validation).
   - Set the new password, **consume the token** (`used_at = now()`).
   - **Invalidate all existing sessions + mobile tokens** for that user
     (force re-login everywhere — standard reset hygiene).
   - Do **not** auto-login. Return success; the page routes to `/login`.
     Mobile: user returns to the app and signs in with the new password.

### Email template

New `password_reset.html.jinja` + `.txt.jinja` extending `_base`, with a
single primary CTA button to the reset URL, the 1-hour expiry, and a
"didn't request this? ignore it" line. Same voice as the existing invite
email.

## Frontend work (per web app)

Each of consumer / owner / admin gets two small pages plus one link:

- **`/forgot-password`** — email field → `POST /auth/forgot-password`
  with its own `audience`. Always shows the same "check your inbox"
  confirmation regardless of whether the email exists.
- **`/reset-password`** — reads `?token=`, calls `GET /auth/reset/{token}`
  for context, takes new password + confirm → `POST /auth/reset-password`,
  then redirects to `/login` with a success toast.
- **"Forgot password?"** link on each app's existing `/login` page.

These are near-identical across the three apps; build once on consumer,
copy to owner + admin with the audience swapped.

## Mobile flow

- Add **"Forgot password?"** under the sign-in form.
- Tapping it opens an in-app **email-entry screen** that calls
  `POST /auth/forgot-password` with `audience: "consumer"`, then shows
  "Check your email."
- The emailed link opens the **consumer web** `/reset-password` page in the
  browser; after resetting, the user returns to the app and signs in.
- No deep links for v1. (A future iteration could add a universal link
  straight into the app or an in-app OTP code — noted, not built now.)

## Security checklist

- No user enumeration: identical response + timing for known/unknown
  emails on `forgot-password`.
- Tokens: 256-bit random, stored hashed, single-use, 1-hour TTL.
- Audience → origin from an **allowlist** only; never redirect to a
  client-supplied URL.
- On successful reset: revoke all sessions + mobile tokens.
- Rate-limit `forgot-password` per IP and per email; light limit on
  `reset-password` per IP.
- Reset works for invite-based accounts that never set a password too
  (acts as a first-time set) — no separate path needed.

## Build order

1. **API** — migration for `password_reset_tokens`; config origins + TTL;
   the three endpoints; reset email template; rate limits; session
   invalidation; unit tests (lifecycle, enumeration silence, expiry,
   single-use, session revocation).
2. **Consumer web** — the two pages + login link (reference implementation).
3. **Owner portal** — copy pages, `audience: "owner"`.
4. **Admin panel** — copy pages, `audience: "admin"`.
5. **Mobile** — forgot-password entry screen + link.
6. **Env** — set `CONSUMER_ORIGIN`, `OWNER_PORTAL_ORIGIN` (confirm prod
   domains) on Render; verify `RESEND_*` are live.

## Open questions to confirm before building

- **Owner portal production domain/origin** — `OWNER_PORTAL_ORIGIN` value
  (e.g. `owner.trusthalal.org`?). Admin + consumer origins are known.
- **Password policy** — reuse the exact signup rules (min length, etc.);
  confirm they're centralized so reset and signup can't drift.
- **Admin resets** — keep the existing admin re-invite too, or fully
  replace it with self-service? (Plan keeps both; re-invite stays as a
  staff tool.)
