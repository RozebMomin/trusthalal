# Trust Halal — Next Phase Roadmap

The through-line for the next six months of building. Three overlapping workstreams (community-first activation → AI-assisted admin → consumer iOS app), one running content thread (buildinpublic vlog + threads).

Locked decisions (from the strategy conversation):

* **Mobile stack:** React Native / Expo. One codebase ships to iOS first, Android when we're ready.
* **AI framing:** Internal admin tool only. Never a user-facing "halal rating." Every trust designation still comes from a human decision.
* **App split:** Consumer iOS ships alone. Admin stays web. Potentially a lightweight verifier field-kit app later.
* **Content cadence:** Weekly YouTube vlog + 2–3 threads/posts per week. Watch closely — drop to bi-weekly if it starts eating shipping time.

---

## Where we are today

Live and functional:

* FastAPI backend on Render at `api.trusthalal.org`
* Consumer PWA at `halalfoodnearme.com`
* Admin panel at `admin.trusthalal.org`
* Owner portal at `owner.trusthalal.org`
* Full halal-claim v2 pipeline (owner submit → admin review → profile derivation → public read)
* Verifier system (applications, visits, admin decisions) — built, not yet publicly activated
* Consumer disputes system
* Email foundation via Resend + Jinja templates
* Admin invite-state + resend flow (just shipped)
* Full marketing package in `/marketing/`

Not yet built or activated:
* Public verifier recruitment flow (system exists in backend; no public front door yet)
* Any AI/ML tooling
* Any native mobile app
* Buildinpublic content infrastructure

---

## Phase 10A — Community-First Activation

**Weeks 1–4. The most important phase. This is where the flywheel starts.**

The verifier system is already built in the backend. What's missing is public activation: recruiting, onboarding, and giving the first cohort of verifiers something meaningful to do. Verifiers create demand pressure that pulls owners in — which is why they come first.

### Goals

* 20–50 verifier applications received in the launch city
* 10–20 verifiers onboarded and active
* First 5–10 verifier visits submitted
* Verifier "nominate a restaurant" feature live → generates prioritized owner outreach list
* Buildinpublic launched with this arc as the anchor story

### Concrete deliverables

* **Public verifier application landing page** on halalfoodnearme.com (`/become-a-verifier`) explaining what it is, what verifiers do, the standard we hold them to, how comped meals are disclosed.
* **Verifier profile pages** — public reviewer pages that verifiers can link to. Shows their approved visits, their disclosure history, an author bio.
* **Trust Halal Verifier badge assets** — a distinct badge (not the same as the restaurant-verified badge) that verifiers can put in their IG bio, link on their food blog, etc.
* **"Nominate a restaurant" feature in the verifier portal** — verifiers pick restaurants they'd like to check. Backend stores nominations; admin queue prioritizes outreach by nomination count.
* **Verifier onboarding email sequence** — welcome, first-visit guidance, what makes a good visit report.
* **Marketing push for verifier recruitment** — use the community-outreach templates in `/marketing/community/` to seed the first wave.

### Ship criteria

* Public can apply through the landing page
* Approved verifiers can log in, browse restaurants, submit visits, view their public profile
* Admin sees nominations as a first-class signal in the review queue
* First 10 verifiers active and posting on social

---

## Phase 10B — AI-Assisted Admin Tools

**Weeks 4–12. Runs mostly in parallel with 10A after week 4.**

Backend work that reduces admin workload and prepares us for scale. Nothing user-facing. Nothing that touches the public trust signal.

### Goals

* Cut admin queue review time per restaurant by ~50%
* Automatically flag inconsistencies before they hit a human reviewer
* Give the admin team a prioritized queue instead of chronological
* Build the internal narrative for buildinpublic — "how I'm using AI without letting it decide halal"

### Concrete deliverables

* **Priority-scoring service** — for every newly-added restaurant, score its "halal likelihood" based on public signals (website language, menu language, Google review mentions, cuisine correlations). Score displayed only in admin queue as a sort key. Never public.
* **Questionnaire consistency flagger** — LLM analyzes owner-submitted questionnaires for internal contradictions ("fully halal menu" + "full bar" + "alcohol used in cooking" = flag). Surfaces to admin as a soft warning.
* **Dispute clustering** — group consumer disputes by attribute + language to detect patterns. Three disputes on the same restaurant mentioning the same supplier = escalation trigger.
* **Cert OCR + extraction** — when a HALAL_CERTIFICATE attachment lands, OCR it, extract the certifying body / cert number / expiry / restaurant name. Auto-populate the admin review form. Human confirms.
* **AI ethics document** — public write-up (published on the site + as a vlog) explaining exactly what AI does and does not do in Trust Halal. Preempts the "your AI decides halal?" backlash.

### Ship criteria

* Priority score visible in admin queue
* Consistency flagger runs on every submission
* Cert OCR auto-populates fields on 80%+ of uploads
* AI ethics doc published

---

## Phase 10C — Consumer iOS App (via React Native / Expo)

**Weeks 8–16. Overlaps with 10B.**

