# Photos — owner, diner, and review provenance

How place photos are attributed, grouped, and moderated once diners can attach
photos to reviews. Companion to `docs/2026-07-18-reviews-plan.md`.

## What Google and Yelp actually do

**Google Business Profile** tabs photos by provenance — All, By owner, By
visitors — plus category tabs (Food & drink, Menu, Interior, Exterior, Team).
Newest-first within a tab. Owners choose a cover photo, but Google reserves an
override: *"if the cover photo you select is low-quality or if other sources
suggest that it's not the best photo to represent your business, a
user-submitted photo may be selected instead."* Owners **cannot delete**
customer photos — they can only report them.

**Yelp** splits the same way with different emphasis. Customer photos are
ranked algorithmically on community votes and recency and owners cannot
reorder them. Owner photo ordering is a *paid* upgrade (the Slideshow tool).
"Popular Dishes" is auto-selected from review photos and explicitly not
owner-controllable.

The shared principle, and the one worth copying: **provenance is always
visible, and a business controls its own photos but never its customers'.**
Neither platform blends the two into one anonymous stream. On a halal-trust
platform that principle matters more than it does for either of them — a photo
of what was actually served is evidence, and the party it implicates must not
be able to quietly delete it.

## Decisions (locked)

| Question | Decision |
|---|---|
| Gallery layout | **Tabs: All · By owner · By diners.** Default All, newest-first within each. |
| Cover photo | **Owner-supplied only.** A diner photo can never become the hero, by any path. |
| Review photos | **Both** — inline under the review, and in the diners tab with a link back to the review that explains them. |
| Owner controls | **Report only** on diner photos, into the same moderation queue reviews use. Owners still fully manage their own. |

---

## Pre-existing bugs this work has to fix first

The audit turned up four problems that predate reviews. Two are live in
production data today.

**1. `PlacePhotoSource.GOOGLE` is a type lie.** The enum has three values
server-side (`OWNER`, `CONSUMER`, `GOOGLE`); every frontend types it as
`"OWNER" | "CONSUMER"`. The data-ops backfill
(`internal-tools/data-ops/ops/runners.py`) has already written GOOGLE photos
with `is_hero=True`. On the consumer lightbox they hit an undefined key in
`SOURCE_LABEL` and render a blank attribution chip. Mobile has the same bug
plus a `VERIFIER` label that isn't a real enum value at all.

**2. The synthesized hero slide claims to be an owner photo.**
`place-detail-client.tsx` builds a fake lightbox slide with
`id: "__hero__"` and hardcoded `source: "OWNER"` when the hero isn't in the
photos array. So an unattributed hero currently asserts owner provenance
regardless of who took it — the exact failure this whole plan exists to
prevent.

**3. `review_id` is on the row but on no read schema.** No client can tell a
review photo from a walk-in consumer upload. This is the hard blocker: nothing
below is possible until it's exposed.

**4. The gallery assumes hero-at-index-0.** `photos.slice(1)` is positional,
not `is_hero`-based, and the lightbox's `startIndex` arithmetic depends on the
same assumption. Any regrouping breaks both index maps. This has to be
rewritten to key off ids rather than positions before tabs go in.

---

## API

### Read schema

`PlacePhotoRead` gains three fields:

```python
review_id: UUID | None      # set when attached to a review
review_rating: int | None   # so the gallery can say "from a 2★ review"
attribution: PhotoAttribution   # derived, see below
```

`attribution` is a derived enum — `OWNER | DINER | REVIEW | GOOGLE` — computed
server-side rather than left to each client to infer from
`source` + `review_id`. Four clients inferring the same rule four ways is how
the mobile `VERIFIER` label happened. One derivation, one place:

```python
def attribution_for(photo) -> PhotoAttribution:
    if photo.review_id is not None:
        return PhotoAttribution.REVIEW
    if photo.source == PlacePhotoSource.GOOGLE:
        return PhotoAttribution.GOOGLE
    if photo.source == PlacePhotoSource.OWNER:
        return PhotoAttribution.OWNER
    return PhotoAttribution.DINER
```

### Hero eligibility

Enforced in one helper called by **both** the auto-promote path and the PATCH
path — today only auto-promote guards this, so the manual path is a hole:

```python
HERO_ELIGIBLE_SOURCES = (PlacePhotoSource.OWNER, PlacePhotoSource.GOOGLE)
```

GOOGLE stays eligible because those are the listing's own photos and they're
the only cover an unclaimed place has. `CONSUMER` never is, review-attached or
not. PATCH returns 409 `PHOTO_NOT_HERO_ELIGIBLE` with a message that explains
rather than just refuses: *"Cover photos come from the restaurant. Upload your
own to use as the cover."*

**Migration note:** any place whose current hero is a `CONSUMER` photo needs
re-pointing. One-off script: for each such place, promote the newest OWNER
photo, else the newest GOOGLE photo, else clear the hero. Small enough to run
in the migration itself.

### List endpoint

`GET /places/{place_id}/photos` gains `?attribution=owner|diner|all`
(default `all`). Server-side rather than a client filter because the mobile
viewer paginates and the owner grid will want counts without pulling every row.
Response gains a `counts` block (`{all, owner, diner}`) so tabs can render
their numbers without three requests.

### Photo reports

Owners report diner photos rather than deleting them, which needs a
`place_photo_reports` table. Deliberately a **separate table** from
`place_review_reports` rather than generalizing that one: a photo report has no
`rating`, no reply, and a different set of reasons (`NOT_THIS_PLACE`,
`INAPPROPRIATE`, `MISLEADING`, `PERSONAL_INFO`, `OTHER`). Merging them would
mean a nullable-everything super-table and a queue that has to branch on
content type in every query. Same shape as review reports otherwise: one report
per person per photo, `OPEN | UPHELD | DISMISSED`, required note on takedown.

