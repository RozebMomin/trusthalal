# Architecture

The locked-in tech decisions and why we picked them. If you disagree with any of these, raise it before you build — a lot of downstream work rides on these picks.

## The stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | **React Native (Expo managed workflow)** | Cross-platform from one codebase; solo-founder-friendly velocity; small trade-offs vs pure native for a directory/search app |
| Language | **TypeScript strict** | Matches every other app in the repo; catches API contract drift when we run codegen |
| Navigation | **`expo-router`** (file-based) | New Expo default; deep-linking works out of the box; ergonomic |
| Server state | **`@tanstack/react-query` v5** | Exactly what all three web apps use; hook shapes port over almost verbatim from `apps/consumer/src/lib/api/hooks.ts` |
| Local state | **Zustand** for UI state, **React Query cache** for server state | Zustand's tiny, matches the "don't over-engineer" bar |
| Persistent local storage | **MMKV** (via `react-native-mmkv`) for prefs, **Expo SecureStore** for auth tokens | MMKV is order-of-magnitude faster than AsyncStorage; SecureStore is the right home for anything you'd feel bad losing |
| API client | Thin `fetch` wrapper (mirror `apps/consumer/src/lib/api/client.ts`) | Keep it boring |
| Type generation | `openapi-typescript` against `api/openapi.json` | Same pattern the web apps use; `npm run codegen` |
| Auth token store | **Expo SecureStore** | iOS Keychain / Android Keystore under the hood |
| Fonts | **Expo Google Fonts** (`@expo-google-fonts/cormorant-garamond`, `@expo-google-fonts/inter`) | Same face pair the web uses; loaded via `useFonts` on splash |
| Icons | **`@expo/vector-icons`** (Feather) | Matches Lucide's line-weight aesthetic — closest visual match to the web apps |
| Analytics | **PostHog React Native** | Same platform as the consumer PWA; single events dashboard |
| Errors | **Sentry** via `@sentry/react-native` | Same posture as web; request-id correlation works out of the box |
| Build / distribute | **EAS Build + EAS Submit** | Cloud builds, TestFlight upload, App Store submission — all one CLI |
| Push notifications | **Expo Push (via EAS)** | Zero-config on iOS/Android; the backend just POSTs a token to Expo |

## Why not `<other option>`

**Why not native Swift + Kotlin?** Roughly 2× the work for a directory app whose native affordances are almost entirely off-the-shelf (map, search, list, form). We're solo-shipping; velocity matters more than the last 5% of native polish.

**Why not Flutter?** Team-familiarity zero. React Native shares mental model with the three web apps in this repo (same React, same React Query, same TypeScript patterns). Reuse of hooks and types is a real speed-up.

**Why not Capacitor wrapping the PWA?** Two reasons: (1) the PWA is a mobile web app in a shell — feels like a website. Trust-critical brand needs polish. (2) Sign in with Apple, push notifications, and universal links all get harder in Capacitor than in Expo.

**Why not Next.js Mobile / `next-native`?** Not a real thing yet. RN + Expo is the mature answer.

## Managed vs bare workflow

**Use Expo's managed workflow.** No custom native modules on day one. If you later need something the managed workflow can't do (e.g. a native library not on Expo's supported list), Expo now supports "prebuild" — you eject into the native project only when needed, without giving up the rest of the managed goodies.

## Folder structure

Standard `expo-router` file-based layout. Match the mental model of `apps/consumer/src/app/` where possible so hooks port cleanly.

```
apps/mobile/
├── HANDOFF.md              # entry point (already exists)
├── docs/                   # these docs (already exists)
├── app/                    # expo-router routes — screens live here
│   ├── _layout.tsx         # root layout (fonts, providers, splash)
│   ├── index.tsx           # home / search
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx     # bottom tab bar
│   │   ├── index.tsx       # search tab
│   │   ├── favorites.tsx
│   │   └── profile.tsx
│   ├── places/
│   │   └── [id].tsx        # place detail
│   ├── verifiers/
│   │   └── [handle].tsx    # public verifier profile
│   ├── preferences.tsx
│   └── ethics.tsx
├── src/
│   ├── components/         # reusable pieces
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts   # fetch wrapper
│   │   │   ├── hooks.ts    # React Query hooks (mirror apps/consumer)
│   │   │   └── schema.d.ts # codegen output
│   │   ├── auth/
│   │   │   ├── apple.ts    # Sign in with Apple wiring
│   │   │   ├── google.ts   # Sign in with Google wiring
│   │   │   └── token-store.ts  # SecureStore wrapper
│   │   ├── theme/
│   │   │   ├── colors.ts   # from marketing/style-guide/visual-style.md
│   │   │   ├── fonts.ts
│   │   │   ├── spacing.ts
│   │   │   └── index.ts
│   │   └── analytics.ts    # PostHog wrapper
│   └── hooks/              # custom RN hooks (not API hooks)
├── assets/
│   ├── fonts/              # if you decide to self-host
│   ├── images/
│   └── icons/
├── app.json                # Expo config
├── eas.json                # EAS Build config
├── package.json
├── tsconfig.json
└── README.md               # dev quickstart (add after scaffolding)
```

## Sacred conventions

Copy from the web apps unless there's a good reason to diverge. Specifically:

- **`useCurrentUser`** returns `{ id, email, display_name, role } | null`. Mirror this shape.
- **`ApiError`** class with `status` and `code` fields. Mirror this shape.
- **Query keys** are tuples like `["places", "search", params]`. Mirror this shape.
- **Empty / loading / error / no-results** — every screen renders all four states explicitly. No silent failures.

## What ships in v0

See [`first-slice.md`](./first-slice.md) for the exact scope. Short answer: search + place detail + basic auth. TestFlight by week 12 of Phase 10C, App Store by week 16.

## What does NOT ship in v0

- Owner portal — that's `apps/owner/` on the web, deliberately kept off mobile for now
- Admin panel — `apps/admin/`, absolutely not on mobile
- Verifier field-kit (visit submission from phone) — deferred to Phase 11
- Nominate-a-restaurant — deferred until the web verifier portal has proven the concept
- Any AI-derived consumer signal (see the ethics doc)

## Where to raise architectural questions

Anything about the API shape → open a PR against `api/`.
Anything about brand voice → check `marketing/style-guide/brand-voice.md` first.
Anything about visual system → check `marketing/style-guide/visual-style.md` + `docs/design-system.md`.
Anything about scope → check `roadmap/README.md` + this folder.
