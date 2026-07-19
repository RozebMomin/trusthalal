# Reviews — diner reviews, owner replies, report-based moderation

The last major feature before launch. Consumers rate and review places;
owners reply publicly from the owner portal; bad content is handled by a
report button plus an admin queue rather than a pre-publish gate.

## Decisions (locked)

| Question | Decision |
|---|---|
| What a review captures | **Stars + free text.** 1–5 overall rating, optional title, required-ish body. No halal-specific structured fields in v1. |
| Moderation posture | **Publish immediately, moderate on report.** A `Report` button plus an admin queue. No pre-publish approval. |
| Google ratings | **Label Google's, show ours separately.** The bare `★ 4.3` becomes explicitly Google's; the Trust Halal rating gets its own slot and its own count. |
| Owner surface | **Both.** A global `/my-reviews` inbox *and* a reviews tab inside `/my-places/[id]`. Desktop gets a fifth nav link; **mobile stays at four tabs** with Reviews reached from a badged card on Home. |
| Author attribution | **No verifier badge on reviews.** Every review renders identically regardless of the author's role. |
| Who may post | **Signed in with a confirmed email address.** No guest reviews, no unconfirmed accounts. Phone verification rejected. Requires building email verification first — see the prerequisite section. |
| Sort | Most recent (default) · Highest first · Lowest first. |
| Admin actions | Dismiss · Hide · Remove. **Admins never open a dispute on a diner's behalf** — that's the consumer's to file. |
| Replies | One public reply per review, owner-authored, editable, deletable. Google's model. |
| Text moderation | **Blocking pre-submit check** on review bodies, reply bodies, and report details. Profanity/toxicity is detected and the submit is refused with an explanation. See the caveat below on defamation. |
| Scanner outage | **Fail closed**, consistent with the photo pipeline — nothing publishes unscanned. Paired with draft preservation, auto-retry, and honest error copy so the cost isn't lost reviews. |
| Review photos | **Yes**, up to 3 per review, through the existing `places/photos/` pipeline (HEIC convert, EXIF strip, Cloud Vision SafeSearch, public bucket). |

### On "stars + text only"

Worth naming the tradeoff explicitly so it's a choice and not an accident:
this makes reviews a **parallel opinion layer that never touches the trust
profile**. A place can hold Trust Halal Verified and carry 2.3 stars, and the
two numbers will never reconcile, because one measures proof and the other
measures dinner. That's fine — it's how every other platform works, and it
keeps the review box low-friction — but it means reviews contribute nothing
to verification freshness. If we later want review signal to feed trust, the
natural upgrade is an optional "did the halal info here match what you saw?"
follow-up question that routes a `No` into the existing **dispute** flow.
Designing the schema with room for that now costs nothing (see `PlaceReview`
below); building it now does.

### On "no defamatory language … should be detected"

Two different things got bundled together here, and only one of them is
buildable. Worth separating them precisely, because the gap is where the real
risk lives.

**Profanity and toxicity are detectable.** Slurs, obscenity, harassment,
threats, sexual content — a classifier scores these reliably enough to block
at submit. That part of the request ships as specified.

**Defamation is not detectable, by us or by anyone.** Defamation is a false
statement of fact that damages a reputation. Whether a statement is
*defamatory* depends entirely on whether it's *true* — which is a question
about the world, not about the text. Consider:

> "They served me pork and told me it was lamb."

If it happened, that's a protected account of a real experience and exactly
the kind of thing this platform exists to surface. If it's fabricated by a
competitor, it's defamatory and could end a restaurant. **The two sentences
are byte-identical.** No classifier, ours or Google's or a frontier model's,
can tell them apart, because the difference isn't in the language.

So the honest design is: block the language we *can* detect, and handle the
rest through the report queue, where a human weighs a specific claim against
context — which is precisely what the report button is for. A filter that
claimed to catch defamation would be worse than none, because it would create
false confidence that nothing damaging gets through.

A second-order trap to avoid: tuning the filter aggressively enough to catch
"defamatory-sounding" text means blocking genuine negative reviews. On a
halal-trust platform, "I asked and the manager admitted the chicken isn't
zabihah" is *the single most valuable review anyone could write*. An
over-tuned filter silently destroys the feature's reason to exist. When
calibrating, err toward permissive and lean on the report queue.

### Prerequisite — email verification does not exist yet

