# Trust Halal — App Store & Play Store listing copy

All copy below is written to the real feature set (search, trust tiers,
in-person verification, menu-posture detail, ratings/hours/open-now,
directions/call, offline favorites, verifier program). Character counts are
noted for every length-limited field. Nothing claims a rating or reviews you
don't have yet.

---

## 1. App name / Title  (max 30 chars)

**Recommended:** `Trust Halal: Halal Finder`  *(25)*

Alternates:
- `Trust Halal — Halal Near Me`  *(27)*
- `Trust Halal: Verified Halal`  *(27)*
- `Trust Halal`  *(11 — cleanest, weakest for search)*

---

## 2. Subtitle  (iOS, max 30 chars)

**Recommended:** `Verified halal, near you`  *(24)*

Alternates:
- `Find halal you can trust`  *(24)*
- `Halal you can actually trust`  *(28)*

---

## 3. Short description  (Play Store, max 80 chars)

`Find halal restaurants you can trust — verified in person by the community.`  *(74)*

Alternate:
`Halal restaurants near you, with a trust level you can actually rely on.`  *(71)*

---

## 4. Promotional text  (iOS, max 170 chars — editable without a review)

`Every listing is checked — a certificate, sourcing details, or an in-person visit by the community. Find halal you can trust, near you. Free to use.`  *(148)*

---

## 5. Keywords  (iOS, max 100 chars, comma-separated, no spaces)

`zabihah,muslim,restaurants,ramadan,eid,certified,nearby,mosque,iftar,dining,food finder,directory`  *(97)*

Notes: deliberately omits words already in the title/subtitle (halal, near,
trust, verified, find) — Apple already indexes those, so don't waste keyword
space on them. Play Store ignores a keyword field; it indexes the full
description instead (the description below already works those terms in).

---

## 6. Description  (iOS & Play, max 4000 chars — same copy works for both)

Halal you can trust — because every listing on Trust Halal is checked, not guessed.

Trust Halal helps you find halal restaurants near you and know exactly how halal they are before you go. No more calling ahead, scanning reviews, or hoping for the best.

WHY TRUST HALAL IS DIFFERENT
Every place shows a clear trust level, so you always know what you're looking at:
• Trust Halal Verified — confirmed in person by someone from the community
• Certificate on file — a valid halal certificate we've reviewed
• Owner-attested — the restaurant told us their halal posture, and we show you exactly what they said

KNOW BEFORE YOU GO
Open any place for the full picture:
• Fully halal vs mixed kitchen
• Zabihah, by meat (chicken, beef, lamb, and more)
• Whether alcohol or pork is on the menu
• Certification details and who issued them
• Honest caveats, like "halal only at lunch"

FIND HALAL, FAST
• Search halal spots near you or in any city
• Filter by trust level, cuisine, pork-free, no alcohol served, and more
• See star ratings, opening hours, and what's open right now
• Get directions or call in a single tap
• Save your favorites — available even offline

BUILT ON TRUST, NOT ADS
No pay-to-play badges. Real people verify places in person, and the highest tier of trust is only earned that way. Spotted something off? Trust Halal takes reports seriously and reviews every one.

JOIN THE COMMUNITY
Become a Trust Halal verifier and confirm halal spots in your area. The visits you file are what earn places their verified status — and help every Muslim diner near you eat with confidence.

Free to use. Made for the halal-conscious diner.

---

## 7. What's New / Release notes  (v1.0)

Welcome to Trust Halal. Find halal restaurants near you, see a clear trust level for every place, and know exactly what's on the menu before you go. Save your favorites, filter by what matters to you, and help the community by verifying places in person. This is our first release — we'd love your feedback.

*(Play Store limits release notes to 500 chars; the above is ~330.)*

---

## 8. Store metadata (fill in App Store Connect / Play Console)

- **Primary category:** Food & Drink
- **Secondary category (iOS):** Lifestyle  *(or Travel)*
- **Content / age rating:** 4+ (iOS) / Everyone (Play)
- **Price:** Free
- **Privacy Policy URL:** https://trusthalal.org/privacy  *(confirm this page exists)*
- **Support URL:** https://trusthalal.org/support  *(or a mailto: support@trusthalal.org)*
- **Marketing URL (optional):** https://halalfoodnearme.com

---

## 9. Privacy declarations — data you'll need to disclose

Both stores require a data-collection questionnaire (Apple "Privacy Nutrition
Labels" / Google "Data safety"). Based on the app, declare:

- **Location** — used to show halal places near you (precise; used at runtime;
  not sold; not used for tracking).
- **Account / Contact info (email, name)** — for sign-in and saving favorites.
- **Product interaction / analytics** — PostHog usage events; **not** linked
  to advertising or third-party tracking.
- **Crash data** — Sentry, for stability.

State that data is **not sold** and **not used to track you across other apps**.

---

## 10. Quick pre-submission checklist

- Screenshots: 6.9" iPhone set (1290 × 2796) — Apple auto-scales to smaller sizes.
- Show HALAL places in screenshots (not non-halal chains) and lead with the
  `✓ VERIFIED HALAL` badge + the Trust Profile screen.
- Do NOT ship the template's fake "4.8 rating" / invented testimonials until
  you have real ones (Apple can reject; it's also misleading).
- Confirm the Privacy Policy + Support URLs resolve before you submit.
