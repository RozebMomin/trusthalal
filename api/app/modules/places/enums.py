from enum import StrEnum

class ExternalIdProvider(StrEnum):
    GOOGLE = "GOOGLE"
    YELP = "YELP"
    APPLE = "APPLE"


class Cuisine(StrEnum):
    """Curated cuisine taxonomy for the consumer search surface.

    Tagged on a Place via ``Place.cuisine_types`` (multi-valued).
    Owners pick from this list when they edit their place; the
    consumer side filters on the same enum so labels stay consistent
    across both surfaces.

    Assignment posture (in order of precedence):
      1. Owner-driven — the owner picks from this list on the
         halal-claim editor surface. Owner choices win.
      2. Auto-detected on ingest — the Google Places (New) integration
         maps Google's ``primaryType`` (e.g. ``pakistani_restaurant``)
         to one of these values. Only fires when the place doesn't
         already have an owner-set list.

    Values are upper-snake-case strings so they round-trip on the
    wire without escaping. Display labels live in the UI layer (each
    app builds its own short label / description map next to its
    cuisine picker) — keeping labels out of the API means the
    consumer can rephrase ("Persian" → "Persian / Iranian") without
    a backend change.

    Stored in Postgres as ``TEXT[]`` (not a Postgres ENUM type) so
    appending a new value here is a code-only change. Tagged places
    aren't affected; the new value is just available going forward.
    Removing or renaming a value IS a breaking change — places already
    tagged with the old value would fail Pydantic validation on the
    way out. Don't reorder either: equality on the wire doesn't care
    but downstream sort or display logic might.
    """

    # South Asian
    PAKISTANI = "PAKISTANI"
    INDIAN = "INDIAN"
    BANGLADESHI = "BANGLADESHI"
    SRI_LANKAN = "SRI_LANKAN"
    NEPALI = "NEPALI"

    # Middle Eastern
    LEBANESE = "LEBANESE"
    TURKISH = "TURKISH"
    YEMENI = "YEMENI"
    SYRIAN = "SYRIAN"
    PALESTINIAN = "PALESTINIAN"
    IRAQI = "IRAQI"
    PERSIAN = "PERSIAN"
    EGYPTIAN = "EGYPTIAN"

    # North African
    MOROCCAN = "MOROCCAN"
    TUNISIAN = "TUNISIAN"
    ALGERIAN = "ALGERIAN"

    # East African
    SOMALI = "SOMALI"
    ETHIOPIAN = "ETHIOPIAN"
    ERITREAN = "ERITREAN"

    # Central Asian
    AFGHAN = "AFGHAN"
    UZBEK = "UZBEK"

    # Southeast Asian
    INDONESIAN = "INDONESIAN"
    MALAYSIAN = "MALAYSIAN"
    FILIPINO = "FILIPINO"
    THAI = "THAI"

    # East Asian
    CHINESE = "CHINESE"
    KOREAN = "KOREAN"
    JAPANESE = "JAPANESE"

    # European
    MEDITERRANEAN = "MEDITERRANEAN"
    GREEK = "GREEK"
    ITALIAN = "ITALIAN"
    SPANISH = "SPANISH"

    # Americas
    AMERICAN = "AMERICAN"
    MEXICAN = "MEXICAN"
    CARIBBEAN = "CARIBBEAN"
    SOUL_FOOD = "SOUL_FOOD"

    # Format / generic — food-format buckets (vs. country-of-origin
    # buckets above). DELI / SANDWICHES / WINGS / HOT_DOGS land here
    # because Google's vocabulary distinguishes them as primary types
    # (deli, sandwich_shop, chicken_wings_restaurant, hot_dog_restaurant)
    # and the consumer surface plans curated lists ("best wings near
    # me") that need finer cuts than AMERICAN provides.
    BURGERS = "BURGERS"
    PIZZA = "PIZZA"
    BBQ = "BBQ"
    STEAKHOUSE = "STEAKHOUSE"
    SEAFOOD = "SEAFOOD"
    SANDWICHES = "SANDWICHES"
    DELI = "DELI"
    WINGS = "WINGS"
    HOT_DOGS = "HOT_DOGS"
    BREAKFAST = "BREAKFAST"
    BAKERY = "BAKERY"
    DESSERTS = "DESSERTS"
    CAFE = "CAFE"