**This lands before any review code.** An audit of `auth/` found no account
verification of any kind: `users` has `id`, `role`, `email`, `display_name`,
`password_hash`, `is_active`, and timestamps — no `email_verified`, no
`phone`. Both signup endpoints create the row and immediately mint a session.
The signup docstring is explicit that this was a choice: *"No email
verification (deliberate; revisit if abuse warrants it)."* Reviews are the
abuse warranting it.

The good news is the machinery exists and anticipated this. `app.invite_tokens`
carries a `purpose` discriminator (currently `INVITE` and `PASSWORD_RESET`)
and its docstring names email verification as the intended third value.
`invite_repo.mint_invite` / `resolve_invite` / `consume_invite` already take
`purpose` as a parameter and need no changes. `password_reset.py` (~100 lines)
is a direct template: purpose constant, TTL setting, audience→origin allowlist,
Resend send.

What it takes:

1. Migration: `users.email_verified_at` (nullable timestamptz — carries the
   boolean *and* the audit trail), plus drop/recreate
   `ck_invite_tokens_purpose` to admit `'EMAIL_VERIFICATION'`.
2. `auth/email_verification.py` mirroring `password_reset.py`, reusing
   `_AUDIENCE_ORIGINS`. One new template pair.
3. `POST /auth/verify-email/resend` and `POST /auth/verify-email`. Rate-limit
   resend at least as tightly as forgot-password (5/min, 20/hour).
4. Mint + send on both signup paths. Backfill invite-completed users to
   verified, and set it in `set_password_with_invite` — completing an invite
   already proves control of that address.
5. A `require_verified_email` dependency, applied to **review create/edit and
   reply create/edit only**. Not to browsing, not to favorites — don't
   interrupt signup→value for everything.

`mint_invite` already hard-deletes any live token for the same
`(user_id, purpose)` pair, so "resend" works correctly with zero extra code.

**Backfill decision:** existing accounts predate this. Grandfathering them all
to verified is wrong (it's exactly the unverified population we're worried
about), and invalidating them all is hostile. The middle path: backfill
invite-completed accounts to verified, leave self-signups unverified, and let
the first review attempt trigger the confirmation email. Volume is small enough
today that this is a non-event.

### On phone verification

Rejected, and worth recording why so it isn't relitigated.

None of the platforms this feature is modeled on require it. Google's bar is a
signed-in Google account, Yelp accepts email or social login, TripAdvisor is
membership signup. Email is the industry floor for reviews; phone is reserved
for higher-stakes trust (Airbnb hosting, payments).

Against it specifically here: no SMS vendor exists in the codebase, so it's a
new dependency, new secrets, new per-message cost, and a new failure mode.
`ownership_requests.contact_phone` was already *removed* in a prior migration,
so the platform has been moving away from collecting phone numbers. And it
excludes real people — shared phones, VOIP numbers, users who won't hand a
number to a new app — to stop an attacker who can buy a burner SIM.

**Also worth being clear-eyed: email verification is a weak signal too.**
Ten-minute mailboxes are free and instant. It stops accidental spam and raises
the cost of casual abuse; it does not stop a determined competitor. The
controls actually carrying weight are the ones already in the plan: one review
per person per place (unique constraint), the 10/hour create limit, the report
queue, and admin visibility into account age. Email verification raises the
floor. It doesn't close the door, and the plan shouldn't pretend otherwise.

### On the naming collision

"Review" already means **staff adjudication** throughout this codebase —
`UNDER_REVIEW`, `reviewed_by_user_id`, `decided_at`, the admin queues. To
keep that unambiguous:

- The model is `PlaceReview`, never `Review`.
- The admin surface is called **Reported reviews** / `/reported-reviews`,
  never "review queue".
- The moderation status enum is `PlaceReviewStatus`, whose values are
  `PUBLISHED | HIDDEN | REMOVED` — deliberately **not** `UNDER_REVIEW`.

---

## Data model

New module `api/app/modules/reviews/` following the flat house layout:
`enums.py`, `models.py`, `schemas.py`, `repo.py`, `router.py`. Admin mirror at
`api/app/modules/admin/reviews/` (`router.py`, `repo.py`, `schemas.py`).
Models must also be imported in `app/db/models.py` or autogenerate misses them.

