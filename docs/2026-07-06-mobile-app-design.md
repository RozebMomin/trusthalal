# Trust Halal Mobile — Consumer App Design

**Status:** Draft for review · design only, no implementation yet
**Scope:** Consumer-facing app (diners + verifier mode). No admin, no owner features — those stay on desktop web.
**Platform posture:** iOS + Android from one codebase (React Native / Expo fits the existing TypeScript stack). Designed to cross-platform conventions with minor per-platform adaptations.
**Backend:** The existing `halaltrust-api` (FastAPI) serves everything; the app is a new client, not a new backend.

---

## 1. Why a mobile app (and why now)

The consumer web app answers "where can I eat halal near me?" — but the moment that question gets asked is almost always on a phone, standing on a sidewalk or riding in a car. A native app earns its place over the mobile web with exactly four things:

1. **Instant location** — no permission-prompt-per-session; open the app, see what's around you in under two seconds.
2. **The pocket verifier kit** — filing a visit report *from the restaurant table*, with camera-native photo evidence, is the single strongest mobile use case in the whole platform. Today verifiers have to remember to do it later on a laptop.
3. **Push that matters** — "a place you saved just earned Verified halal," "your dispute was upheld," "your visit report was accepted." Low volume, high trust-relevance.
4. **Offline memory** — your saved places, with their halal profiles, cached on device. Airport mode, foreign SIM, basement food court: your list still works.

Everything else (search UX, tier language, filters) deliberately mirrors the web so the two surfaces feel like one product.

## 2. Scope

**In:** near-me + city search, name search scoped to location, filters (tiers / menu coverage / cuisines / dietary), place detail with full halal profile + evidence + photos, directions handoff, saved places (offline-capable), search preferences, dispute filing with camera evidence, dispute status tracking, account (signup/login), verifier mode (apply, file visits with photos + paid-meal disclosure, track visit status, public verifier profile), push notifications, share.

**Out (stays on desktop web):** all admin review queues, owner portal (claims, org management, photo management), verifier *application review*, analytics dashboards. The app links owners out to `owner.trusthalal.org` in exactly one place (place detail → "Own this restaurant?").

## 3. Product principles

1. **Trust is the interface.** The tier pill (muted → slate → amber → olive) is the most important pixel on every screen. Never let decoration outrank it.
2. **Two taps to dinner.** Open → see nearby verified places → tap one → directions. Every added step needs a reason.
3. **Honest beats polished.** "No halal info yet" is shown proudly, not hidden. Empty states explain coverage honestly and offer recovery.
4. **The verifier is a diner with a superpower.** Verifier mode is layered onto the consumer app, not a separate app. Same account, same brand, one extra tab.
5. **Same words everywhere.** Tier names, posture labels, dispute language — identical strings to the web (`halal-display.ts` is the shared vocabulary).

## 4. Information architecture

