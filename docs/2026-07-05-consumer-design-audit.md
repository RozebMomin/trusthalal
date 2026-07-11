# Design & UX Audit — halalfoodnearme.com (Trust Halal)

Reviewed July 5, 2026 on desktop (1440px) and mobile (390px). Version shown on site: v0.8.0 · 5b391b4.

Overall: the visual system is clean and modern — restrained olive/cream palette, generous whitespace, rounded cards, consistent pill controls, well-written microcopy, and URL-driven search state (shareable links). The foundation is good. The issues below are ranked by how much they hurt real usage.

---

## P0 — Broken or misleading core flows

**1. Searching by name silently discards the location.**
With "Searching 25 mi around Atlanta, GA" active, typing into "Search restaurants by name…" resets the URL to `?q=kabab`, drops lat/lng/radius, removes distances from results, and the location chip reverts to unset ("Near me / Pick a location"). Users think they're searching within their area; they're actually searching everywhere. Name search should stay scoped to the active location, with an explicit control to widen it.

**2. The product's core promise is invisible in results.**
The homepage says "Verified halal, no guesswork — slaughter method, certificate, disputes up front," but every result surveyed (Atlanta, 20 results; NYC empty) shows the same dashed "No halal info yet" badge, and detail pages show only an empty "No halal profile yet" panel. There is no visible example anywhere of what a verified listing looks like. Until coverage improves: rank places with any halal data first, differentiate the verification-tier badges visually (color-coded tiers rather than one gray chip), and consider a sample/demo verified profile so users understand the payoff.

**3. Detail pages are missing table-stakes restaurant info.**
No phone, no hours, no website, no map, no "Get directions." The address is plain text — not even a link to Apple/Google Maps. For a "find food near me" product, a tappable address/directions link is the single most-used action. This is the biggest functional gap on the site.

**4. Dead-end default city.**
New York, NY is the first "Popular" suggestion, but it returns zero results even at 25 mi with no filters. A first-time user's most likely path ends at "Nothing matched." Only list popular cities that have coverage, and enrich the empty state with "Cities with the most listings" links.

**5. Scroll position bugs around navigation.**
Opening a place lands the viewport mid-page (header and "Back to search" scrolled out of view); returning to results resets the list to the top, losing the user's place in it. Restore scroll to top on detail-page entry and restore list position on back.

---

## P1 — Friction and inconsistency

**6. Slow/no feedback on cuisine card tap.** Clicking a cuisine card on the homepage showed no visible response for ~2s before the location dialog appeared. Add an immediate pressed state / instant dialog open.

**7. Desktop Filters modal has no Done/Apply or Clear-all.** It can only be dismissed via the X. The mobile version is a proper bottom sheet with a grab handle and a Done button — bring desktop to parity (Done + "Reset all").

**8. Triple representation of the same filter state.** A selected cuisine shows as (a) a highlighted pill in the row, (b) a removable "Pakistani ✕" tag below, and (c) a "Filters 1" count badge. Pick two at most; the removable-tag row is redundant with the highlighted pill.

**9. "Back to search" falls back to `/`.** Its href discards the query string; opened in a new tab (or if JS history is empty) the user loses city/radius/filters. Link to the full search URL.

**10. Result cards waste vertical space when there's no photo.** The "NO PHOTO YET" block occupies roughly a third of each card (desktop) and half (mobile — barely 1.5 cards per screen). Since most listings currently have no photo, use a compact row layout when no image exists instead of reserving hero space.

**11. Saved/Preferences are unreachable from the mobile header.** They disappear at narrow widths with no menu; only the footer exposes them. Add a compact menu or keep icon-only links.

**12. Auth pages are under-built.** No logo/link back to the site, no "forgot password," no show-password toggle, and the primary button reads as disabled (washed-out olive at rest). The bare centered card also loses all brand context. (Positive: signup explains why the name is collected.)

**13. Build metadata in the production header.** "v0.8.0 · 5b391b43…" is rendered next to Sign up on every page. Move it to the footer only (it's already there) or behind an admin flag.

---

## P2 — Polish

**14. Two clear icons in the search field.** When text is entered, the input shows both a bold ✕ and a lighter ✕ side by side. Keep one.

**15. Sticky header.** The header scrolls away everywhere; on long result lists a sticky (or reappear-on-scroll-up) header keeps search and nav reachable.

**16. Typography inconsistency.** The "Eat halal already?…" community block and verifier page hero use a serif face; everything else is a geometric sans. If the serif is intentional brand voice, use it more systematically (e.g., all section headings); as-is it reads accidental.

**17. Native `<select>` for Sort.** The "Closest first" dropdown is browser-default styling next to fully custom pills. Style it to match the control system.

**18. Route titles don't change.** Every page keeps the homepage `<title>` (e.g., /login, /preferences). Set per-route titles for SEO, history, and tab identification.

**19. Contrast checks needed.** The "No halal info yet" chip over hero photos, the light-gray microcopy (footer, card captions), and the resting state of the olive primary buttons all look borderline for WCAG AA at their sizes. Worth a pass with a contrast checker.

**20. Radius chip row wraps awkwardly on mobile.** "Change" lands alone on a second line and the cuisine pill row is clipped at the right edge with no scroll affordance (fade/gradient hint).

**21. Jargon in filters.** "Menu posture," "Any verified," "Cert on file," "Verifier-confirmed" appear without explanation in the Filters modal (the Preferences page explains them well — reuse those one-line descriptions as tooltips/sublabels in the modal).

---

## What's working well

Accessible names on interactive elements (cuisine cards expose "Find halal Pakistani restaurants near me"), proper dialog semantics on the location picker, URL-driven state, helpful empty states with recovery suggestions, honest and warm copy throughout ("Honest beats polished"), the verifier landing page is genuinely persuasive, and the mobile bottom-sheet filter pattern is exactly right.

## Suggested order of attack

1. Fix name-search dropping location (P0-1) and scroll bugs (P0-5) — small, high-impact.
2. Add tappable address / directions link to detail pages (P0-3).
3. Curate popular cities to those with data (P0-4).
4. Make verification tiers visible and differentiated in results (P0-2) — this is the brand.
5. Batch the P1 consistency items (filters modal parity, duplicate state, card density, auth polish).
