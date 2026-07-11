# Wiring plan — fixtures → live (nothing missed)

Rule: wiring swaps data sources only. If a diff touches layout, stop.
Each item has: hook/endpoint · gate · done-when. Work top to bottom;
tick the box in this file in the same PR as the wiring.

## Phase W0 — prerequisites (backend/live)
- [ ] Apply migration j3a4b5c6d7e8 (mobile_tokens) + run pytest test_auth_mobile.py
- [ ] Deploy API; verify POST /auth/mobile/login on api.trusthalal.org
- [ ] Commit fresh package-lock after simulator boots clean

## Phase W1 — already-wired screens: verify against live API (checklist run)
- [ ] Explore: near-me + name search (q keeps geo), radius chips, filters sheet params reach GET /places
- [ ] Place detail: real id loads; fx-* fixtures still render for gallery
- [ ] Auth: sign-up → token pair → /me; sign-in; refresh rotation (leave app 1h+); logout
- [ ] Saved: save/unsave round-trip; signed-out gate
- [ ] Profile: account card shows live user; sign out clears tokens
- Done-when: each flow demoed on device against prod API

## Phase W2 — fixture screens gaining wires (existing endpoints)
- [ ] 14 Location picker → geocode proxies + lib/cities port; opens from Explore location line
- [ ] 15 Report issue → POST /disputes + attachments (expo-image-picker; NATIVE REBUILD)
- [ ] 26 Search-typing → reuse useSearchPlaces compact rows + recents (MMKV/SecureStore)
- [ ] 23 Trust profile → GET /places/{id}/halal-profile; link from detail "Details ›"
- [ ] 24 Disputed state → drives off dispute_state (already live once data exists)
- [ ] 17 Verifier public profile → GET /verifiers/{handle}
- [x] 27 Become a verifier → POST /verifier-applications (app/become-a-verifier.tsx)
- [ ] 30 Photo viewer → place.photos gallery from detail
- [ ] 25 Dispute timeline → GET /me/disputes/{id} (reporter view)
- [ ] Preferences screen (spec §4, no UI yet) → GET/PATCH /me/preferences + match banner on detail

## Phase W3 — needs NEW backend (open PRs against api/)
- [ ] Activity (7) → needs events/read-state endpoint (design: reuse audit rows)
- [ ] Push notifications → device-token registry + fan-out (docs/api-and-auth.md)
- [ ] Sign in with Apple/Google → /auth/mobile/apple|google + expo-apple-authentication (REBUILD)
- [ ] Password reset → platform-wide gap

## Phase W4 — Phase-11 verifier field kit
- [ ] Verify home (16) + visit flow (19–22) → verifier visit endpoints, offline drafts (MMKV), role-gated 4th/5th tabs
- [ ] Map view (2) → react-native-maps (REBUILD)

## Guardrails
- fx-* fixture ids stay working forever (UI gallery is the regression suite)
- Every wired screen keeps explicit loading/error/empty states (grep for <Loading/>)
- No AI-derived signals on any consumer surface (ethics doc)
- Analytics events at wire time: search_executed, place_viewed, favorite_added, dispute_filed, sign_in/up