### `place_reviews`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4`, Python-side |
| `place_id` | UUID FK → `app.places.id` | `ondelete="CASCADE"`, indexed |
| `author_user_id` | UUID FK → `app.users.id` | `ondelete="CASCADE"` — deleting an account takes its reviews |
| `rating` | `SmallInteger` | 1–5, `CheckConstraint("rating BETWEEN 1 AND 5")` |
| `body` | `Text` | required, 20–5000 chars enforced in Pydantic |
| `visited_at` | `Date`, nullable | "when did you eat here" — cheap credibility, no verification |
| `status` | `sa.Enum(PlaceReviewStatus, native_enum=False, length=32)` | `server_default=text("'PUBLISHED'")` |
| `moderation_note` | `Text`, nullable | admin-facing reason; shown to the author on removal |
| `moderated_by_user_id` / `moderated_at` | nullable | `ondelete="SET NULL"` |
| `edited_at` | nullable | non-null ⇒ render an "edited" marker |
| `created_at` / `updated_at` | tz-aware | `server_default=func.now()`, `onupdate` on the latter |

Constraints and indexes:

- `UniqueConstraint("place_id", "author_user_id", name="uq_place_reviews_place_author")`
  — **one review per person per place**, edit it rather than stacking. This is
  the single most valuable anti-spam control in the whole feature and it's free.
- Composite index on `(place_id, status, created_at DESC)` — every public read
  is "published reviews for this place, newest first".
- Index on `author_user_id` for `/me/reviews`.

Room for the later halal signal without a rewrite: add
`halal_matched: Mapped[bool | None]` now, nullable, unused by the UI in v1.
One column, no migration later, no cost if we never use it.

### `place_review_replies`

Separate table rather than columns on the review, because a reply has its own
author, its own timestamps, and its own moderation state.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `review_id` | UUID FK → `app.place_reviews.id` | `ondelete="CASCADE"`, **`UNIQUE`** — one reply per review |
| `author_user_id` | UUID FK → `app.users.id` | `ondelete="SET NULL"` — reply survives staff turnover |
| `organization_id` | UUID FK → `app.organizations.id` | who is speaking; drives the "Response from the owner" byline |
| `body` | `Text` | 1–3000 chars |
| `status` | same enum | replies are reportable too |
| `edited_at`, `created_at`, `updated_at` | | |

Relationship on the review: `reply: Mapped["PlaceReviewReply"] = relationship(back_populates="review", cascade="all, delete-orphan", passive_deletes=True, lazy="selectin", uselist=False)`.

### `place_review_reports`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `review_id` | UUID FK, CASCADE | indexed |
| `reply_id` | UUID FK, CASCADE, nullable | set when the *reply* is what's being reported |
| `reporter_user_id` | UUID FK, CASCADE | |
| `reason` | `sa.Enum(ReviewReportReason, native_enum=False)` | `SPAM`, `OFF_TOPIC`, `HARASSMENT`, `FALSE_INFO`, `CONFLICT_OF_INTEREST`, `OTHER` |
| `detail` | `Text`, nullable | required when reason is `OTHER` |
| `status` | `sa.Enum(ReportStatus)` | `OPEN`, `UPHELD`, `DISMISSED` |
| `resolved_by_user_id` / `resolved_at` / `resolution_note` | nullable | |
| `created_at` | | |

`UniqueConstraint("review_id", "reporter_user_id")` — one report per person
per review, so a brigade of one can't inflate the queue.

### Denormalized aggregates on `places`

Adding two columns to `app.places` rather than computing on every search:

- `review_rating_avg: Numeric(2,1) | None`
- `review_count: Integer, server_default="0"`

Recomputed in the same transaction as any review insert/edit/delete/status
change, from `PUBLISHED` rows only, by a single `recompute_place_review_stats(db, place_id)`
helper in `reviews/repo.py`. This mirrors how `google_rating` / `google_rating_count`
already live on the place, which means the search endpoint and every card get
the first-party rating for free with no join and no N+1.

### Migration

`alembic/versions/p9b0c1d2e3f4_place_reviews.py`, `down_revision = "o8a9b0c1d2e3"`
(current head). Creates the three tables, adds the two `places` columns, creates
the indexes.

---

## API

Routers registered bare in `main.py`, prefixes declared on the `APIRouter`.