### Delete permissions — tightened

Current: admin, place owner, or uploader. New: admin, uploader, or place owner
**only for photos they or Google supplied**. An owner deleting a diner's photo
of what they were served is the thing this platform cannot allow, and the
endpoint currently permits it.

---

## Consumer web

### Gallery rewrite (`place-photo-gallery.tsx`)

The index arithmetic has to go first. Photos become a keyed list; the lightbox
takes a photo **id**, not an index, and derives position from the active tab's
array. That's what makes tabs possible at all.

Three tabs with counts — `All 24 · By owner 6 · By diners 18` — hidden entirely
when a place has fewer than ~6 photos, since tabs over eight thumbnails are
furniture.

**Every thumbnail gets a corner chip**, not just the lightbox. The current
design only attributes once you've opened a photo, which means the grid — the
thing people actually scan — is anonymous. A small chip: 🏪 for owner, initial
avatar for a diner.

The `photos.slice(1)` hero-skip is replaced by filtering on `is_hero`.

### Lightbox attribution strip

Rebuilt around `attribution` rather than `source`, so GOOGLE stops rendering
blank:

- `OWNER` → "Photo from the restaurant"
- `DINER` → "Photo by {name}"
- `REVIEW` → "Photo by {name} · from a {rating}★ review" where the second half
  is a **link that scrolls to that review**. This is the whole reason the
  linked option won: a photo of an undercooked plate means something different
  once you can read what the person said about it.
- `GOOGLE` → "Photo from Google"

Plus a Report affordance for diner photos, matching the review Report button.

### Hero

`PlaceHero` gains a small provenance line when the hero isn't the owner's
(i.e. a Google fallback). The hardcoded `source: "OWNER"` synthesis is deleted
outright.

---

## Mobile

`PhotoViewer.tsx`'s `SOURCE_LABEL` map is replaced with the `attribution`
switch, which fixes the phantom `VERIFIER` entry and the missing `GOOGLE` case
in one move.

The place-detail `N photos` pill gains a segmented viewer: same three tabs as
web, rendered as a filter row above the thumbnail strip. The review link opens
the place's review section rather than scrolling, since mobile detail is a
single scroll view.

Mobile still has no upload path for place photos and doesn't need one in this
pass — review photos upload from the review composer, which is already in the
reviews plan.

---

## Owner portal

`PhotosSection` in `my-places/[id]/page.tsx` currently shows an undifferentiated
grid with no source badge, so an owner can't tell their own photos from
diners'. It gains:

- The same three tabs.
- Per-tile chips.
- **Own photos:** Set as hero, Edit caption, Delete — as today.
- **Diner photos:** caption edit removed, Delete replaced with **Report**,
  which opens a reason dialog and files into the moderation queue.

The copy on the Report dialog matters and should say plainly what it does:
*"We'll review this within a day. Photos of what a diner was actually served
stay up unless they break our guidelines — that's what makes this platform
worth trusting."* Owners will try to report honest photos; the dialog is the
cheapest place to set that expectation.

---

## Admin

There is **no place-photo moderation surface at all** today — no route, no
component, no endpoint — despite `photos/repo.py` supporting
`include_deleted=True` "for admin moderation" and the delete endpoint granting
admins blanket rights. It was planned and never built.

New `/reported-photos` queue, structurally identical to `/reported-reviews`:
filter pills defaulting to open, a table with a thumbnail column, a detail view
showing the photo full-size with its place, uploader, account age and any
attached review, and a sticky decision panel: Dismiss · Remove. Removal soft-
deletes (bytes stay in the bucket for audit) and emails the uploader with the
reason, reusing the `review_moderated_author` pattern.

---

## Build order

1. **API foundation** — `attribution` on `PlacePhotoRead`, `review_id` +
   `review_rating`, `?attribution=` filter, `counts` block. Nothing renders
   differently yet; every client keeps working.
2. **Hero eligibility** — one shared helper on both paths, the 409, and the
   migration that re-points existing consumer-photo heroes.
3. **`place_photo_reports`** table, report endpoint, tightened delete
   permissions.
4. **Gallery index rewrite** — ids not positions, `is_hero` not `slice(1)`.
   Behaviour-neutral, lands on its own so a regression here is obvious.
5. **Consumer tabs + thumbnail chips + rebuilt lightbox strip**, including the
   review back-link and the deletion of the hardcoded `source: "OWNER"`.
6. **Mobile** attribution switch + segmented viewer.
7. **Owner portal** tabs, chips, and Report-instead-of-Delete on diner photos.
8. **Admin** `/reported-photos` queue.
9. **Verify** — `pytest` + `tsc --noEmit` across all four apps, then an
   end-to-end pass: owner uploads → hero; diner attaches a review photo →
   appears in diners tab, links to the review, cannot become hero, cannot be
   deleted by the owner; owner reports it → admin removes → uploader emailed.

## Deferred

- **Category tabs** (Food & drink / Menu / Interior). Google has them because
  Google has thousands of photos per listing. Below a few dozen they're empty
  furniture. Worth revisiting once a real place has 50+.
- **Community voting on photos**, which is how Yelp ranks. Needs a user base
  first; ranking by recency is honest at this scale.
- **Owner photo reordering.** Yelp charges for it, which suggests it's worth
  something — but the hero is the only position that materially matters today.
