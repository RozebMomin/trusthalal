# Phase 11 — Analytics & Restaurant Monetization

**Status: planned (post-v1). Not built.** This captures the game plan now so the
one time-sensitive piece — event instrumentation — doesn't get skipped at
launch. Everything else here is deliberately deferred.

---

## The hard line (non-negotiable)

**Verification is never for sale.** No restaurant can pay for a higher
verification tier, the "✓ Verified halal" signal, a certificate status, better
organic trust ranking, or any trust designation. Verification is earned through
the human verifier pipeline, full stop.

Money buys **reach and marketing tools** — never **trust**. The moment a diner
suspects the badge can be bought, the platform is worth nothing, and there's no
revenue stream worth that. Every decision in this phase is subordinate to this
line. If a monetization idea can't be built without touching the trust signal,
it doesn't get built.

---

## Why now / why not now

- **The insights dashboard and monetization are Phase 11.** Correct to defer —
  they need users, data, and a validated verifier flywheel first.
- **Event instrumentation ships with v1.** Analytics events are cheap to add and
  impossible to backfill. The per-restaurant reach data we'll put in front of an
  owner in month six only exists if we capture it from launch day. So the
  *product* waits; the *tracking* does not. This is the single thing to pull
  forward.

---

## Where we already are

- **Consumer web:** PostHog is wired — `apps/consumer/src/lib/analytics.ts`
  exposes a `capture()` helper; pageviews + user `identify` are live. Adding
  product events is just calling the helper at the right spots.
- **Mobile:** PostHog is **not** wired yet — the main instrumentation gap.
  Autocapture must be OFF (RN autocapture is a firehose); explicit events only.
- **Sentry:** errors only, both surfaces. Not a product-analytics tool.

---

## Two audiences, one dataset

The same events serve both:

1. **Our growth analytics** — what converts, which cuisines/cities show demand,
   where the funnel leaks, what search terms return nothing (supply gaps).
2. **The per-restaurant rollup** — the sales product: a reach report we can hand
   an owner. This is the collateral for the pitch.

---

## Event taxonomy (instrument at/near launch)

| Event | Key properties | Why it matters |
|-------|----------------|----------------|
| `search_executed` | query, filters, cuisine, location, result_count | Demand + supply-gap signal |
| `place_impression` | place_id, **rank/position**, surface (list/map), search_id | **Load-bearing.** How we later say "your restaurant got N impressions." Log at result-render time — cannot be reconstructed later. |
| `place_viewed` | place_id, source (search/map/link) | The "clicks" — profile opens |
| `place_action` | place_id, action (directions/call/website/share) | High-intent; owners care most about these |
| `favorite_added` / `favorite_removed` | place_id | Saves = warm interest |
| `dispute_filed` | place_id, attributes | Funnel glue + integrity signal |
| `sign_up` / `sign_in` | method | Attribution + identify |

Naming: `snake_case`, past-tense, one taxonomy shared verbatim across web +
mobile so the two surfaces aggregate cleanly.

---

## The per-restaurant metric model (the sales product)

For any listing, over a time window:

- Impressions (appeared in results/map)
- Profile views + view-through rate (views ÷ impressions)
- Saves / favorites
- Actions: directions, website, call, share
- Top search terms that surfaced it
- Trend vs the prior period

This is essentially what Google Business Profile / Yelp show owners — a familiar,
credible frame. The pitch writes itself: *"Here's your reach on Trust Halal last
month. A featured plan puts you in front of Nx more of these diners."*

---

## What IS for sale (Phase 11+ candidates)

- **Promoted / featured placement** — clearly labeled "Promoted", never mixed
  unlabeled into organic trust ranking.
- **Enhanced profile** — photos, story, hours, menu links, offers/specials.
- **Category / cuisine sponsorship** — top-of-cuisine slot, labeled.
- **Reach + insights dashboard** — a paid owner tier over the metric model above.
- **Offers / lead-gen to diners** — coupons, "mention Trust Halal," etc.

## What is NEVER for sale

- The verification tier or the ✓ Verified halal signal
- Certificate or claim status
- Position in **organic** trust ranking (promoted slots are separate + labeled)
- Suppression, removal, or outcome of any consumer dispute

---

## Trust firewall (guardrails)

- **Hard code separation** between billing/marketing and the verification
  pipeline. There is no code path where a payment can read or write a tier.
- **Paid status is invisible** to verifiers and admins reviewing a claim — no
  bias, conscious or otherwise.
- **Promoted placement is always visually labeled** and disclosed, same DNA as
  "every paid meal disclosed."
- **Disputes are never suppressible** by payment.
- Consistent with `content/ethics/ai-ethics.md` and the independence posture. If
  in doubt, the trust layer wins over the revenue line.

---

## Privacy / consent

- PostHog **autocapture off**; explicit events only.
- **No PII in event properties** — reference users by id, not name/email.
- Per-restaurant metrics are **aggregate** (about the listing's reach, not
  identifying individual diners).
- Honor a user-level analytics opt-out; consent posture per GDPR/CCPA as the
  audience warrants.

---

## Instrument-early checklist (pull into pre-launch / v1)

- [ ] Finalize the event taxonomy + naming convention (this table)
- [ ] Web: add `capture()` calls for `search_executed`, `place_impression`,
      `place_viewed`, `place_action`, `favorite_added/removed`
- [ ] Confirm `place_impression` logs `place_id` + `rank` at render
- [ ] Mobile: wire PostHog RN SDK, autocapture off, mirror the web events 1:1
- [ ] `identify()` on sign-in **and** on app-launch-with-existing-token (both
      surfaces) so signed-in users don't show up as anonymous
- [ ] Verify no PII leaks into event properties

---

## Open questions (decide closer to Phase 11)

- Owner-facing insights: extend the existing owner portal, or a new surface?
- Rollup engine: PostHog cohorts/insights, or query the API's Postgres directly
  for owner-facing reports?
- Pricing model: flat subscription vs promoted-placement (CPM/CPC) vs hybrid.
- Which single metric headlines the pitch — impressions, profile views, or
  direction taps?

---

## Success criteria (when we build it)

- A clean per-restaurant reach report is generatable for any listing.
- First paying restaurant onboarded with **zero** compromise to verification
  integrity — the firewall holds under real revenue pressure.
