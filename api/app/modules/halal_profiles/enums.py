"""Enums for halal profiles — the consumer-facing snapshot of a
place's halal posture.

Two axes captured here, kept separate by design:

1. **Validation tier** — how confident is Trust Halal in the claim?
   Monotonic; assigned by admin during review.
2. **Claim attributes** — what's the actual halal posture? Multiple
   independent enums (menu posture, alcohol, slaughter method per
   meat). Set by the owner via questionnaire.

Consumer search filters on both axes independently.
"""
from enum import StrEnum


class ValidationTier(StrEnum):
    """How was the claim validated?

    Ordered from least to most rigorous. The consumer-side preference
    "minimum acceptable tier" filters on this. Admin assigns during
    review, considering the evidence the owner uploaded plus any
    verifier site-visit findings.
    """

    SELF_ATTESTED = "SELF_ATTESTED"
    """Owner submitted answers; no external evidence verified by Trust
    Halal beyond the documents on file (which may exist but haven't
    been independently checked)."""

    CERTIFICATE_ON_FILE = "CERTIFICATE_ON_FILE"
    """Owner uploaded a current halal certificate from a recognized
    authority and admin staff verified the cert is real + unexpired."""

    TRUST_HALAL_VERIFIED = "TRUST_HALAL_VERIFIED"
    """A Trust Halal verifier (community moderator) physically visited
    and confirmed the claim, OR Trust Halal staff conducted a site
    visit. Highest confidence tier."""


class MenuPosture(StrEnum):
    """The shape of a restaurant's halal offering.

    Listed roughly in order of strictness for consumer filtering.
    A consumer's "minimum acceptable posture" pref includes everything
    at or above the chosen value.
    """

    FULLY_HALAL = "FULLY_HALAL"
    """Every menu item is halal. No non-halal proteins on premises."""

    MIXED_SEPARATE_KITCHENS = "MIXED_SEPARATE_KITCHENS"
    """Some non-halal exists but is prepared in physically separate
    equipment / kitchens to prevent cross-contamination."""

    HALAL_OPTIONS_ADVERTISED = "HALAL_OPTIONS_ADVERTISED"
    """Halal items are clearly marked on the menu alongside non-halal
    items. Default-non-halal kitchen but explicit halal options."""

    HALAL_UPON_REQUEST = "HALAL_UPON_REQUEST"
    """Halal items aren't advertised; the customer must explicitly
    ask for halal. Risk: if you don't ask, you get the non-halal
    version (e.g. Shane's Burger pattern)."""

    MIXED_SHARED_KITCHEN = "MIXED_SHARED_KITCHEN"
    """Halal proteins exist but cooked on shared equipment with
    non-halal. Lowest strictness tier."""


class SlaughterMethod(StrEnum):
    """Per-meat slaughter classification."""

    ZABIHAH = "ZABIHAH"
    """Hand-slaughtered with bismillah, traditional method."""

    MACHINE = "MACHINE"
    """Machine-slaughtered, halal-certified by an authority."""

    NOT_SERVED = "NOT_SERVED"
    """Restaurant doesn't serve this protein at all. Useful so the
    questionnaire doesn't force a meaningless answer."""


class MeatType(StrEnum):
    """Meat categories the questionnaire tracks per-product.

    The owner used to answer one ``MeatSourcing`` per fixed slot
    (chicken / beef / lamb / goat). Restaurants in practice sell
    multiple products per meat — beef bacon, beef hot dogs, ground
    beef, each potentially sourced differently — so the
    questionnaire now carries a list of ``MeatProductSourcing``
    keyed on this enum.

    Closed enum (not free text) because the consumer-search filters
    and ``HalalProfile`` per-meat slaughter columns rely on a known
    vocabulary. Adding a new value is a one-line change here, and
    a follow-up if the new type needs its own profile column for
    filtering. ``OTHER`` is the safety valve — line items still
    carry their detail (name, supplier, slaughter), they just
    don't roll up to a profile column.
    """

    CHICKEN = "CHICKEN"
    BEEF = "BEEF"
    LAMB = "LAMB"
    GOAT = "GOAT"
    TURKEY = "TURKEY"
    DUCK = "DUCK"
    FISH = "FISH"
    OTHER = "OTHER"


class AlcoholPolicy(StrEnum):
    """Alcohol on premises."""

    NONE = "NONE"
    """No alcohol served on premises, period."""

    BEER_AND_WINE_ONLY = "BEER_AND_WINE_ONLY"
    """Beer and/or wine served, but no full bar. Some halal-conscious
    diners are OK with this; others aren't."""

    FULL_BAR = "FULL_BAR"
    """Full bar / spirits served on premises."""


class HalalProfileDisputeState(StrEnum):
    """Whether a profile is currently under contestation.

    NONE       — no active disputes; profile is the source of truth.
    DISPUTED   — a confirmed dispute exists. Consumer-facing UI
                 surfaces a "conflicting reports" badge.
    RECONCILING — owner has submitted a RECONCILIATION claim that's
                 in admin review. Profile still serves the old data
                 but the badge shows "review in progress."
    """

    NONE = "NONE"
    DISPUTED = "DISPUTED"
    RECONCILING = "RECONCILING"


class HalalProfileEventType(StrEnum):
    """Types of audit events recorded against a profile.

    Every meaningful state change writes an event so admin staff (and
    eventually consumers) can answer "why does this place have these
    attributes?" and "when did it last change?"
    """

    CREATED = "CREATED"
    """First profile created from an APPROVED INITIAL claim."""

    UPDATED = "UPDATED"
    """Profile rewritten from a newer APPROVED claim (renewal,
    reconciliation, or any post-initial INITIAL)."""

    EXPIRED = "EXPIRED"
    """Profile passed its expires_at without a renewal landing."""

    DISPUTE_OPENED = "DISPUTE_OPENED"
    """A consumer dispute was confirmed by admin and the profile
    flipped to DISPUTED."""

    DISPUTE_RESOLVED = "DISPUTE_RESOLVED"
    """Either dismissed (back to NONE) or upheld (profile data
    rewritten and back to NONE)."""

    REVOKED = "REVOKED"
    """Admin manually pulled the profile (e.g. restaurant closed,
    fraudulent claim discovered)."""

    RESTORED = "RESTORED"
    """Admin un-revoked a profile."""

    VERIFIER_VISIT_ACCEPTED = "VERIFIER_VISIT_ACCEPTED"
    """A verifier visit was accepted by admin. Effects: validation
    tier promoted to TRUST_HALAL_VERIFIED if it wasn't already, and
    last_verified_at refreshed to the visit's visited_at. The
    related visit id is stashed in the event description (we don't
    have a dedicated FK column for verification_visit refs)."""