### Public / consumer

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/places/{place_id}/reviews` | `get_current_user_optional` | Published only. Cursor or offset paging, `sort=recent\|rating_high\|rating_low` (default `recent`). When a caller is present, the response flags `is_mine` so the client can render Edit instead of Report. Also returns a `summary` block: avg, count, and the 1–5 histogram. |
| `POST` | `/places/{place_id}/reviews` | `require_verified_email` | 409 `REVIEW_ALREADY_EXISTS` on the unique violation, with the existing review id so the client can redirect to edit. 403 `EMAIL_NOT_VERIFIED` when unconfirmed. |
| `PATCH` | `/me/reviews/{id}` | author, verified | Sets `edited_at`. |
| `DELETE` | `/me/reviews/{id}` | author only | Hard delete (with its reply, via cascade) — it's the author's own words. |
| `GET` | `/me/reviews` | signed in | The author's own reviews across places, including `HIDDEN`/`REMOVED` with the moderation note, so removal isn't silent. |
| `POST` | `/places/reviews/{id}/report` | `get_current_user` | 409 on duplicate report. |

Reads of another user's non-published review return **404, not 403** — same
existence-non-disclosure rule the visits module already follows.

### Owner

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/me/place-reviews` | owner | The inbox. Filters: `place_id`, `needs_reply=true`, `rating`, `has_report`. Sorted newest-first, unreplied first when `needs_reply` is unset. |
| `POST` | `/places/reviews/{id}/reply` | `assert_can_manage_place` | 409 `REVIEW_REPLY_EXISTS` if one already exists. |
| `PATCH` / `DELETE` | `/places/reviews/{id}/reply` | same | |

The gate is `assert_can_manage_place(db, user, place_id)` from
`organizations/deps.py` — the org-aware one that requires an ACTIVE
`OrganizationMember` with role `OWNER_ADMIN`/`MANAGER` on an ACTIVE/VERIFIED
`PlaceOwner`. Not the older `require_place_owner_or_admin` in `places/deps.py`.

**Consequence worth stating up front:** only *claimed* places have anyone who
can reply. On an unclaimed place, reviews accumulate with no owner voice —
which is a real conversion lever. The consumer page should show "Own this
restaurant? Claim it to respond" under a review on an unclaimed place, linking
to `/get-verified`.

### Admin

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/review-reports` | Queue, filtered by `status`, default `OPEN`. Groups multiple reports of the same review into one row with a count. |
| `GET` | `/admin/review-reports/{id}` | Full review + reply + place + author + all reports on it. |
| `POST` | `/admin/review-reports/{id}/resolve` | Single decide endpoint taking `{decision: "UPHELD" \| "DISMISSED", action: "NONE" \| "HIDE" \| "REMOVE", resolution_note}`. Note **required** when upholding, mirroring `VERIFICATION_VISIT_REJECT_NOTE_REQUIRED`. There is deliberately **no** "open a dispute" action — see below. |

**Admins do not file disputes on a diner's behalf.** A dispute is a consumer's
own accusation against a place, and the record has to stay theirs; filing one
for them would put Trust Halal's institutional weight behind a claim a private
person made, and muddy a dispute trail that's supposed to show who alleged
what. When a removed review contains a factual claim worth investigating, the
removal email can point the author at the dispute flow — they choose whether
to use it. The queue's actions stay: dismiss, hide, remove.
| `GET` | `/admin/places/{id}/reviews` | All reviews on a place regardless of status, for context during moderation. |
| `POST` | `/admin/reviews/{id}/status` | Direct status override without a report, for things we catch ourselves. |

`HIDDEN` vs `REMOVED`: hidden is reversible and the author can still see and
edit it; removed is terminal and the author is told why. Both drop out of
public reads and both trigger a stats recompute.

### Rate limits

Following the existing calibration in `core/rate_limit.py`, all with
`user_or_ip_key`, decorator **below** the route decorator, handler takes
`request: Request`:

- `POST /places/{id}/reviews` — `10/hour`
- `PATCH /me/reviews/{id}` — `30/hour`
- `POST .../report` — `20/hour`
- `POST .../reply` — `30/hour`

### Events + analytics

`PlaceEventType` gains `REVIEW_POSTED`, `REVIEW_REMOVED`, `REVIEW_REPLIED` —
headline transitions only, per the enum's stated rule, written through
`log_place_event`. PostHog: `review_posted`, `review_replied`,
`review_reported`, `review_moderated`.

---

## Text moderation

New module `api/app/core/text_moderation.py`, built as a deliberate mirror of
`places/photos/safesearch.py` — a `Protocol` + a real implementation + a
cached singleton factory + a typed error, so tests inject an in-memory fake
via `app.dependency_overrides` exactly like SafeSearch does today.

### Provider

**Google Cloud Natural Language `moderateText`** (`language.googleapis.com`).
Chosen because it's the same GCP project and the same API-key posture as
Cloud Vision — one key, one rotation point, one vendor, consistent with the
comment already in `safesearch.py`. It returns confidence scores 0.00–1.00
across categories including Toxic, Insult, Profanity, Derogatory, Violent,
Sexual, and Death/Harm. Billed per 100 Unicode characters; a 5000-char
ceiling means a worst-case review is 50 units, and realistic volume is
rounding-error money.

Explicitly **not** Perspective API, despite being the obvious free choice:
Google is retiring it after 2026 and stopped accepting new quota requests in
February 2026. Building on it now means a forced migration within months.

The Natural Language API needs enabling on the project and adding to the
existing key's allow-list, the same one-time step Vision needed (task #97).

### Two tiers, not one

```python
class ModerationVerdict(StrEnum):
    ALLOW = "ALLOW"
    WARN  = "WARN"    # soft — client shows a nudge, submit still allowed
    BLOCK = "BLOCK"   # hard — 400, submit refused
