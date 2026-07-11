# Trust Halal mobile (apps/mobile)

The consumer iOS/Android app. Start with `HANDOFF.md`, then `docs/`.

## Quickstart

```bash
npm install
npm run start           # Expo dev server → press i for iOS simulator
npm run typecheck
```

Backend: `https://api.trusthalal.org` (override in app.json → extra.apiBaseUrl;
point it at http://localhost:8000 for a local API).

Auth uses the `/auth/mobile/*` bearer-token endpoints (see
`docs/api-and-auth.md`) — tokens live in SecureStore, refresh is
automatic in `src/lib/api/client.ts`.

## Design

v2 clean-modern system (NOT the web's olive/cream — see
`docs/design-system.md` header note): tokens in `src/lib/theme/`,
mockups in `../../docs/2026-07-06-mobile-app-mockups.html`.

## What works in this scaffold

Explore (near-me + name search, radius chips, tier tags), place detail
(trust profile, directions, save), Saved, Profile, email sign-in/up
with token refresh, dark mode.

## Next

Filters sheet · dispute filing · Sign in with Apple + Google ·
preferences screen · push infra · onboarding screens.
