# Gotchas

What will bite you if you don't know about it upfront. Read this before shipping to TestFlight.

## Session cookies do NOT work naturally in React Native

Covered in depth in [`api-and-auth.md`](./api-and-auth.md). Short version: the web app uses HttpOnly session cookies, mobile CAN'T. Don't try. Add the mobile-token endpoint on the backend and use bearer tokens.

## Sign in with Apple is required by App Store

If your app offers Google, Facebook, Twitter, or any third-party sign-in, you MUST also offer Sign in with Apple. This isn't a suggestion. Reviewers reject apps for missing it. Put the Apple button first / on top of the other options in the UI.

## Universal links (deep linking) need a file served from the consumer origin

To make `https://halalfoodnearme.com/places/{id}` open the app when installed on iOS, the consumer site needs to serve an `apple-app-site-association` file at:

```
https://halalfoodnearme.com/.well-known/apple-app-site-association
```

Content roughly:
```json
{
  "applinks": {
    "apps": [],
    "details": [{
      "appID": "TEAMID.org.trusthalal.consumer",
      "paths": ["/places/*", "/verifiers/*", "/become-a-verifier", "/ethics"]
    }]
  }
}
```

- File must be served with `Content-Type: application/json`
- HTTPS only, no redirect
- Add a Next.js route handler in `apps/consumer/src/app/.well-known/apple-app-site-association/route.ts` — Next won't serve `.well-known` from `public/` by default because of the dot prefix

Android needs an equivalent `assetlinks.json` at `/.well-known/assetlinks.json` when you ship Android.

## Location permission needs a real Info.plist string

`app.json` → `expo.ios.infoPlist`:

```json
{
  "NSLocationWhenInUseUsageDescription": "So we can show halal restaurants near you.",
  "NSPhotoLibraryUsageDescription": "So you can attach a photo to a dispute report.",
  "NSCameraUsageDescription": "So you can take a photo for a dispute report."
}
```

Reviewers reject apps whose permission prompts say "This app needs camera access" (Xcode default). Write a sentence a normal person can read.

## `expo-router` deep-linking config

`app.json` → `expo.scheme` sets the custom scheme (e.g. `trusthalal://`). For universal links, add:

```json
{
  "expo": {
    "scheme": "trusthalal",
    "ios": {
      "associatedDomains": ["applinks:halalfoodnearme.com"]
    }
  }
}
```

## Cold start times matter more than you think

Consumer directories with slow launch drop users at ~2s. Real budget:

- Splash → interactive: 1500ms max on iPhone 12
- Search input → first API call: 100ms (debounce doesn't count; the first render should be immediate)

Ways to save time:
- Don't `await` non-critical initialization on splash — kick it off but don't block
- Lazy-load React Query devtools (dev-only anyway)
- Skip Sentry init on release builds if it's blocking splash — init after first paint
- Fonts loaded via `useFonts` gates the app; if it takes >1s, the network is the culprit — pre-download or embed

## PostHog + Sentry double-track user IDs

Both platforms track anonymous → identified. Make sure your `identify()` call fires on sign-in AND on app-launch-with-existing-token, otherwise a signed-in user shows up as anon in both dashboards.

## Expo Push tokens rotate

- The Expo Push token can change between sessions (rare but happens on iOS after long inactivity)
- Send it to your backend on every app launch, not just first-time
- Backend: dedupe on `(user_id, token)` and update `last_seen_at`

## iOS haptics on button taps — small touch, big polish

Every primary CTA should fire a haptic. `expo-haptics`:

```ts
import * as Haptics from "expo-haptics";
onPress={() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  handleSubmit();
}}
```

Skip on destructive actions unless you want it to feel intentional.

## RN's `flexShrink` doesn't behave like the web

Text that overflows a flex row: on the web, `flex-shrink: 1` fixes it. On RN, you often need `flex: 1` on the parent AND `flexShrink: 1` on the text child, PLUS `numberOfLines={1}` if you want ellipsis. Test with long restaurant names ("Habibi's Traditional Yemeni Mandi & Zabihah Grill Halal Restaurant").

## Bottom sheets: pick one library and commit

Options:
- `@gorhom/bottom-sheet` — most mature, gesture-driven, works well with `react-native-reanimated`
- `@react-navigation/bottom-sheet` — official, simpler API, less flexible

Pick one and use it everywhere. Mixing bottom sheet libraries in one app is a debugging nightmare.

## `SafeAreaView` doesn't play well with `expo-router` on iOS 17+

Use `react-native-safe-area-context`'s `useSafeAreaInsets` hook and apply insets manually. `<SafeAreaView>` sometimes double-applies inset padding when nested in `expo-router` layouts.

## Testing on simulator ≠ testing on device

- Push notifications don't work on simulator (period, no workaround)
- Sign in with Apple: works on simulator but flow is different from device
- Location permissions: simulator uses mock coords by default; test with real GPS
- Haptics: simulator can't produce them

Rule: always ship a real-device test pass before TestFlight submission.

## Xcode signing certs expire

- Apple Developer certs expire yearly
- Provisioning profiles expire when certs do
- EAS will remind you but the reminder can slip
- Rebuild ~2 weeks before expiry to avoid a "we can't push an update" moment

## App Store reviewers are humans in different time zones

- Submission → decision typically 24-48 hours
- Rejection with cryptic text: reply politely in App Store Connect with more context
- If reviewer needs a test account: put credentials in the review notes (not in the app UI or elsewhere)
- Don't submit late Friday hoping for weekend review — rare but possible

## PostHog RN SDK's autocapture is noisier than web

By default it captures every touch. That's fire-hose data on mobile. Disable autocapture and instrument specific events:

```ts
PostHog.init(POSTHOG_KEY, {
  captureAppLifecycleEvents: true,
  captureDeepLinks: true,
  autocapture: false,  // <-- important
});
```

Then track: `sign_up`, `sign_in`, `search_executed`, `place_viewed`, `dispute_filed`, `favorite_added`, etc.

## The API's Supabase Postgres will auto-pause on free tier

If the API returns weird empty responses after a period of inactivity, Supabase may have paused the project. See `roadmap/README.md`'s "guardrails and escape hatches" — the scheduled ping we set up should prevent this. If you see it, contact the founder.

## Don't ship AI-derived signals in the consumer surface

You'll be tempted. Especially with something like "we noticed a lot of recent disputes on this restaurant — here's an AI summary of what's being reported." Don't. Read `content/ethics/ai-ethics.md`. The commitment is public. Breaking it costs the brand more than any UX polish gains.

## The verifier flywheel matters more than the app

If verifier recruitment stalls, no amount of iOS polish will save the platform. Prioritize backend features that make verifiers effective (nominate-a-restaurant, cleaner visit reports, mobile visit submission when Phase 11 comes) over consumer-side polish that only benefits diners. The consumer app is the user-facing surface; the verifier community is the actual product.