```

Blocking on a single threshold is too blunt for a review corpus where anger is
legitimate. A diner who found pork in their food is entitled to be furious;
they're not entitled to slurs. So:

- **BLOCK** when profanity, insult, derogatory, sexual, or violent/death-harm
  scores ≥ **0.80**. Starting conservative on purpose — see the calibration
  note below.
- **WARN** at ≥ **0.55** on toxicity: the client shows "This reads pretty
  heated — reviews that describe what happened tend to be more useful." The
  user can submit anyway. No server-side consequence.
- **ALLOW** otherwise.

Thresholds live in `settings` (`TEXT_MODERATION_BLOCK_THRESHOLD`,
`TEXT_MODERATION_WARN_THRESHOLD`) so tuning is an env change, not a deploy.

### Where it runs

Applied to every free-text field a user can publish or send to staff:
review `body`, **reply `body`**, and report `detail`.

**Owners are not exempt.** The reply field runs the same check, at the same
thresholds, with the same blocking behavior and the same fail-closed posture as
a diner's review. This is deliberate and worth stating because the instinct is
to trust the verified business more: an owner swearing at a diner in public
does more damage to Trust Halal than the review that provoked it, and owner
replies carry the platform's implicit endorsement in a way anonymous reviews
don't. Reported owner replies are a first-class case in the moderation queue,
not an edge case — hence the nullable `reply_id` on reports and the `status`
column on `place_review_replies`.

**On submission only — not live while typing.** The check runs inside the
existing `POST`/`PATCH` handlers. There is no separate
`/moderation/check-text` endpoint and no debounced client-side call.

Three reasons, in order of weight:

1. **A live check is an oracle.** Scoring text on every keystroke pause lets
   someone iterate against the classifier — type, see it go red, swap a word,
   see it go green — until they find phrasing that passes. One check per
   submission, behind the `10/hour` review-create limit, makes probing
   expensive instead of free.
2. **It removes an abuse surface entirely.** A standalone text-scoring
   endpoint is a free classifier hanging off the API that would need its own
   throttle, its own auth reasoning, and its own monitoring. Not building it
   is strictly better than building it carefully.
3. **Cost.** A long review typed over several minutes would fire 20–30 calls
   instead of one. Small money at launch volume, but it scales with
   engagement, which is the wrong direction for a cost to scale.

The tradeoff being accepted: a user learns their wording is a problem after
hitting Submit rather than while writing. That's fine **because the draft is
already preserved** — the same local-draft mechanism fail-closed requires
covers this case for free. They get the reason inline, edit in place, and
resubmit. Nothing is lost, they just find out a few seconds later.

UX during the call: Submit enters a pending state ("Checking…", button
disabled, textarea still editable). The round-trip is a few hundred
milliseconds — the same budget the photo upload already spends on SafeSearch
without anyone minding.

**The server is the only enforcement point**, which is now trivially true
since it's the only check that exists. Returns `400 REVIEW_TEXT_REJECTED`
with the offending category.

### Failure posture — fail closed (decided)

If the Natural Language API is unreachable, the submit is **refused with a
503**, matching what `places/photos/` already does when Cloud Vision is down.
Nothing publishes unscanned. One rule across both content pipelines: no
answer from the scanner means no publish.

The cost of this choice is real and needs mitigating rather than accepting.
Reviews are voluntary effort — someone who hits an error and loses their typed
draft mostly does not come back to retry. So fail-closed is only acceptable
alongside all four of these:

1. **Never lose the draft.** Persist to `localStorage` on the consumer web and
   to the same on-device draft mechanism mobile already uses for
   file-a-visit (`apps/mobile` has this pattern working today). The text
   survives the error, a refresh, and a force-quit.
2. **Retry automatically before surfacing anything.** Two retries with
   backoff (~1s, ~3s) inside the request. Most Cloud API blips are shorter
   than that and the user never learns one happened.
3. **Say what actually happened.** Not "your review was rejected" — that
   reads as *we judged your content*, which is both false and infuriating
   when it's an infrastructure hiccup. Something like: "We couldn't run our
   content check just now — that's on us, not your review. Your draft is
   saved. Try posting again in a moment."
4. **Alert on it.** A spike in 503s from this path means reviews are silently
   not being written. Sentry on the exception, and it's worth a PostHog event
   (`review_submit_blocked_by_outage`) so the business impact is visible
   rather than invisible.

Without those four, fail-closed quietly converts every Google outage into
permanent lost content. With them, it's a brief delay.

### Calibration

Ship with the thresholds above, then **read the first ~200 blocked
submissions before tightening anything**. The failure mode that matters isn't
profanity slipping through — the report queue catches that. It's a legitimate
halal complaint getting silently refused, which produces no queue entry, no
signal, and a user who quietly stops using the product. Log every BLOCK with
its scores and the (unpublished) text so that review is actually possible.

### What the user sees

Never a bare "your review was rejected." The message names the category and
offers the fix:

> This review can't be posted as written — it contains language our
> guidelines don't allow (profanity). Edit the wording and try again. Strong
> criticism is welcome; we just need it kept civil.

The draft is preserved. Losing someone's typed review to a moderation failure
guarantees they never write another.

---

## Review photos

Up to **3 per review**, reusing `places/photos/` wholesale — the existing
pipeline already does type/size validation (10 MB, jpeg/png/webp/heic/heif),
HEIC→JPEG conversion, EXIF strip (which also means GPS strip — meaningful for
a diner photographing a restaurant), Cloud Vision SafeSearch, and the public
bucket with URLs derived at read time.

Implementation is a nullable `review_id` FK on `place_photos` rather than a
new table: a review photo *is* a place photo that happens to be attached to a
review, and putting it in the same table means it appears in the place gallery
for free and inherits every existing moderation, deletion, and hero-selection
path. Add a partial index on `review_id`, and cap with the same
`ConflictError` idiom as `MAX_PHOTOS_PER_PLACE` (`MAX_PHOTOS_PER_REVIEW = 3`).

Three things this changes that are worth knowing before calling it free:

1. **`MAX_PHOTOS_PER_PLACE = 50` will now be hit by real places.** Fifty is a
   generous ceiling for owner uploads and a low one once every review can add
   three. Either raise it or exclude review photos from the count.
2. **Deleting a review must delete its photos** — including the bucket object,
   not just the row. The existing photo delete is a *soft* delete
   (`deleted_at`), so the orphaned-object cleanup job mentioned in the photos
   router docstring becomes more load-bearing than it is today.
3. **SafeSearch fails closed (503).** So the photo attach step can fail while
   the review text succeeds. Post the review first, attach photos second, and
   let a failed attach be retryable — never lose the written review because an
   image scan timed out.

Upload happens **after** the review row exists (the client needs a `review_id`
to attach to), which means the write flow is: submit text → get review id →
upload photos → done. The UI should show the review as posted as soon as the
text lands, with photos filling in.

---

## Notifications

Two new categories, not one, because they have opposite mandatory-ness:

- `NotificationCategory.REVIEW` — **opt-outable**. "Someone reviewed your
  place", "the owner replied to your review". Marketing-adjacent volume.
- `NotificationCategory.REVIEW_MODERATION` — **mandatory** (added to
  `MANDATORY_CATEGORIES`). "Your review was removed and here's why." That's
  transactional; suppressing it would mean removing someone's speech silently.

New `notify_*` functions in `modules/notifications/events.py`:

| Trigger | Recipient | Category | Push |
|---|---|---|---|
| Review posted | `owner_users_for_place(db, place_id)` | `REVIEW` | yes — `{"path": "/my-reviews"}` |
| Owner replied | review author | `REVIEW` | yes — `{"path": "/places/<id>"}` |
| Review hidden/removed | review author | `REVIEW_MODERATION` | no — email carries the reasoning |
| Report resolved | reporter | `REVIEW` | no |

Each needs a template **pair** (`<name>.html.jinja` + `.txt.jinja`) extending
the `_base` templates, every one passing `preheader` (StrictUndefined will
raise otherwise). Subjects live in the `notify_*` caller, not the template.

Mobile deep links need a `/my-reviews` route to exist on the owner web origin,
and the push `path` for owners should point at the owner portal, not the
consumer app — worth checking the mobile router handles that, since every
existing push path is consumer-side.

---

## Consumer surfaces

### Place detail

New section slotted **between `PlacePhotoGallery` and `DisputeSection`** —
verified facts, then photos, then community opinion, then the "something's
wrong" escalation, then nearby places. Same hand-rolled
`<section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">` as its
neighbors; there's no Card primitive in the consumer app.

