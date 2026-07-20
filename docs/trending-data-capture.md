# Trending — data capture

Nothing in the product reads any of this yet. It exists because trending is a
velocity measure and velocity needs history, and history is the one thing that
cannot be added later. Every day without capture is a day the eventual feature
can't reason about, so the recording ships far ahead of anything that consumes
it.

## What's captured

`app.place_signals`, one row per (place, signal, day, actor):

| Signal | Source | Notes |
|--------|--------|-------|
| `VIEWED` | `GET /places/{id}` | Server-side. Never accepted from a client. |
| `DIRECTIONS` | beacon | Highest intent short of a review. |
| `CALLED` | beacon | |
| `SHARED` | beacon | Mobile only for now. |
| `FAVORITED` | `POST /me/favorites/{id}` | First save only — the endpoint is idempotent. |
| `REVIEWED` | `create_review` | Recorded in the repo, so every path that creates a review is covered. |
| `PHOTO_ADDED` | backfill only | Not yet wired to the live upload path. |

Weighting is deliberately absent. Weights get tuned against real data, and a
signal thrown away at write time is gone — so capture records what happened
and leaves the judgement to whatever computes trending.

Favorites, reviews and consumer photos were backfilled from their existing
timestamps, so the table starts with real history rather than starting from
the deploy. Views and directions could not be: they only ever existed as
PostHog events, which is exactly the gap this closes.

## Why not just query PostHog

The client events already fire and PostHog has them. It's the wrong substrate
for a product feature on three counts: its retention window expires, its query
API is too slow and too rate-limited to sit in a request path, and the events
are self-reported by clients — so anyone who wants their restaurant to trend
can simply say so. This table is first-party, written server-side where it
matters, and joins to `places` in one query.

## The dedup key

`actor_hash` is a salted hash of whoever produced the signal, and the salt
folds in the date, the place and the signal. Three consequences, all
intentional:

- The raw identifier is never stored.
- The value rotates daily, so it can't be used to follow one person over time.
- The same person produces unrelated values for two different places, so the
  column can't be used to reconstruct one person's browsing even by someone
  holding the secret.

`user_id` is deliberately absent. Nothing needs to know who did what, only how
many distinct someones did it — and keeping the table unlinked means this is
unlinked usage data for App Privacy, so it changes nothing about the
declarations already published.

**This is the part that had to be right on the first row.** Counting rules can
be rewritten in a query whenever the feature is built. Rows written without a
usable dedup key can never be collapsed retroactively — a place with one
obsessive fan and a place with forty visitors would be indistinguishable
forever, and "trending" would measure enthusiasm for refreshing a page.

Signed-in users dedup by user id. Anonymous ones fall back to a coarse
fingerprint (client address + user agent), which under-counts — a household
behind one NAT counts once — but errs in the safe direction: it can't be used
to manufacture traffic.

## When it's built: things to get right

**Trending is not popularity.** A ranking of raw counts returns the same
famous restaurants every week. The measure is a window against the place's own
baseline — activity in the last N days over its trailing average — so a quiet
place having an unusual week can surface.

**The catalogue is far too small today.** At the volumes this platform has now,
one person opening a page twice would make something "trend". This is the same
failure mode as the `MIN_REVIEWS_TO_RANK` bug in the ratings sort: a threshold
sized for a mature platform, shipped onto an empty one, producing confident
nonsense. Gate the tab on a real floor — a minimum number of distinct daily
actors in the metro before it appears at all — and apply shrinkage toward the
metro average so three views can't outrank forty.

**"Trending in Atlanta" needs no new reference data.** Every place already has
`city`, `region`, `country_code`, and PostGIS geometry. The metro for a given
user is the `(city, region, country_code)` with the most places within ~40
miles of them: Stone Mountain has a handful, Atlanta has hundreds, Atlanta
wins. It self-corrects as the catalogue grows, in every market, with nothing to
maintain. Group on the whole tuple, not the city string — city names collide
across states.

**`PLACE_SIGNAL_SECRET` must be set in production**, and rotating it silently
breaks per-day deduplication for the day it changes. That's survivable but
worth doing deliberately rather than by accident.
