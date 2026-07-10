# API + auth

The trickiest piece of the mobile app is auth, because the existing backend uses HttpOnly session cookies and React Native doesn't behave like a browser. This document tells you exactly how to talk to the backend and how to solve the auth problem.

## The API

**Base URL:** `https://api.trusthalal.org`

**Canonical schema:** `api/openapi.json` in the repo root. Regenerate types with `npm run codegen` after any backend change. The web apps do this on every meaningful backend PR.

**Error envelope:** every non-2xx response has this shape:

```json
{ "error": { "code": "SOME_CODE", "message": "human-readable", "detail": {} } }
```

Mirror the `ApiError` class from `apps/consumer/src/lib/api/client.ts` — it exposes `.status`, `.code`, and `.message` on the exception.

## Endpoints you'll actually use in v0

Everything in this list is public + already implemented. Grouping is roughly the screen that consumes it.

### Auth (needs work — see next section)

| Method + path | Purpose |
|---|---|
| `POST /auth/signup` | Create an account (role always CONSUMER from mobile) |
| `POST /auth/login` | Sign in |
| `POST /auth/logout` | Sign out (idempotent) |
| `GET /me` | Resolve session → user object |

### Places (search + detail)

| Method + path | Purpose |
|---|---|
| `GET /places?q=...&lat=&lng=&radius=` | Search — text, near-me, filters |
| `GET /places/{id}` | Place detail (embeds `halal_profile`) |
| `GET /places/{id}/halal-profile` | Standalone halal profile (rarely needed on mobile — detail embeds it) |

Search query params — the full list is defined in `apps/consumer/src/lib/api/hooks.ts` under `SearchPlacesParams`. Copy that type wholesale. Notable ones:

- `q` — text search
- `lat`, `lng`, `radius` — near-me
- `min_validation_tier` — SELF_ATTESTED / CERTIFICATE_ON_FILE / TRUST_HALAL_VERIFIED
- `min_menu_posture` — FULLY_HALAL / MIXED_SEPARATE_KITCHENS / etc.
- `has_certification`, `no_pork`, `no_alcohol_served` — booleans
- `cuisines` — multi-value array (encoded as repeated `?cuisine=X&cuisine=Y`)

### Consumer preferences + favorites

| Method + path | Purpose |
|---|---|
| `GET /me/preferences` | User's saved halal filter defaults |
| `PATCH /me/preferences` | Update them |
| `GET /me/favorites` | Saved places |
| `POST /me/favorites/{place_id}` | Save a place (path param, no body) |
| `DELETE /me/favorites/{place_id}` | Unsave |

### Disputes

| Method + path | Purpose |
|---|---|
| `POST /disputes` | File a dispute on a listing |
| `POST /disputes/{id}/attachments` | Upload photos as evidence (multipart) |

### Verifier surfaces (mostly read-only from mobile)

| Method + path | Purpose |
|---|---|
| `GET /verifiers/{handle}` | Public verifier profile — bio, socials, accepted visits |
| `POST /verifier-applications` | Apply to be a verifier (anonymous OK) |

### Reverse geocode (for the near-me pill)

| Method + path | Purpose |
|---|---|
| `GET /geocode/reverse?lat=&lng=` | Coords → city label |

## The auth problem

**Current backend:** issues an HttpOnly `tht_session` cookie on `POST /auth/login`. Every subsequent request needs `credentials: "include"` to send the cookie. Works great in browsers.

**Why this breaks in React Native:**

1. RN's `fetch` doesn't have a shared cookie jar by default. You can persist cookies with `@react-native-cookies/cookies`, but it's fragile — the cookie can silently vanish across app reloads, especially on iOS 17+, and debugging is painful.
2. The `HttpOnly` flag means JS can't inspect the cookie, so you can't check "am I still signed in?" without hitting `/me`.
3. There's no easy way to refresh the session or handle expiry from the client cleanly.

**Recommended solution:** add a small **mobile-token** endpoint to the backend and use it for the mobile app. Session cookies stay for web; mobile uses bearer tokens.

### The backend change you'll need

Add these endpoints (see the pattern in `api/app/modules/auth/router.py`):

```
POST /auth/mobile/login
  body: { email, password }
  response: { user, access_token, refresh_token, expires_in }

POST /auth/mobile/signup
  body: { email, password, display_name }
  response: { user, access_token, refresh_token, expires_in }

POST /auth/mobile/refresh
  body: { refresh_token }
  response: { access_token, refresh_token, expires_in }

POST /auth/mobile/apple
  body: { identity_token, authorization_code, nonce }
  response: { user, access_token, refresh_token, expires_in }

POST /auth/mobile/google
  body: { id_token, nonce }
  response: { user, access_token, refresh_token, expires_in }
```