Contents: a header with the Trust Halal average, count, and a 1–5 histogram; a
"Write a review" button (signed out → sign-in with return URL); the review
list, each row showing avatar, display name, rating, relative date, body, an
"edited" marker, a Report affordance, and — where present — the owner reply
nested underneath with a distinct background and a "Response from the owner"
byline. Paginate at 10 with "Show more".

**Sort control** sits above the list: Most recent (default), Highest first,
Lowest first. Three options, no "most helpful" — there are no helpful votes.
Each needs its own empty state, though at 0 reviews the whole control hides
rather than offering three ways to sort nothing.

**Unverified users** see the Write a review button, but pressing it surfaces
a confirm-your-email prompt with a resend link rather than the composer.
Showing the button and explaining the gate converts better than hiding it,
and it's the moment the user has a reason to care about confirming.

**No role badges on review rows.** A verifier's review renders exactly like
anyone else's. Verifier standing is earned against *facts* — it says their
observations about halal status are trustworthy — and it doesn't transfer to
weight of *opinion* about a meal. Attribution stays where it's precise: the
verification history. Practically, this means the review read schema exposes
`author_display_name` and nothing about `role`.

`PlaceHero` changes: the bare `★ 4.3 (128)` becomes explicitly **Google**'s,
and the Trust Halal average sits beside it with its own label. Two numbers,
each attributed. This also affects `place-result-card.tsx`, `nearby-places.tsx`,
and the mobile `PlaceCard` / `MapResults` — every place a bare star currently
renders.