Bottom tab bar (the app's spine):

| Tab | Icon | Who sees it | Purpose |
|---|---|---|---|
| **Explore** | compass | everyone | Near-me discovery, search, filters, results, map toggle |
| **Saved** | heart | everyone | Favorites, offline-cached, grouped by city |
| **Verify** | check-badge | approved verifiers only | Visit drafts, file a visit, my visits, public profile |
| **Activity** | bell | everyone | Dispute status, saved-place changes, visit outcomes |
| **Profile** | person | everyone | Account, search preferences, verifier application entry, about/ethics |

Diners see 4 tabs; an approved verifier's account unlocks the 5th (server-driven by `role`/application status — no app update needed). Anonymous users can use Explore fully; Saved/Activity/Verify show sign-in gates with the same warm pitch the web uses.

Modality rules: filters, location picker, and dispute filing are bottom sheets; the visit report is a full-screen multi-step flow (it's a task, not a peek); place detail is a push on the Explore/Saved stacks.

## 5. Key flows

### 5.1 First run
Three light screens, skippable: (1) brand + one-liner "Verified halal, no guesswork," (2) tier explainer — the three pills with one line each, (3) location permission **priming screen** ("We use your location to find halal spots within a few miles. Only while you're using the app.") → OS prompt. Denial is a first-class path: fall straight into the city picker (same curated list as web via `lib/cities` + forward-geocode proxy). No forced signup.

### 5.2 Find food (the golden path)
Explore opens on nearby results immediately (last known location, radius default 5 mi). Sticky top: search field ("Name or dish…") + location pill ("5 mi around Atlanta, GA") + filter button with count badge. Typing a name keeps the location scope (the API combines `q` + geo). Results are the same trust-first cards as web: tier pill top-right, distance, cuisine chips, fact chips. A map/list toggle sits above the results (map is P1, list ships first). Tap → Place detail → primary action bar: **Directions** (Apple/Google Maps deep link), **Save**, **Share**, **Report**.

### 5.3 Place detail
Hero photo (or gradient placeholder) with tier pill; name + cuisines; tappable address + Directions; **Trust summary card** — the full halal profile exactly as web renders it (menu posture, per-meat slaughter methods, alcohol policy, pork, certificate w/ certifying body + expiry, verification history with verifier names linking to their public profiles); preference-match banner ("Matches your saved preferences" / what misses); photo gallery; dispute section; "Own this restaurant?" footer link out to the owner portal.

### 5.4 Dispute filing (signed-in consumers)
Bottom-sheet flow, 3 steps: attribute picker (same 7 attributes as API) → description → optional photo evidence (camera or library, multi-upload to the existing dispute-evidence endpoint). Submit → confirmation with plain-language expectations ("The owner and Trust Halal review this; you'll get a notification when the status changes."). Activity tab tracks OPEN → OWNER_RECONCILING → ADMIN_REVIEWING → resolved states with the same labels as web.

### 5.5 Verifier mode
- **Becoming one:** Profile → "Become a verifier" renders the same application form as the web (motivation, socials, disclosure agreement) via the existing verifier-application endpoints; status shown in Profile until approved.
- **Filing a visit (the crown jewel):** Verify tab → "File a visit" → pick the place (nearby list biased by GPS — you're probably standing in it) → multi-step form: what you ordered · what you observed (menu coverage, cert on the wall, sourcing signals) · photos (camera-first) · **the non-negotiable paid-meal disclosure** (who paid — required radio, same policy language as web) · review & submit.
- **Offline drafts:** visits auto-save locally at every step; a visit drafted in a basement restaurant syncs when the phone finds signal. Drafts list at the top of the Verify tab.
- **My visits:** SUBMITTED / ACCEPTED / REJECTED / WITHDRAWN with admin feedback; public profile preview ("what diners see") linking to `/verifiers/{handle}`.

### 5.6 Auth
Email/password against the existing endpoints, plus **Sign in with Apple** (App Store requirement once any social login exists — if we ship email-only, Apple sign-in is optional but still recommended) — flag as a small backend addition. Signup mirrors web copy (name shown on disputes). Sessions: the API is cookie-based today; mobile needs **bearer-token auth** (see §9 gaps).

## 6. Screen inventory (the spec of record)

1. **Onboarding ×3** — brand, tiers, location priming.
2. **Explore** — search field, location pill, radius chips (1/3/5/10/25 mi), cuisine rail, results list; empty state with "Widen radius / Change city"; skeletons mirror card shape.
3. **Filters sheet** — verification tier, menu coverage, cuisines (full 49), dietary (pork-free / no alcohol / cert on file); plain-language hints; Done + Clear all. Applies instantly.
4. **Location sheet** — "Use my location," curated popular cities, city search (forward-geocode proxy).
5. **Place detail** — as §5.3.
6. **Photo viewer** — full-screen gallery, pinch zoom, captions + "photo by" attribution.
7. **Dispute sheet ×3 steps** — as §5.4.
8. **Saved** — grouped by city, offline badge when serving cache, swipe-to-unsave, sort by recently saved / distance.
9. **Activity** — chronological: dispute updates, saved-place tier changes, verifier visit outcomes. Each row deep-links.
10. **Profile** — account card, Search preferences (same 3 sections as web), Become a verifier / Verifier status, Notifications toggles, About (ethics link → trusthalal.org/ethics, version), Sign out.
11. **Auth ×2** — sign in (with ?next-style return-to), create account.
12. **Verify tab** — drafts, File a visit CTA, My visits list.
13. **Visit flow ×5 steps** — place pick → order → observations → photos → disclosure + review.
14. **Verifier public profile** — handle, bio, accepted visits (read-only, same data as web).

## 7. Design system (mobile) — v2, clean-modern

The app deliberately does **not** inherit the web's warm olive/cream editorial palette. Mobile gets its own contemporary system; the shared DNA is the *trust-tier semantics*, not the paint.

- **Canvas:** near-white neutral `#F6F6F7`, pure-white cards, ink `#0B0B0E`, secondary `#7A7A83`, hairlines `#ECECEF`. Generous whitespace; borderless cards floating on soft two-layer shadows.
- **Accent:** one confident emerald — `#0E9F6E` (deep `#057A55`, soft wash `#E6F7F0`). Used only where trust or action lives: Verified tags, primary map pins, the Directions button, progress. Everything else stays neutral so the green *means* something.
- **Tier color language:** Verified = solid emerald tag (white text) · Certified = amber wash `#FEF3E2`/`#B45309` · Owner-attested = zinc wash · No info = dashed outline gray · Disputed = red wash. Same five semantics as `halal-display.ts`, re-skinned.
- **Imagery-first:** result cards are edge-to-edge photos with a bottom scrim; tags ride the photo as glass chips (blurred, semi-opaque). No-photo places gracefully collapse to text rows.
- **Chrome:** floating pill-shaped bottom nav with background blur (glass), not a full-width bar; circular glass buttons over photos (back/save/share); bottom sheets with grab handles for filters/location/reporting; full-screen stepped flows for verifier visits.
- **Shape:** 20–24pt card radius, 16pt buttons, 999 pills. Dynamic-island-era layouts (content tucks under status bar, sheets overlap heroes with 28pt top radius).
- **Type:** Inter only, weight-driven hierarchy (800 tight-tracked titles → 600 labels → 500 body). No serif on mobile — the editorial voice stays on trusthalal.org. Body 16/24, min tap target 44×44pt, full Dynamic Type / font-scale support.
- **Dark mode at launch:** `#0C0C0F` canvas, `#161619` cards, emerald brightened to `#34D399`, tier washes become 10–12% tinted fills. Same components, token-swapped.
- **Motion:** 200ms ease-out standard; shared-element photo transition card → detail; sheet spring on filters; reduce-motion honored.
- **Accessibility:** VoiceOver/TalkBack labels lifted from the web's aria strings; tier tags always carry the long-form description; AA contrast everywhere including glass chips over photos (solid ≥85% opacity backing).

## 8. Notifications (all opt-in, per-category toggles)

| Event | Trigger | Deep link |
|---|---|---|
| Dispute status changed | admin/owner action | Activity → dispute |
| Saved place tier changed / disputed | profile change on a favorite | Place detail |
| Visit accepted/rejected | admin review | Verify → visit |
| Verifier application decision | admin review | Profile |

No marketing pushes. Ever. That's a trust product decision, not just a settings default.

## 9. API mapping & backend gaps

**Maps cleanly today:** places search (`q`+geo combined), place detail + public halal profile, photos (hero + gallery URLs), favorites CRUD, consumer preferences GET/PUT, disputes (file/list/withdraw/evidence), auth (login/signup/logout/me), geocoding proxies, verifier applications (submit/list/withdraw), verification visits (submit/list/withdraw + evidence), public verifier profiles.

**Gaps to build before/with the app (backend work, not blockers to design):**
1. **Token auth** — cookie sessions don't fit mobile; add bearer/refresh-token issuance (or accept long-lived session token via header).
2. **Push infrastructure** — device-token registry + event fan-out (dispute/visit/favorite-profile changes). Server-side events already exist as audit rows; needs a notifier.
3. **Password reset** — missing on web too; mobile makes its absence louder.
4. **Sign in with Apple** (conditional, see §5.6).
5. **Favorites delta endpoint** (nice-to-have) — `updated_since` for cheap offline sync of saved places.

## 10. Phasing

- **P0 (MVP):** Explore + filters + location, place detail, directions/share, auth, saved (online), preferences, dispute filing + Activity, dark mode. *Token auth + password reset on backend.*
- **P1:** Verifier mode complete (application, visit flow, offline drafts), push notifications, offline saved-places cache, map view on Explore.
- **P2:** Home-screen widget ("nearest verified halal"), Siri/Assistant shortcuts, App Clip / Instant App for shared place links, photo submission by consumers (needs product decision — web parity is owner-only today).

## 11. Open questions for review

1. Map view: P1 as proposed, or must-have for MVP?
2. Should anonymous users get local-only Saved (like web's local preferences) or is Saved a signup carrot? (Design assumes signup carrot, matching web.)
3. Verifier place-pick: restrict to places already in catalog, or allow nominating a brand-new place from the app (API supports suggestion via ownership/public paths — needs product call)?
4. App name: "Trust Halal" (consumer brand) — confirmed 2026-07-11; see brand-assets/.

---

*Companion file: `2026-07-06-mobile-app-mockups.html` — phone-frame visual mockups of the eight key screens.*
