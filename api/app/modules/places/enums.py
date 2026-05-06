from enum import StrEnum

class ExternalIdProvider(StrEnum):
    GOOGLE = "GOOGLE"
    YELP = "YELP"
    APPLE = "APPLE"


class PlaceEventType(StrEnum):
    CREATED = "CREATED"
    EDITED = "EDITED"
    DELETED = "DELETED"
    RESTORED = "RESTORED"
    OWNERSHIP_GRANTED = "OWNERSHIP_GRANTED"
    OWNERSHIP_REQUEST_REJECTED = "OWNERSHIP_REQUEST_REJECTED"
    OWNERSHIP_REQUEST_NEEDS_EVIDENCE = "OWNERSHIP_REQUEST_NEEDS_EVIDENCE"

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