The native app. Faster than the PWA, saved-places sync, push notifications, App Store trust signal. Cross-platform via Expo — same codebase ships to Android later.

### Goals

* Feature parity with the consumer PWA for the core search + place-detail flow
* Sign in with Apple, Google, and email
* Push notifications for saved places and new verified restaurants in the user's area
* Ship to TestFlight by week 12, App Store by week 16
* First 1,000 iOS installs by end of Phase 10

### Concrete deliverables

* **Expo project scaffold** in `apps/mobile/`, wired to the existing API
* **Auth flow** — Sign in with Apple (required for App Store), Google, and email/password
* **Search screen** — the core near-me + query surface, matching the PWA
* **Place detail screen** — halal profile, filters, dispute filing, cert viewer
* **Preferences screen** — saved halal filter defaults (zabihah only, cert on file, no alcohol)
* **Saved / favorites screen** — reuse the existing consumer favorites backend
* **Push notifications** — Expo Push wired to the notification backend; opt-in on first launch
* **App Store submission** — screenshots, description, privacy policy, review notes
* **Analytics** — Expo's analytics or PostHog RN SDK, mirroring the PWA setup

### Ship criteria

* All core flows work end-to-end on iPhone 12–16, iOS 16+
* Sign in with Apple works (App Store requirement)
* First TestFlight build shipped to at least 20 beta testers
* App Store submission accepted on first or second try

---

## Buildinpublic — the running thread

Not a discrete phase. Runs across all of 10A / 10B / 10C.

### Cadence commitments

* **1 YouTube vlog per week** (target: 8–15 min). Content mix: technical progress, strategy explanations, human moments (meeting owners, interviewing verifiers, community events).
* **2–3 threads or posts per week** on Twitter/X. Building the buildinpublic follower base.
* **Short clips repurposed** to IG Reels + TikTok. Same content, format-shifted.

### Content calendar shape

| Phase | Vlog series arcs |
|---|---|
| 10A | "Building the community BEFORE the product." Recruiting verifiers, onboarding the first cohort, showing what a verifier visit actually looks like. |
| 10B | "Using AI without letting AI decide halal." The ethics doc, the priority scorer, the cert OCR. Substantive engineering + values content. |
| 10C | "Shipping the iOS app in the open." Expo build streams, first TestFlight, App Store submission drama, launch day. |
| Ongoing | User stories, owner interviews, guest verifiers, city-launch announcements. |

### Infrastructure to set up

* YouTube channel (matching brand + wordmark)
* Twitter/X account (`@trusthalal` if available)
* IG + TikTok accounts (linked to same brand)
* A simple content calendar (Notion or a Google Sheet)
* A "buildinpublic dashboard" on the site (public metrics: verified restaurants, verifiers, active cities, iOS installs) — this is a great post in itself and doubles as accountability

---

## What's NOT in this phase (deliberately)

* **Android app.** Comes after iOS is validated. Expo makes it a smaller lift.
* **Payments / monetization.** Verification stays free through Phase 10. Featured placement / owner subscriptions land in Phase 11 at earliest.
* **Full admin mobile.** Verifier field-kit app is Phase 11 material.
* **Additional cities.** Focus one launch city hard through Phase 10. Second city in Phase 11.
* **Halal grocery / delivery adjacency.** Tempting scope creep. Not now.

---

## Success criteria for the whole phase (end of month 6)

* At least 50 verified restaurants in the launch city
* 20+ active verifiers with published visit reports
* iOS app live on the App Store
* 1,000+ iOS installs
* 10,000+ monthly active users across web + iOS
* 500+ YouTube subscribers, 2,000+ Twitter followers on the buildinpublic account
* One press hit in Muslim media, one in local food press
* Zero major AI-related trust incidents

---

## Guardrails and escape hatches

* **If a vlog week is unshippable:** post a written thread instead. Never skip completely — the audience notices.
* **If the AI priority scorer produces embarrassing outputs:** kill the feature and vlog the postmortem. That's a strong content piece and a trust deposit.
* **If iOS App Store review rejects the app:** don't panic. Almost every first submission gets rejected for something small. Document the process publicly — it's great content.
* **If verifier recruitment stalls:** the flywheel starts with content, not with the platform. Prioritize the content push over the platform features until you have 10 committed verifiers.

---

## Where the work lives in the repo

```
trusthalal/
├── api/                 # existing backend
├── apps/
│   ├── admin/           # existing admin panel
│   ├── owner/           # existing owner portal
│   ├── consumer/        # existing consumer PWA
│   └── mobile/          # NEW — Expo iOS app (Phase 10C)
├── marketing/           # existing marketing package
├── roadmap/             # this folder
│   ├── README.md        # you are here
│   ├── phase-10a-community.md    # to be added as needed
│   ├── phase-10b-ai.md
│   └── phase-10c-ios.md
└── content/             # NEW — buildinpublic content plan + assets
    ├── youtube/
    ├── twitter/
    └── ethics/
```

---

## Living document

This roadmap will drift as we learn. Revisit at the end of each 4-week phase and update. The values (community-first, human-in-the-loop for trust, no over-promising) stay stable; the tactics move.