The **"Highest rated" sort** on `app/page.tsx` currently means "highest Google
rating" and says so nowhere. It becomes two explicit options, or one option
plus a source toggle. Ordering by first-party rating needs a floor (e.g. ≥3
reviews) or a Bayesian prior, otherwise a single 5-star review outranks a
place with fifty 4.8s.

### Write/edit

A dialog (consumer has `dialog` and `textarea` primitives) with a star picker,
optional visited-on date, body textarea with a live character count, and a
short "what makes a useful review" hint. On 409 `REVIEW_ALREADY_EXISTS`, load
the existing review into edit mode rather than showing an error.

### Mobile

Place detail gets a reviews section mirroring the web ordering, and the write
flow becomes a screen (`app/places/[id]/review.tsx`) rather than a sheet —
star pickers and long text are awkward in a bottom sheet. Types in
`src/lib/api/types.ts`, hooks in `src/lib/api/hooks.ts`, keyed
`["places", "reviews", id]`, per the existing hand-written-types convention.

---

## Owner portal

### Nav

The two surfaces in `src/components/app-shell.tsx` diverge deliberately:

- **`PortalHeader` (desktop)** gets a fifth link, `Reviews` → `/my-reviews`,
  with an unreplied-count badge. There's room for five at that width.
- **`BottomTabBar` (mobile)** stays at **four**. Five forces "Halal Claims"
  down to "Claims" and crowds the bar past the ceiling the code comments there
  already document. Reviews is reached instead from a badged card at the top
  of Home — "3 reviews need a reply" — which does the same attention job a tab
  badge would.

Either way the unreplied count must be visible without navigating; that's the
whole reason the global inbox exists rather than just the per-place tab.

### `/my-reviews`

Filter pills in the admin-queue style (`Button variant={active ? "default" : "ghost"}`):
**Needs reply** (default), All, Reported, By place. Each row: place name,
star rating, author, date, body excerpt, and either a `Reply` button or the
existing reply with `Edit`. Replying happens inline — a textarea that expands
in place, not a dialog, because the whole point is speed across many reviews.

