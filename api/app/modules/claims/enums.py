from enum import StrEnum

class ClaimType(StrEnum):
    ZABIHA = "ZABIHA"
    HALAL_CHICKEN_ONLY = "HALAL_CHICKEN_ONLY"
    PORK_FREE = "PORK_FREE"
    NO_ALCOHOL = "NO_ALCOHOL"
    HALAL_MEAT_AVAILABLE = "HALAL_MEAT_AVAILABLE"

class ClaimScope(StrEnum):
    ALL_MENU = "ALL_MENU"
    SPECIFIC_ITEMS = "SPECIFIC_ITEMS"

class ClaimStatus(StrEnum):
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    DISPUTED = "DISPUTED"


class ClaimEventType(StrEnum):
    """Audit event types logged on claim_events.

    Stored as VARCHAR + CHECK (see models.ClaimEvent.event_type). Adding
    a new value requires extending the CHECK constraint in a migration
    before the app writes it.
    """

    # User / system events
    SUBMITTED = "SUBMITTED"                  # claim row created
    EVIDENCE_ADDED = "EVIDENCE_ADDED"        # owner attached supporting evidence
    VERIFIED = "VERIFIED"                    # non-admin verify path (legacy/service)
    REFRESH_REQUESTED = "REFRESH_REQUESTED"  # ttl bump requested by owner
    DISPUTED = "DISPUTED"                    # verified claim was challenged

    # Terminal admin moderation actions
    ADMIN_VERIFIED = "ADMIN_VERIFIED"
    ADMIN_REJECTED = "ADMIN_REJECTED"
    ADMIN_EXPIRED = "ADMIN_EXPIRED"

    # Batch job termination (scripts/expire_claims.py)
    EXPIRED = "EXPIRED"