- Reuse the existing password-hashing + user-creation logic
- Access token: JWT, 1-hour TTL, contains `sub` (user id), `role`, `exp`
- Refresh token: opaque, 30-day TTL, stored server-side (new table `mobile_refresh_tokens` or reuse `sessions`)
- Signing key from a new `MOBILE_JWT_SIGNING_KEY` env var (generate with `openssl rand -hex 32`)

Middleware for `Authorization: Bearer <token>`: mirror `get_current_user` but read the token from the header instead of the cookie. Keep both auth methods live — cookie auth for web, bearer for mobile.

### Client side (mobile app)

```ts
// src/lib/auth/token-store.ts
import * as SecureStore from "expo-secure-store";

export const tokenStore = {
  async get() {
    const [access, refresh] = await Promise.all([
      SecureStore.getItemAsync("access_token"),
      SecureStore.getItemAsync("refresh_token"),
    ]);
    return { access, refresh };
  },
  async set({ access, refresh }: { access: string; refresh: string }) {
    await Promise.all([
      SecureStore.setItemAsync("access_token", access),
      SecureStore.setItemAsync("refresh_token", refresh),
    ]);
  },
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync("access_token"),
      SecureStore.deleteItemAsync("refresh_token"),
    ]);
  },
};
```

```ts
// src/lib/api/client.ts (sketch)
import { tokenStore } from "@/lib/auth/token-store";

const BASE = "https://api.trusthalal.org";

export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const { access } = await tokenStore.get();
  const headers = new Headers(opts.headers);
  if (access) headers.set("Authorization", `Bearer ${access}`);
  headers.set("Accept", "application/json");
  if (opts.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  // 401 → try refresh once, then retry the original request
  if (res.status === 401 && access) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch<T>(path, opts);
  }

  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}
```

### Sign in with Apple

Use `expo-apple-authentication`. iOS only — Android sign-in-with-Apple is a web flow.

```ts
import * as AppleAuthentication from "expo-apple-authentication";

const credential = await AppleAuthentication.signInAsync({
  requestedScopes: [
    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
    AppleAuthentication.AppleAuthenticationScope.EMAIL,
  ],
});
// credential.identityToken, credential.authorizationCode
// POST both to /auth/mobile/apple, get back access + refresh
```

Register the Sign in with Apple capability in `app.json` under `ios.usesAppleSignIn: true`.

**App Store rule:** if you offer *any* third-party sign-in (Google in this case), you MUST also offer Sign in with Apple. Not optional. Reviewers reject apps missing this on the login screen.

### Sign in with Google

Use `expo-auth-session/providers/google` (OAuth 2.0 PKCE flow). You'll need:

- Google Cloud project with an iOS OAuth client + web OAuth client (for the token exchange)
- Client IDs in `app.json` under `extra`

Backend endpoint `/auth/mobile/google` takes the ID token and mints your bearer token.

### Email sign-in

Same as web: `POST /auth/mobile/login` with email + password. Server returns tokens; store them via `tokenStore`.

## Reference: hooks to port from `apps/consumer/src/lib/api/hooks.ts`

Direct copy-and-adapt list. The React Query shapes work identically; you'll just swap `apiFetch` for the RN version above.

Auth / user:
- `useCurrentUser`
- `useLogin`, `useSignup`, `useLogout`
- `useSetPassword` (invite flow — probably not needed on mobile v0)

Search + places:
- `useSearchPlaces`
- `usePlaceDetail`
- `useReverseGeocode`

Consumer state:
- `useMyPreferences`, `usePatchPreferences`
- `useMyFavorites`, `useToggleFavorite`

Disputes:
- `useFileDispute`

Verifiers (public):
- `usePublicVerifierProfile`

Don't try to port every hook in that file — mobile v0 is search + place detail. See [`first-slice.md`](./first-slice.md) for the exact scope.

## CORS

The API already allows the web origins. When you scaffold Expo and start hitting the API from `exp://` or a device, you may need to add:

- Expo Go: `exp://` scheme
- Standalone builds: no CORS check needed (native fetch doesn't do CORS)

Add these to `CORS_ORIGINS` on Render if you hit issues. See `api/app/main.py`'s CORS setup.

## Rate limits

The API is rate-limited. Notable ones:

- `/verifier-applications` — 5/hour per IP
- Consumer signup — 20/hour per IP
- Various — see `@limiter.limit` decorators in `api/app/modules/`

Handle 429 gracefully — show the friendly-error message and back off.

## Sentry request-id correlation

Every API response includes `X-Request-ID`. Extract it and tag Sentry breadcrumbs with `last_request_id` — that's what makes a single failing request show up under the same correlation key on both client and server. `apps/consumer/src/lib/api/client.ts` shows the pattern.
