"""Enums for the consumer-dispute system.

Disputes are signed-in consumer reports that a place's halal profile
is wrong. Workflow:

    OPEN ──> OWNER_RECONCILING ──> ADMIN_REVIEWING ──> RESOLVED_*
    (consumer    (owner has         (admin reviewing      (terminal)
     filed)       submitted a        both sides)
                  reconciliation
                  claim)

Owner sees redacted dispute info; admin sees full reporter identity.
"""
from enum import StrEnum


class DisputeStatus(StrEnum):
    OPEN = "OPEN"
    """Just filed by a consumer; owner has been notified but hasn't
    responded yet."""

    OWNER_RECONCILING = "OWNER_RECONCILING"
    """Owner has submitted a RECONCILIATION halal_claim (or otherwise
    responded). Awaiting admin review."""

    ADMIN_REVIEWING = "ADMIN_REVIEWING"
    """Admin is actively reviewing the dispute + owner's response."""

    RESOLVED_UPHELD = "RESOLVED_UPHELD"
    """Admin sided with the consumer. Profile data was corrected."""

    RESOLVED_DISMISSED = "RESOLVED_DISMISSED"
    """Admin sided with the owner. Profile unchanged. Consumer notified."""

    WITHDRAWN = "WITHDRAWN"
    """Consumer withdrew the dispute themselves before resolution."""


class DisputedAttribute(StrEnum):
    """Which aspect of the profile the consumer is disputing.

    Free text in ``description`` complements this — the enum is for
    routing and pattern detection (admins want to know "are we seeing
    a lot of ALCOHOL_PRESENT disputes lately?"), the description is
    for human context.
    """

    PORK_SERVED = "PORK_SERVED"
    """Place said no pork; consumer found pork."""

    ALCOHOL_PRESENT = "ALCOHOL_PRESENT"
    """Place said no alcohol; consumer found alcohol on the menu or
    in the kitchen."""

    MENU_POSTURE_INCORRECT = "MENU_POSTURE_INCORRECT"
    """The advertised menu posture (fully halal, halal-options, etc.)
    doesn't match reality."""

    SLAUGHTER_METHOD_INCORRECT = "SLAUGHTER_METHOD_INCORRECT"
    """Place said zabihah; consumer believes machine-slaughtered or
    not halal-certified."""

    CERTIFICATION_INVALID = "CERTIFICATION_INVALID"
    """Place's certificate doesn't match what's on file or has
    expired."""

    PLACE_CLOSED = "PLACE_CLOSED"
    """Restaurant has closed but is still listed as active."""

    OTHER = "OTHER"
    """Anything else — description carries the detail."""
