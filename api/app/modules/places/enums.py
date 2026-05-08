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

    Drives both authority (only OWNER photos can be hero) and
    consumer-visible badging on the place detail page. Stored as a
    plain TEXT column on ``place_photos.source`` so adding a
    VERIFIER variant later is a code-only change.
    """

    OWNER = "OWNER"
    CONSUMER = "CONSUMER"


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