# Versioning

Each frontend app shows a small build-version tag near the sign-out
button:

```
v0.1.0 · abc1234
```

The format is **manual semver** + **short git SHA**. Hover for the
full SHA.

## Where to look

| App           | Location of the tag                                       |
| ------------- | --------------------------------------------------------- |
| `apps/admin`  | Sidebar footer, below the "Sign out" button.              |
| `apps/owner`  | Top-right header, next to the "Sign out" button.          |
| Consumer site | TBD — same component pattern when it's built.             |

When a non-staff user lands on the admin panel (or a non-OWNER lands
on the owner portal), the tag also appears under the sign-out button
on the "this tool isn't for you" pane. Same component, same value.

## How the value is composed

1. **Manual semver** comes from the app's `package.json` `version`
   field. Bump this when you ship something users should know about.
2. **Short git SHA** comes from `NEXT_PUBLIC_APP_RELEASE_SHA` (the
   first 7 chars). Vercel auto-populates `VERCEL_GIT_COMMIT_SHA` —
   wire it on the project's env-var page:
   ```
   NEXT_PUBLIC_APP_RELEASE_SHA=$VERCEL_GIT_COMMIT_SHA
   ```
   When the SHA env var is empty (e.g. local dev) the tag falls back
   to just `v0.1.0` — no broken-looking placeholder.

## When to bump the semver

There's no strict rule, but a useful default is:

* `0.x.0` → meaningful new feature shipped (org self-service, claim
  flow, halal disclosure model, etc.).
* `0.x.y` → bug fixes, copy tweaks, small UX improvements.
* `1.0.0` → first time you'd point a real user at the prod site
  without "alpha / beta" caveats.

The semver is per-app — `apps/admin`, `apps/owner`, and the future
consumer site can each be on different numbers. They ship from the
same repo but they're different products to different audiences and
shipping a tiny admin tweak shouldn't bump the customer-facing
version.

## Why not auto-only

Pure git SHA changes every commit. After a typical day of work the
prod app would be on `v3a7c91f` and nobody would have a sense of
whether anything *meaningful* shipped. Manual semver is the layer
that says "this is a milestone." The SHA appended after it is the
"did my latest commit actually deploy?" check that's useful during
debugging.
