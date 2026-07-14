# Closing the lifecycle gap — notifications + trust freshness

## The problem (recap)

The platform records rich trust state (claims, disputes, verifications, cert
expiry) and fires PostHog analytics on every transition — but **nothing
reaches the humans who care**, and **nothing keeps trust from going stale**.
The only emails that exist are the invite and password-reset (both auth
plumbing). There's no background job runner in the API at all.

## Decisions (locked)

- **Job runner:** Render Cron services invoking management scripts for
  scheduled work; **FastAPI background tasks** for instant/reactive sends.
  No Redis, no always-on worker.
- **Channels (v1):** **Email first** (Resend is already wired). In-app feed
  + push are later phases.
- **Sequence:** **Reactive event notifications first**; the freshness engine
  is phase 2.

## Architecture

Two dispatch mechanisms, one dispatch service.

**Reactive (phase 1).** Notifications fire at the existing event chokepoints,
inside the request, via `BackgroundTasks` so the response isn't blocked (same
pattern as the password-reset email). We do NOT scatter `send_email` calls
around — everything goes through one service:

`app/core/notifications.py` → `notify(*, event, recipient, context, background)`
  1. look up the recipient's notification preference for this event (default on),
  2. render + send the email template via `send_email` (Resend),
  3. fire a PostHog `notification_sent` event for observability,
  4. (phase 3) also insert an in-app notification row.

**Scheduled (phase 2).** Time-based work (expiry reminders, staleness sweeps,
digests) runs as Render Cron services calling `python -m scripts.<job>`,
reusing the same `notify()` service. Scripts live next to the existing
`scripts/` (seed_dev, reset_db, export_openapi) so the pattern is familiar.

**Where the deep links point.** Emails link back into the right app using the
origin config we already added for password reset — `OWNER_PORTAL_ORIGIN`,
`CONSUMER_ORIGIN`, `ADMIN_PANEL_ORIGIN`.

## Phase 1 — reactive event notifications

Each event already has a single recorder we can tap. No new event plumbing —
just add a `notify(...)` call next to the existing `track(...)`.

| Event | Hook point (exists today) | Recipient | Why it matters |
|-------|---------------------------|-----------|----------------|
| Claim **approved** | `log_halal_claim_event` (`_CLAIM_EVENT_TRACK`, halal_claims/repo.py) | place owner | "You're live / verified" — the payoff |
| Claim **rejected** | same | place owner | what to fix, how to resubmit |
| Claim **needs more info** | same | place owner | they must act (we just fixed this flow) |
| Dispute **opened** | disputes/repo.py (`track("dispute_opened")`) | place owner | a diner flagged something — respond |
| Dispute **resolved** | `admin_resolve_dispute` (`track("dispute_resolved")`) | reporter (consumer) | outcome of their report |
| Place reaches **Trust Halal Verified** | `derive_profile_from_approved_claim` (halal_profiles/service.py) | consumers who **favorited** the place | delight: "a place you saved is now verified" |
| Verifier application approved/rejected | admin/verifiers/repo.py | applicant | onboarding outcome |
| Verifier visit accepted/rejected | admin/verifiers/visits_repo.py | verifier | their contribution landed |

The "saved place verified" fan-out reads `ConsumerFavorite` rows
(`(user_id, place_id)`) for the place and notifies each saver — this is the
single highest-delight moment in the product and it's currently silent.

**New in phase 1:**

- `app/core/notifications.py` — the dispatch service above.
- Email templates (Jinja pairs, extending `_base`): `claim_approved`,
  `claim_rejected`, `claim_needs_info`, `dispute_opened_owner`,
  `dispute_resolved_reporter`, `place_verified_saver`, and the two verifier
  ones. Each has a single clear CTA deep-linking into the right app.
- `notify(...)` calls added at the eight hook points above.
- **Notification preferences** — a `user_notification_prefs` table (or JSONB
  on `users`) with per-category toggles, plus a **one-click unsubscribe**
  token (reuse the `invite_tokens` hashed-token pattern with a new purpose)
  so every email can carry a working unsubscribe link. Transactional events
  (claim decision, dispute) stay on; promotional-ish ones ("saved place
  verified") are opt-outable — this also keeps us CAN-SPAM clean.
- Tests: each recorder triggers exactly one `notify` per transition; prefs
  suppress correctly; fan-out dedupes; `send_email` no-op mode keeps tests
  green without Resend.

## Phase 2 — the freshness engine (Render cron scripts)

This is the trust-integrity half. Each is a script run on a schedule.

- **`scripts/notify_cert_expiry`** (daily) — certs with
  `certificate_expires_at` in T-30 / T-7 / expired windows → email the owner
  to renew (submit a RENEWAL claim). De-dupes so an owner isn't emailed daily
  for the same window.
- **`scripts/sweep_expired_profiles`** (daily) — flip profiles past expiry to
  the `EXPIRED` status the enum already reserves ("set by a job … the renewal
  cron that lands in a later phase" — this is that job). Surfaces a
  staleness state on the consumer profile instead of showing stale trust.
- **`scripts/notify_stale_verifications`** (weekly) — verifications older than
  N months with no refresh → nudge the owner and/or flag for a re-visit.
- **`scripts/verifier_nearby_digest`** (weekly) — for active verifiers, "N
  unverified places near you need a visit" (uses the existing geo search).
  This is also the verifier-supply growth lever.

Render setup: one Cron service per script (or one dispatcher script with a
`--job` arg), same Docker image + env as the API. Each script opens a normal
`SessionLocal`, does its batch, and exits.

## Phase 3 — in-app feed + push (later)

- `notifications` table (user_id, type, payload, read_at) written by the same
  `notify()` service; a notification center on web + the mobile **Activity**
  tab (already in the mockup, currently "SOON") read from it.
- Expo push for mobile (device-token capture + `expo-server-sdk`) and web
  push. Push reuses the same dispatch service — it becomes another channel
  behind `notify()`, gated by the same preferences.

## Cross-cutting

- **Deliverability:** confirm the `trusthalal.org` sending domain has SPF +
  DKIM verified in Resend before turning volume on, or these land in spam.
- **Idempotency:** reactive sends fire once per transition (inside the
  committing transaction's request); cron jobs track a "last notified" marker
  per (entity, window) so re-runs don't double-send.
- **Preferences + unsubscribe** are a phase-1 requirement, not an
  afterthought — every non-critical email needs a real opt-out.
- **Observability:** every send fires `notification_sent {type, channel}` to
  PostHog so we can see open loops closing on the existing dashboards.

## Build order

1. `notifications.py` dispatch service + `user_notification_prefs` +
   unsubscribe token + one email template end-to-end (claim approved → owner).
2. Remaining phase-1 templates + hook-point `notify(...)` calls + tests.
3. Wire the first Render Cron (cert-expiry reminder) + the `EXPIRED` sweep.
4. Remaining freshness scripts + verifier digest.
5. (Later) in-app feed + Activity tab, then push.

## Open questions

- **Sending domain:** send from `noreply@trusthalal.org` (already the
  `RESEND_FROM_EMAIL` default) — confirm SPF/DKIM are verified in Resend.
- **Owner reachability:** owner accounts are invite-based; confirm we always
  have a good email on the owning org's account for claim/dispute emails.
- **"Saved place verified" scope:** notify on first reach of
  `TRUST_HALAL_VERIFIED` only, or also on `CERTIFICATE_ON_FILE`? (Plan: the
  verified tier only, to keep it a genuine delight moment.)