class PlacePhotoSource(StrEnum):
    """Who uploaded a place photo.

    Drives authority (see ``HERO_ELIGIBLE_SOURCES``). For anything
    *display*-related use ``PhotoAttribution`` instead — it folds in
    whether the photo is attached to a review, which ``source`` can't
    express, and it exists precisely so four clients stop each
    re-deriving the same rule differently.

    Stored as a plain TEXT column on ``place_photos.source`` so adding a
    variant later is a code-only change.
    """

    OWNER = "OWNER"
    CONSUMER = "CONSUMER"
    # Imported server-side from the Google Places Photo API (e.g. the
    # internal data-ops hero-image backfill). Eligible to be hero — it's
    # a stand-in cover image until an owner uploads their own. The
    # required Google author attribution is stored on the photo's
    # ``caption``. Not user-uploadable: the upload route only ever sets
    # OWNER or CONSUMER, so this value originates solely from the
    # backfill tool.
    GOOGLE = "GOOGLE"


#: Sources that may serve as a place's cover image.
#:
#: OWNER because it's the restaurant's own shopfront. GOOGLE because those
#: are the listing's photos and they're the only cover an unclaimed place
#: has. CONSUMER never — a diner's plate photo attached to a two-star review
#: must not be able to become the image every search result shows, and the
#: owner shouldn't be able to promote one either (the pre-existing manual
#: PATCH path allowed exactly that).
HERO_ELIGIBLE_SOURCES: tuple[str, ...] = (
    PlacePhotoSource.OWNER,
    PlacePhotoSource.GOOGLE,
)


class PhotoAttribution(StrEnum):
    """Display-level provenance of a photo — the thing clients render.

    Derived server-side from ``source`` + ``review_id`` rather than left to
    each client to infer. That's not gold-plating: today the consumer web
    and mobile each keep their own SOURCE_LABEL map, mobile's includes a
    ``VERIFIER`` key that has never been a real value, and neither handles
    ``GOOGLE`` — so backfilled Google photos already render a blank chip in
    production. One derivation, one place, four consistent clients.
    """

    #: Uploaded by the restaurant.
    OWNER = "OWNER"
    #: Uploaded by a diner, not attached to a review.
    DINER = "DINER"
    #: Attached to a diner's review. Carries the review's rating so the
    #: gallery can say "from a 2-star review" and link back to it — a photo
    #: of an undercooked plate means something different once you can read
    #: what the person said about it.
    REVIEW = "REVIEW"
    #: Imported from the Google Places Photo API by the data-ops backfill.
    GOOGLE = "GOOGLE"


def attribution_for(*, source: str, review_id) -> PhotoAttribution:
    """The single derivation. Order matters: review beats source, because a
    review photo is uploaded by a CONSUMER and the review context is the
    more specific and more useful fact."""
    if review_id is not None:
        return PhotoAttribution.REVIEW
    if source == PlacePhotoSource.GOOGLE:
        return PhotoAttribution.GOOGLE
    if source == PlacePhotoSource.OWNER:
        return PhotoAttribution.OWNER
    return PhotoAttribution.DINER


class PhotoAttributionFilter(StrEnum):
    """Query-param filter on the public photo list.

    Coarser than ``PhotoAttribution`` on purpose: the gallery's tabs are
    "the restaurant" vs "diners", and folding GOOGLE in with OWNER and
    REVIEW in with DINER is what a reader actually wants. Four tabs where
    two will do is furniture.
    """

    ALL = "all"
    OWNER = "owner"
    DINER = "diner"


