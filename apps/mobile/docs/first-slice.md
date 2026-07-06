# First slice — MVP scope

What ships in v0. This is the App Store submission target: feature parity with the consumer PWA for the core "find a halal restaurant" flow, nothing more.

## Ship criteria (from `roadmap/README.md`)

- All core flows work end-to-end on iPhone 12–16, iOS 16+
- Sign in with Apple works (App Store requirement)
- Sign in with Google works
- Email sign-in works
- First TestFlight build shipped to at least 20 beta testers
- App Store submission accepted on first or second try
- First 1,000 iOS installs by end of Phase 10

**Timeline target:** TestFlight by week 12 of Phase 10C, App Store live by week 16. Roughly 4 months of solo work.

## Screens in v0

Six screens. In build order:

### 1. Splash + auth stack

`app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`

- Splash: brand mark on cream, fonts loading. Kill it once `useFonts` resolves.
- Sign in: Apple button (top), Google button, email + password fields, "Continue as guest" link
- Sign up: email + password + display name
- Password reset: link to web (out of scope for v0)

**Guest mode is important.** The App Store bounces apps that require sign-in for basic browsing. The consumer PWA lets anonymous users search — mirror it. Sign-in unlocks preferences and favorites; search works without.

### 2. Search (home tab)

`app/(tabs)/index.tsx`

- Search input with debounced query
- "Near me" button — requests location permission on first tap
- Filter sheet (bottom sheet) with halal preference chips: menu posture, cert, alcohol, cuisine multi-select
- Results list — infinite scroll, place cards showing name, cuisine, tier pill, distance, halal profile summary
- Empty state, loading skeleton, error state

Mirror `apps/consumer/src/app/page.tsx` for the exact information hierarchy.

### 3. Place detail

`app/places/[id].tsx`

- Hero: photo gallery (owner-submitted photos or gradient fallback)
- Restaurant name, address, tier pill, distance
- Halal profile card: menu posture, per-meat sourcing, certificate viewer, alcohol policy
- Actions: Save/unsave, Get directions (opens Maps), Report an issue (opens dispute form)
- Dispute form: bottom sheet with attribute picker + description + photo upload

### 4. Preferences

`app/preferences.tsx`

- Halal filter defaults: zabihah only, cert on file, no alcohol on premises
- Notification preferences: new verified restaurants in your area (Y/N)
- Signed-in only — anonymous users see "Sign in to save preferences"

### 5. Favorites (tab)

`app/(tabs)/favorites.tsx`

- List of saved places
- Same card shape as search results
- Sign-in gate for anonymous

### 6. Profile / settings (tab)

`app/(tabs)/profile.tsx`

- Signed-in: display name, email, "Sign out", link to preferences, link to ethics page
- Anonymous: "Sign in / Sign up" primary CTA
- Static links: About Trust Halal (opens trusthalal.org), Privacy policy, AI ethics (opens halalfoodnearme.com/ethics)

## What's deliberately out of scope for v0

- **Verifier surfaces beyond the public profile.** No verifier-visit submission from phone. Web verifier portal is what verifiers use for now.
- **Owner surfaces.** Owners use `owner.trusthalal.org` from a laptop; not a mobile use case.
- **Push notifications.** Wire up Expo Push infra but don't send anything in v0. Add the actual notification content in the first post-launch update.
- **Deep linking beyond `/places/{id}`.** Universal links work for place shares; nothing else needed.
- **Offline mode.** React Query cache is enough. Full offline persistence is post-launch.
- **In-app cert renewal reminders for owners.** Owner feature, not consumer.

## Testing approach

**Unit / integration:** Jest + React Native Testing Library. Test:
- Every hook in `src/lib/api/hooks.ts` — mocked API responses
- Screen-level state transitions — anonymous → signed-in, no results → results, error → retry
- Auth flows — token store round-trip, refresh flow

**Manual / device:** Test on:
- iPhone 12 (oldest supported), iPhone 15 Pro (current), iPhone 16 (latest)
- iOS 16, 17, 18
- Both light + dark system appearance (even if we're light-only, the app should look OK when system is dark)
- Reduce-motion + Dynamic Type on max size
- VoiceOver on the sign-in and search flows

**E2E:** Detox is nice-to-have. If time is tight, skip and lean on TestFlight.

**Beta:** minimum 20 testers on TestFlight for at least a week before App Store submission. Real usage catches bugs the simulator can't. Recruit from verifiers and existing consumer users.

## Deployment

### EAS Build

`eas.json`:
```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": { "production": {} }
}
```

Commands:
- `eas build --profile development --platform ios` → dev client (for Expo Go replacement once you add native modules)
- `eas build --profile preview --platform ios` → simulator build for QA
- `eas build --profile production --platform ios` → App Store build
- `eas submit --platform ios --latest` → uploads to App Store Connect

### App Store submission checklist

- [ ] App Store Connect app created (bundle id: `org.trusthalal.consumer` or similar)
- [ ] Screenshots: 6.7" (iPhone 15/16 Pro Max), 6.5" (older Pro Max), and 5.5" (SE) — see App Store spec
- [ ] App description, subtitle, keywords, promo text
- [ ] Privacy policy URL (live at halalfoodnearme.com/privacy — write this if it doesn't exist)
- [ ] Privacy nutrition labels — data collected + how used
- [ ] Age rating: 4+ (no objectionable content)
- [ ] Category: Food & Drink (primary), Lifestyle (secondary)
- [ ] Sign in with Apple present on the sign-in screen
- [ ] TestFlight external testing beta approved before production submit
- [ ] Review notes: brief explanation of how a reviewer can test the app (create a test account for them if sign-in is required for full functionality)

### Common App Store rejections and how to avoid them

- **Missing Sign in with Apple** when Google/Facebook is offered → include Apple button, no exceptions
- **Broken login** → make sure the review team's test account works; provide credentials in review notes
- **Missing privacy policy** → link it in App Store Connect + in-app "Settings → Privacy"
- **Placeholder content / lorem ipsum** → obvious but happens; audit every screen
- **Crash on launch on the reviewer's device** → run on a physical device before submission
- **Uses location without explaining why** → Info.plist `NSLocationWhenInUseUsageDescription` needs a real sentence: "So we can show halal restaurants near you."

## Post-launch v1 backlog (not v0)

Once v0 ships, in rough priority order:

1. Push notifications (new verified restaurants in your area)
2. Verifier field-kit — submit a visit from phone (moves the verifier flywheel forward)
3. Nominate a restaurant (matches web verifier portal feature)
4. Offline persistence for saved places
5. Android submission (should be mostly config; RN codebase is portable)
6. iPad layout tweaks
7. Widget for iOS home screen (nearest verified halal restaurant)

## Ship-day plan

1. App Store approves the build
2. Flip the release to "Automatically release after approval" or hit "Release this version"
3. Post a launch tweet + LinkedIn from the buildinpublic account
4. Update the roadmap doc (`roadmap/README.md`) with "iOS shipped" milestone
5. Email the verifier community — they get first look and are the most likely early evangelists
6. Buy a bagel

Keep the launch small and human. The consumer flywheel — search → find a place → tell a friend → they sign up — is what actually grows the app. Big splash launches are for people who don't have a real product yet.
