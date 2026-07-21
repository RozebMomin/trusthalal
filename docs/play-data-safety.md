# Google Play — Data safety answers

The Play Console questionnaire is a legal declaration, and the console gives
you no record of *why* each answer is what it is. This file is that record.
Keep it current: if the app starts collecting something new, this file and the
console both change, and so does Apple's App Privacy.

Every answer below is traced to code. Where an answer is a judgement rather
than a fact, it says so.

**Cross-check:** Apple's App Privacy is already published and declares nine
data types. This maps onto that deliberately — two stores disagreeing about
what one app collects is itself a red flag.

---

## Steps 1–3 (already entered and saved)

| Question | Answer | Why |
|---|---|---|
| Collects or shares required data types | **Yes** | Email, location, photos, analytics |
| All data encrypted in transit | **Yes** | `apiBaseUrl` is `https://api.trusthalal.org`; Supabase storage, Sentry and PostHog are all HTTPS. No cleartext endpoint anywhere |
| Account creation methods | **Username and password** | Email + password only. Apple/Google sign-in was removed in `cd58cba`; re-check this box if it returns |
| Delete account URL | `https://trusthalal.org/delete-account` | Built in `fd12286` because Play requires a page reachable after uninstall |

### Data types selected (11)

| Category | Selected | Source in code |
|---|---|---|
| Location | Approximate, Precise | `expo-location`, `locationWhenInUsePermission` in `app.json` |
| Personal info | Name, Email address, User IDs | `display_name` + `email` at signup; `User.id` |
| Photos and videos | Photos | review photo upload, `PlacePhoto` |
| App activity | App interactions, Other user-generated content | PostHog `capture()`; reviews |
| App info and performance | Crash logs, Diagnostics | `Sentry.init` with `tracesSampleRate: 0.2` |
| Device or other IDs | Device or other IDs | Expo push token (`getExpoPushTokenAsync`), PostHog `distinct_id` |

### Deliberately NOT selected

- **In-app search history.** `search_performed` captures `query_len` — the
  *length* of the query, never its text. Verified in `src/lib/analytics.ts`
  call sites. Nothing server-side stores queries; there is no search-history
  table.
- **Political or religious beliefs.** Stored preferences are `no_pork`,
  `no_alcohol_served`, `min_validation_tier`, `min_menu_posture`,
  `has_certification` — attributes of *restaurants* the user wants filtered,
  not statements about the user. The app never asks anyone's religion, and a
  non-Muslim avoiding pork sets identical flags. **This is a judgement call**,
  decided 2026-07-21. It is the one answer here worth putting to counsel
  alongside the terms review.
- Financial info, Health and fitness, Messages, Audio, Files and docs,
  Calendar, Contacts, Web browsing, Installed apps, Videos — none collected.

---

## Step 4 — Data usage and handling

Answer these for each of the 11 types. Three answers are the same every time:

**Collected: Yes. Shared: No. Processed ephemerally: No.**

> **Why "Shared: No" for all of it.** Play defines shared as transferred to a
> third party, and exempts transfers to a service provider processing on your
> behalf. Sentry, PostHog, Supabase and Resend are all service providers under
> contract, not recipients using the data for their own ends. Nothing is sold,
> and nothing goes to advertisers or data brokers. **This is a judgement call**
> — a defensible and standard one, but if any of those vendors is ever used
> for its own purposes rather than ours, this answer changes.

Then, per type:

| Data type | Required or optional | Purposes |
|---|---|---|
| Approximate location | **Optional** — app works without it; you can search a city by name | App functionality, Personalisation |
| Precise location | **Optional** — permission is `WhenInUse` and declinable | App functionality, Personalisation |
| Name | **Required** — `display_name` is mandatory at signup | App functionality (shown on your reviews) |
| Email address | **Required** — it is the login identifier | App functionality, Account management |
| User IDs | **Required** — issued by us, not supplied | App functionality, Account management |
| Photos | **Optional** — reviews post fine without them | App functionality |
| App interactions | **Required** — PostHog has no in-app opt-out today | Analytics |
| Other user-generated content | **Optional** — nobody has to write a review | App functionality |
| Crash logs | **Required** — Sentry has no in-app opt-out today | Analytics *(Play does not offer a "crash reporting" purpose; Analytics is the correct bucket)* |
| Diagnostics | **Required** — same | Analytics |
| Device or other IDs | **Optional** — push token only exists if notifications are granted | App functionality *(notification delivery)* |

### The two "Required" answers worth revisiting

App interactions and Crash logs are marked Required only because there is no
user-facing analytics opt-out. That is an accurate description of today's
build, not a good end state — an opt-out in Profile would let both become
Optional and is a better position for a product that leans on trust.

---

## Not part of Data safety, but blocking release

Play will not grant production access until a **closed test** has run and met
its criteria. The console states this plainly on the dashboard; closed testing
is locked until app setup is finished. iOS can go to review immediately;
Android cannot. Plan the launch dates apart.