class PlaceEventType(StrEnum):
    CREATED = "CREATED"
    EDITED = "EDITED"
    DELETED = "DELETED"
    RESTORED = "RESTORED"
    OWNERSHIP_GRANTED = "OWNERSHIP_GRANTED"
    # Initial claim submission — fired the moment a new ownership
    # request row is inserted (owner portal, public anonymous form,
    # or admin-create-on-behalf intake all hit the same code path).
    # Without this the place timeline jumped straight from CREATED
    # to NEEDS_EVIDENCE / REJECTED with no record of when the claim
    # actually showed up.
    OWNERSHIP_REQUEST_SUBMITTED = "OWNERSHIP_REQUEST_SUBMITTED"
    OWNERSHIP_REQUEST_REJECTED = "OWNERSHIP_REQUEST_REJECTED"
    OWNERSHIP_REQUEST_NEEDS_EVIDENCE = "OWNERSHIP_REQUEST_NEEDS_EVIDENCE"
    # Owner re-submitting after a NEEDS_EVIDENCE request — claim
    # flips back to UNDER_REVIEW with fresh attachments. Same audit
    # surface so place detail's timeline reads as a single story.
    OWNERSHIP_REQUEST_RESUBMITTED = "OWNERSHIP_REQUEST_RESUBMITTED"

    # Halal-claim cross-writes. The per-claim audit trail
    # (halal_claim_events) is the canonical detailed log; these
    # surface the headline transitions on the place's own timeline so
    # the place detail page reads as a single chronological story
    # ("place created, ownership granted, halal claim submitted, halal
    # claim approved"). High-frequency events (DRAFT_CREATED,
    # ATTACHMENT_ADDED) intentionally don't cross over — they'd
    # overwhelm the place view without adding much; viewers who care
    # about that detail open the per-claim Activity section.
    #
    # No DB CHECK constraint exists on place_events.event_type
    # (column is plain VARCHAR(50)), so adding values here is a
    # code-only change — no migration needed.
    HALAL_CLAIM_SUBMITTED = "HALAL_CLAIM_SUBMITTED"
    HALAL_CLAIM_APPROVED = "HALAL_CLAIM_APPROVED"
    HALAL_CLAIM_REJECTED = "HALAL_CLAIM_REJECTED"
    HALAL_CLAIM_NEEDS_INFO = "HALAL_CLAIM_NEEDS_INFO"
    HALAL_CLAIM_REVOKED = "HALAL_CLAIM_REVOKED"
    HALAL_CLAIM_SUPERSEDED = "HALAL_CLAIM_SUPERSEDED"

    # Consumer-dispute cross-writes (Phase 7). Same rationale as the
    # halal-claim cross-writes: the per-dispute timeline lives on
    # consumer_disputes, but the place's audit trail wants to see
    # "consumer disputed → admin resolved" alongside everything else.
    DISPUTE_OPENED = "DISPUTE_OPENED"
    DISPUTE_RESOLVED = "DISPUTE_RESOLVED"

    # Verifier-visit cross-writes (Phase 8b). Surfaces a verifier's
    # site-visit lifecycle on the place's timeline. Submitted +
    # accepted + rejected all flow here; admin review state changes
    # (UNDER_REVIEW) intentionally don't, same as the halal-claim
    # transitions — it'd be noise without the place benefit.
    VERIFIER_VISIT_SUBMITTED = "VERIFIER_VISIT_SUBMITTED"
    VERIFIER_VISIT_ACCEPTED = "VERIFIER_VISIT_ACCEPTED"
    VERIFIER_VISIT_REJECTED = "VERIFIER_VISIT_REJECTED"

    # Reviews. Only the headline transitions cross-write to the place
    # timeline: a posted review, an owner's public reply, and a moderated
    # takedown. Edits and reports stay in the reviews module — they'd be
    # noise in a timeline that's meant to read as one story about the place.
    REVIEW_POSTED = "REVIEW_POSTED"
    REVIEW_REPLIED = "REVIEW_REPLIED"
    REVIEW_REMOVED = "REVIEW_REMOVED"