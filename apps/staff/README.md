# Trust Halal Staff

Native (Expo/iOS) console for internal moderation and review, so staff can act
on the admin queues from their phone and get push notifications when work lands.

It talks to the same API as the web admin (`api.trusthalal.org`) and calls the
same `/admin/*` endpoints. There is **no new backend auth**: staff sign in with
their existing admin email/password via `/auth/mobile/login`, which returns a
bearer token; every admin endpoint already accepts that token and gates on
`require_roles(ADMIN)`. Non-admin accounts are refused at sign-in.

## First-time setup

1. `npm install`
2. Create the EAS project and set the id in `app.json` → `extra.eas.projectId`
   (replace `REPLACE_WITH_EAS_PROJECT_ID`). This id is also what push tokens are
   minted against.
3. `npm run typecheck` to verify.
4. Dev: `npx expo start` (push requires a real device + a dev/production build,
   not Expo Go).

## Build & submit

Uses the same EAS/App Store Connect team as the consumer app
(`appleTeamId` 3623JG9XS4), under its own bundle id `org.trusthalal.staff`.

- `eas build --profile production --platform ios`
- `eas submit --profile production --platform ios`

## Auth model

- Sign in with an admin account. Token pair stored in the iOS Keychain
  (`expo-secure-store`), auto-refreshed via `/auth/mobile/refresh`.
- Revoke access by deactivating the user (or their token) server-side; nothing
  to rotate, no shared secret.

## Notifications

- On sign-in the app registers this device's Expo push token at `/me/devices`
  (existing endpoint). Taps route to `data.path` (e.g. `/claims/<id>`).
- The server-side fan-out that actually *sends* admin pushes on new
  claims / disputes / reported content / verifier activity is separate backend
  work (see the project tasks).

## Status

Built: auth + login, push registration + tap routing, dashboard of all queues,
and the **Halal claims** section end to end (list, detail, approve / reject /
request-info).

Coming next (parity pass): disputes, verification visits, reported reviews,
reported photos, verifier applications, ownership requests, users, suppliers,
organizations, places. Each is a list + detail + actions screen following the
claims pattern, backed by the corresponding `/admin/*` endpoints.
