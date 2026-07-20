# App Store Connect — App Review Information

Paste-ready content for the **App Review Information** panel, plus the
guideline-by-guideline reasoning behind it. Keep this updated when the app
changes; a reviewer reading stale notes is worse than one reading none.

## Sign-In Required

Tick **Sign-in required**, and use the account created by:

```
DATABASE_URL='<production url>' make demo-account
```

The script prints which database it is about to write to and asks for
confirmation on anything non-local. Run from a plain `make demo-account` in a
dev shell and it will hit **localhost**, which looks like success and fails at
Apple's sign-in screen a week later. Make sure the target it prints is
production.

If it fails with `column users.email_verified_at does not exist`, that
database hasn't had migrations applied — run `make migrate` against it first.

| Field    | Value                                     |
|----------|-------------------------------------------|
| Username | `appreview@trusthalal.org`                |
| Password | `Rev1ewer-Demo`                           |

**Re-run `make demo-account` after every review cycle.** The reviewer is
explicitly checking that in-app account deletion works (5.1.1(v)), so there's
a good chance they delete this account while testing it. That's the feature
working correctly. The script is idempotent and restores the same
credentials.

## Notes (paste into the Notes field)

> Trust Halal helps Muslim diners find restaurants whose halal status has
> been verified, and shows exactly how strong the evidence is for each one.
>
> **Signing in is optional.** Browsing restaurants, searching, filtering and
> viewing halal details all work signed out. An account is only needed to
> save places and to write reviews.
>
> **Writing a review requires a confirmed email address.** This is a
> deliberate anti-spam control: reviews affect a restaurant's public
> reputation, so we don't accept them from unconfirmed accounts. The demo
> account above is already confirmed, so it can post immediately. If you
> create a fresh account instead, you will be asked to confirm your email
> before the review composer opens — that is expected behaviour, not a bug.
>
> **Location** is used only to sort and filter restaurants by distance. The
> app is fully usable if you decline the permission — use the location
> picker in the search bar to choose a city instead.
>
> **User-generated content controls**, all reachable from the app:
> * Every review has a **Report** action (tap ⚑ on any review that isn't
>   yours) covering false information, harassment, spam and more.
> * After reporting, you're offered the option to **block** that person,
>   which hides their reviews from you. Blocked people are listed under
>   Profile → Blocked people, where blocks can be undone.
> * Review text is screened for profanity and abusive language before it
>   can be posted.
> * **Contact support** is on the Profile tab.
>
> **Deleting your account:** Profile → Delete account. It asks for your
> password and a typed confirmation, then permanently removes the account
> along with the reviews and photos posted from it.

## Guideline notes for whoever maintains this

**5.1.1(v) — account deletion.** `Profile → Delete account`. Removes the
account plus reviews, review photos, diner-uploaded photos, saved places,
preferences and device registrations. Photos published on behalf of a
*restaurant* (owner-side) survive, because they're business content and the
business still exists; the deletion screen says so explicitly rather than
implying everything is gone.

**1.2 — user-generated content.** All four requirements:
1. Filtering — Cloud Natural Language screening on every review, reply and
   report before it can be submitted.
2. Reporting — report action on every review and owner reply, feeding an
   admin moderation queue.
3. Blocking — `Profile → Blocked people`, offered inline after a report.
4. Published contact — `Profile → Contact support`.

**4.8 — Sign in with Apple.** Not required: the app offers only first-party
email/password accounts, no third-party or social login.

**Encryption.** `usesNonExemptEncryption: false` — HTTPS only, no custom
cryptography.

## Before you submit, check

- [ ] New app icon is in the uploaded build — the mark changed from the
      crescent to the eight-point star. Run `python3
      brand-assets/generate_icons.py`, then rebuild; `npx expo prebuild`
      regenerates the iOS asset catalogue and Android `res/` from
      `assets/icon.png`, both of which are gitignored
- [ ] Screenshots re-shot **after** the icon change if any of them show the
      app icon or a splash screen
- [ ] `PLACE_SIGNAL_SECRET` set to a real random value in production (falls
      back to a known default otherwise, which weakens the actor hash)
- [ ] Migrations applied to production (`storage_orphans`, `user_blocks`,
      `place_signals`)
- [ ] API deployed **before** the mobile build reaches TestFlight
- [ ] `make demo-account` run against **production**, not staging
- [ ] Demo credentials above match what's in App Store Connect
- [ ] Signed out of the app, confirmed browsing and search still work
- [ ] Privacy nutrition labels cover: email, coarse/precise location,
      photos, user content (reviews), identifiers and crash/usage data
      (PostHog + Sentry)
- [ ] Privacy policy URL points at the live page
