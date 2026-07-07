# UI-first build plan

Process (agreed 2026-07-06): codify every mockup screen as faithful UI
with fixture data FIRST; wire business logic at a later stage. Source
of truth: `docs/2026-07-06-mobile-app-mockups.html` (repo root).
Primitives: `src/ui/kit.tsx` (one component per mockup CSS class).
Fixtures: `src/fixtures/` (mockup content verbatim). Review surface:
Profile → UI gallery (`app/ui-gallery.tsx`).

Rules: screens consume kit primitives + fixtures only — no new inline
styling systems, no API calls in UI-only screens. Wiring later swaps
fixtures for hooks without touching layout.

| # | Mockup | Route | Status |
|---|--------|-------|--------|
| 1 | Explore | (tabs)/index | ✅ aligned |
| 2 | Map view | — | ⬜ P1 |
| 3 | Place detail | places/[id] | ✅ aligned |
| 4 | Filters sheet | FiltersSheet | ✅ aligned |
| 5 | Saved | (tabs)/saved | 🟨 city chips + offline chip pending |
| 6 | Verifier disclosure | — | ⬜ Phase 11 |
| 7 | Activity (dark) | — | ⬜ next batch |
| 8 | Profile | (tabs)/profile | 🟨 account card + icboxes pending |
| 9–11 | Onboarding ×3 | onboarding | ✅ aligned |
| 12 | Sign in | (auth)/sign-in | ✅ aligned |
| 13 | Create account | (auth)/sign-up | ✅ aligned |
| 14 | Location picker | — | ⬜ next batch |
| 15 | Report an issue | — | ⬜ next batch |
| 16–17 | Verify home/profile | — | ⬜ Phase 11 |
| 18 | Empty state | States.tsx | 🟨 icon box pending |
| 19–22 | Visit flow | — | ⬜ Phase 11 |
| 23 | Trust profile expanded | — | ⬜ next batch |
| 24 | Disputed place | places/[id] | 🟨 amber banner pending |
| 25 | Dispute timeline | — | ⬜ next batch |
| 26 | Search typing | — | ⬜ next batch |
| 27 | Become a verifier | — | ⬜ Phase 11 |
| 28 | Saved signed-out | (tabs)/saved | ✅ |
| 29 | Notifications | — | ⬜ next batch |
| 30 | Photo viewer | — | ⬜ next batch |

Batch order: (A) finish 5/8/18/24 gaps → (B) 14, 15, 23, 25, 26, 29,
30 as fixture screens → (C) Phase-11 verifier set → (D) wiring pass.
