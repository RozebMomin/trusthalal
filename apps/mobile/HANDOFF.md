# Mobile app handoff (Phase 10C)

Welcome. You're picking up the Trust Halal iOS app. Everything you need to move fast lives in this folder — start here, follow the reading order below, and you should be able to scaffold Expo, ship the first screen, and open a PR within a day.

## 30-second summary

Trust Halal is a verified halal-restaurant directory. It's live as a web PWA at [halalfoodnearme.com](https://halalfoodnearme.com), and this folder is where the **native iOS/Android app** gets built. The backend and product decisions are already made — you're implementing the consumer surface as a React Native / Expo app that talks to the existing FastAPI backend.

**Tech stack (locked):**
- **React Native via Expo** (managed workflow) — TypeScript, `expo-router` for navigation
- **Ships iOS first**, Android from the same codebase later
- **Auth via existing FastAPI** at `api.trusthalal.org` — session-cookie today, **needs a token endpoint added** for mobile (see [`docs/api-and-auth.md`](./docs/api-and-auth.md))
- **State via React Query** — mirrors the pattern in `apps/consumer/src/lib/api/hooks.ts`
- **Design tokens** documented in [`docs/design-system.md`](./docs/design-system.md) — warm cream / olive palette, Cormorant Garamond serif, Inter body

**Non-negotiables:**
- **Sign in with Apple** is required by the App Store for consumer apps offering third-party sign-in
- **No AI-derived signals appear on any consumer surface.** Read [`../../content/ethics/ai-ethics.md`](../../content/ethics/ai-ethics.md) before touching anything AI-related. Every trust designation is a human decision. Full stop.
- **The consumer PWA is the source of truth for feature parity.** When in doubt about what a screen should do, mirror `apps/consumer/src/app/...`.

## Reading order

Read these in order — each builds on the last. All total ~30 minutes.

1. **[`docs/architecture.md`](./docs/architecture.md)** — the tech stack, locked decisions, folder structure, why we picked what we picked
2. **[`docs/api-and-auth.md`](./docs/api-and-auth.md)** — how to talk to the backend + the auth model (this is the trickiest piece and needs backend changes)
3. **[`docs/design-system.md`](./docs/design-system.md)** — palette, typography, component patterns, how to make it look like Trust Halal
4. **[`docs/first-slice.md`](./docs/first-slice.md)** — the MVP scope, ship criteria, testing approach, deployment
5. **[`docs/gotchas.md`](./docs/gotchas.md)** — what will bite you (session cookies in RN, universal links, App Store review, cold start)

## What's already been done

**Product surfaces live in prod:**
- Consumer PWA: [halalfoodnearme.com](https://halalfoodnearme.com)
- Admin panel: [admin.trusthalal.org](https://admin.trusthalal.org)
- Owner portal: [owner.trusthalal.org](https://owner.trusthalal.org)
- Brand landing: [trusthalal.org](https://trusthalal.org)
- API: [api.trusthalal.org](https://api.trusthalal.org) — FastAPI, deployed on Render, backed by Supabase Postgres

**In the repo (worth knowing where things are):**
- `api/` — FastAPI backend. `api/openapi.json` is the canonical schema. Auth lives in `api/app/modules/auth/`. Places/search in `api/app/modules/places/`. Halal profiles in `api/app/modules/halal_profiles/`.
- `apps/consumer/` — the PWA you'll mirror. Every hook you need to reimplement is in `apps/consumer/src/lib/api/hooks.ts`.
- `apps/admin/`, `apps/owner/`, `apps/brand/` — sibling web apps. Not directly relevant to mobile but useful for spotting patterns.
- `content/ethics/ai-ethics.md` — MUST READ before any AI work
- `marketing/style-guide/brand-voice.md` — the voice for all consumer copy
- `marketing/style-guide/visual-style.md` — palette, typography, component philosophy
- `roadmap/README.md` — Phase 10 (verifier community + AI-assist + iOS app) context

**Brand assets you'll need:**
- Trust Halal Verified badge (for restaurants): `marketing/owner/badge/verified-badge.svg`
- Trust Halal Verifier badge (for community verifiers): `marketing/verifier/badge/verifier-badge.svg`
- Wordmark: rendered via typography, not a separate asset — Cormorant Garamond 600, olive `#5B6F2B`

## What's NOT done yet

You'll be building all of this:

- The Expo project itself (scaffold, config, EAS setup)
- Every screen (auth, search, place detail, preferences, saved, profile)
- The backend's mobile-token endpoint (small backend addition; see api-and-auth.md)
- Push notifications (Expo Push + backend job to send them)
- App Store metadata (screenshots, description, privacy nutrition labels)
- Apple / Google developer accounts + provisioning
- Universal links (apple-app-site-association file on the consumer site)

## Environment you'll need

- **Node** 20+
- **Expo CLI** — `npx create-expo-app@latest --template` (do NOT use the deprecated `expo-cli` global)
- **EAS CLI** — `npm install -g eas-cli`
- **Xcode** 15+ (macOS only — required for iOS Simulator + real device builds)
- **Apple Developer account** ($99/year — the founder will provide credentials or invite you)
- **Google Play Console** account ($25 one-time — later, when Android ships)

## How to talk to the founder

- Ship-blocker questions → post in the shared Slack (or wherever comms happen)
- Design decisions → check `marketing/style-guide/` first, then ask
- Backend API additions → this repo is one codebase; open a PR touching `api/` too and tag for review
- AI-related decisions → read `content/ethics/ai-ethics.md` first, then discuss. Do not ship AI-derived consumer signals without an explicit conversation.

## The one thing you should NOT do

**Do not introduce AI-derived signals into any consumer-facing screen or copy.** The ethics doc is public and load-bearing for the brand. Priority scoring, questionnaire flagging, dispute clustering, cert OCR — all admin-only, invisible to the mobile user. Even a well-intentioned "our AI says this restaurant is 87% likely to be halal" would undo months of trust-building. If you're not sure whether something crosses the line, it does — flag it, don't ship it.

## Ready?

Start with [`docs/architecture.md`](./docs/architecture.md). Good luck — this app is going to matter.