Owner portal has no Card or Badge primitive; sections are hand-rolled
`<section className="space-y-4 rounded-md border bg-card p-5">` and status
badges are one bespoke component per domain. So: `review-status-badge.tsx`
alongside the existing `claim-status-badge.tsx` family.

### `/my-places/[id]`

A Reviews tab on the place detail with the same list scoped to that place,
plus that place's rating summary. `halal-claim-timeline.tsx` is the existing
precedent for a chronological list if the layout needs a reference.

### Reply guidance

Small thing, real impact: a one-line hint above the reply box — replying to
criticism publicly and calmly is the single highest-leverage thing an owner
can do, and most first-time owners reply defensively. A short "what a good
reply looks like" link earns its space.

---

## Admin panel

`/reported-reviews` list + `[id]` detail, plus the two lines in `app-nav.tsx`
and `PATH_ALLOWED_ROLES` in `panel-access.ts` the nav comment describes as
"all it takes".

Structurally this is a near-mechanical transposition of the
**verification-visits** pair: `FILTERS` array → pills → `useReviewReports(status)`
→ `Table` with a dedicated status badge → clickable rows → detail page with
read-only context sections, a sticky bottom decision panel gated on a
`reviewable` boolean, and two dialogs driven by page-level `action` state. The
decision dialog needs a `Textarea` note with `canSubmit = note.trim().length >= 3`,
mirroring the server-side 409. Admin has the full kit (`badge`, `card`,
`dialog`, `select`, `table`, `textarea`, `toast`), so no new primitives.

The `/disputes` module is the closer *semantic* analogue and is worth reading
for how notification-on-decision is wired.

---

## What this plan does not include

Stated so they're conscious deferrals rather than oversights:

- **PII detection in review text.** Cloud DLP could catch a diner posting a
  staff member's phone number or full name. Real risk, separate API, separate
  cost. The report queue covers it at launch volume.
- **Helpful votes, sorting by helpfulness, review search.** Meaningless below a
  few hundred reviews.
- **Verified-diner badges.** No receipt or check-in mechanism exists, so any
  badge would be unfalsifiable.
- **Owner ability to request removal.** Owners get the report button like
  everyone else; a privileged takedown channel invites abuse.

## Legal note, not legal advice

Hosting third-party statements about named businesses is a different risk
posture than hosting structured facts you verified yourself, and "publish
immediately" concentrates that risk. Before launch, the ToS wants a clause
covering user-generated content and takedown, and there should be a documented
path for an owner who believes a review is defamatory. That's a question for a
lawyer, not for this document — flagging it because the decision to
auto-publish is what makes it load-bearing.

## Build order

0. **Email verification in `auth/`** — `users.email_verified_at`, the
   `EMAIL_VERIFICATION` purpose, `email_verification.py`, one template pair,
   two endpoints, `require_verified_email`, backfill. Ships and deploys on its
   own; nothing below depends on reviews existing first.
1. Migration + models + enums + schemas (`p9b0c1d2e3f4`), including
   `place_photos.review_id`.
2. `core/text_moderation.py` — Protocol, Cloud NL client, fake, thresholds in
   settings. No HTTP surface of its own — it's a library the review handlers
   call. Standalone and testable, so it lands before anything depends on it.
3. `reviews/repo.py` + consumer/owner routers, moderation calls on every text
   field, aggregate recompute, rate limits.
4. Review photo attach endpoint + per-review cap + the
   `MAX_PHOTOS_PER_PLACE` decision.
5. Admin module + reports queue endpoints.
6. Notification categories, four `notify_*` functions, eight template files.
7. Consumer place-detail section + write dialog (pending state on submit,
   local draft preservation, inline rejection reason) + Google-rating relabel
   everywhere a bare star renders.
8. Owner `/my-reviews` inbox + per-place tab + nav (the five-tab moment).
9. Admin queue UI, transposed from verification-visits.
10. Mobile: types, hooks, place-detail section, write screen, photo picker.
11. Sort semantics: split "Highest rated", add the review-count floor.
12. Verify — `py_compile` + `tsc --noEmit` across all four apps, then an
    end-to-end pass: post → owner notified → reply → author notified → report
    → admin removes → author notified → aggregates correct. Plus a moderation
    pass: profanity blocked server-side **via direct API call, not just
    through the UI**; a heated-but-legitimate halal complaint gets through;
    a simulated Cloud NL outage returns 503 after retrying, preserves the
    draft on both web and mobile, and shows the it's-us-not-you copy.
