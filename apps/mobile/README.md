# trusthalal-mobile

Native iOS (and eventually Android) app for Trust Halal. Consumer-facing surface — search verified halal restaurants, view halal profiles, save favorites, file disputes. Owner and admin functionality lives on the web.

**Status:** Handoff docs written. App not yet scaffolded. Phase 10C of the roadmap.

## Start here

If you're picking this up cold, read [`HANDOFF.md`](./HANDOFF.md) first. It links to focused deep-dives in `docs/`:

- [`docs/architecture.md`](./docs/architecture.md) — locked tech decisions, folder structure
- [`docs/api-and-auth.md`](./docs/api-and-auth.md) — talking to the backend + the mobile auth story (backend changes needed)
- [`docs/design-system.md`](./docs/design-system.md) — palette, typography, component patterns
- [`docs/first-slice.md`](./docs/first-slice.md) — MVP scope, ship criteria, testing, App Store
- [`docs/gotchas.md`](./docs/gotchas.md) — what will bite you

Total read time: ~30 minutes. Do it before writing code.

## Bootstrap (once you're ready to build)

The Expo project itself isn't scaffolded yet. Once you've read the docs and are ready to start coding:

```bash
cd apps/mobile

# Scaffold a fresh Expo project into THIS folder without wiping the docs.
# (Point the template at ./tmp and then move files up.)
npx create-expo-app@latest ./tmp --template blank-typescript
mv tmp/{app,assets,package.json,tsconfig.json,app.json,babel.config.js,.gitignore} .
rm -rf tmp

# Install extras the docs assume you'll be using
npm install expo-router expo-linking expo-constants expo-status-bar \
  react-native-screens react-native-safe-area-context \
  @tanstack/react-query @tanstack/react-query-devtools \
  react-native-mmkv \
  expo-secure-store \
  expo-apple-authentication expo-auth-session expo-crypto \
  expo-font \
  @expo-google-fonts/cormorant-garamond @expo-google-fonts/inter \
  @expo/vector-icons \
  react-native-reanimated \
  @gorhom/bottom-sheet \
  expo-haptics expo-location \
  posthog-react-native \
  @sentry/react-native

npm install -D typescript@latest openapi-typescript
```

Then update `package.json` scripts:

```json
{
  "scripts": {
    "start": "expo start",
    "ios": "expo start --ios",
    "android": "expo start --android",
    "lint": "expo lint",
    "typecheck": "tsc --noEmit",
    "codegen": "openapi-typescript ../../api/openapi.json -o src/lib/api/schema.d.ts"
  }
}
```

## Repo context

This is part of the `trusthalal` monorepo:

```
trusthalal/
├── api/                    # FastAPI backend — you'll add a mobile-token endpoint here
├── apps/
│   ├── admin/              # admin panel (web)
│   ├── brand/              # trusthalal.org landing (web)
│   ├── consumer/           # halalfoodnearme.com PWA (the source of truth for feature parity)
│   ├── mobile/             # THIS APP
│   └── owner/              # owner portal (web)
├── content/                # long-form docs (AI ethics, etc.)
├── marketing/              # brand voice, visual style, outreach templates
└── roadmap/                # phase roadmaps
```

## Non-negotiable rules

1. **No AI-derived signals on any consumer surface.** Read `content/ethics/ai-ethics.md`.
2. **Sign in with Apple is required.** No exceptions if you offer any other third-party sign-in.
3. **Match the family look and voice.** Brand voice guide at `marketing/style-guide/brand-voice.md`, visual style at `marketing/style-guide/visual-style.md`.

## Contact

Founder: rozebm@gmail.com

## License

Same as the rest of the monorepo.
