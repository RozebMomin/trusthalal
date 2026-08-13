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
2. `eas login`, then `eas init` from this directory. That creates the EAS
   project on expo.dev and writes `extra.eas.projectId` into `app.json` for you
   (you don't have or type an id by hand). This id is what push tokens are
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

## Design

The look follows `docs/mockups.html` (open it in a browser): a Queues home with
a summary card and grouped Review/Manage sections, a bottom tab bar (Queues /
Me), iOS-style grouped cards, segmented filters, status pills, and a sticky
action bar on the claim review screen. Light and dark are both first-class.
Shared UI lives in `src/components/ui.tsx`; new sections should reuse it.

## Status

Built: auth + login, push registration + tap routing, tab bar, the Queues
dashboard, and these sections end to end:
- **Halal claims** — list, detail, approve / reject / request-info.
- **Places** — single add via Google search; bulk add (stage → preview → import).
- **Verifier applications** — list, detail, approve / reject.
- **Ownership requests** — list, detail, approve / reject / request-evidence.
- **Disputes** — list, detail, uphold / dismiss / request owner reconciliation.
- **Verification visits** — list, detail (findings + disclosure), accept /
  reject / mark under review.
- **Reported reviews** — grouped queue, detail (review + all reports + author
  context), uphold (keep / hide / remove) or dismiss.
- **Reported photos** — thumbnail queue, detail (image + linked review),
  uphold (with remove) or dismiss.

That completes the Review group. Coming next: users, suppliers, organizations
(the Manage group). Each is a list + detail + actions screen following the same
pattern, backed by the corresponding `/admin/*` endpoints. Sections whose API
has no per-item GET (verifier applications, ownership requests) read the item
from the list query cache.
