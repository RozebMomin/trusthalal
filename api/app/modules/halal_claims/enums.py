"""Status enums for the halal-claim workflow.

A halal claim is the WORKFLOW that an owner submits to declare their
restaurant's halal posture. Approved claims feed the place's
``halal_profile`` (see app.modules.halal_profiles) — the profile is
the consumer-facing truth; the claim is the audit trail behind it.

Three claim types capture how a claim came into being:

* ``INITIAL``         — owner's first time submitting halal info for
                        a place, or a fresh start after a previous
                        claim was rejected/revoked.
* ``RENEWAL``         — submitted before/at expiry to keep the place's
                        profile current. Same questionnaire shape.
* ``RECONCILIATION``  — submitted in response to a confirmed consumer
                        dispute. Owner either confirms-and-corrects or
                        contests-and-explains.

The status machine is linear-ish:

    DRAFT ──submit──> PENDING_REVIEW ──> APPROVED ──> SUPERSEDED (when
                            │                          a newer claim
                            ├──> NEEDS_MORE_INFO       takes over)
                            │       └─re-submit──> PENDING_REVIEW
                            ├──> REJECTED  (terminal)
                            └──> REVOKED   (admin-initiated takedown)

EXPIRED is set by a job (or lazily on read) once the claim's
``expires_at`` passes without a renewal landing on top.
"""
from enum import StrEnum


class HalalClaimType(StrEnum):
    INITIAL = "INITIAL"
    RENEWAL = "RENEWAL"
    RECONCILIATION = "RECONCILIATION"


class HalalClaimStatus(StrEnum):
    DRAFT = "DRAFT"
    PENDING_REVIEW = "PENDING_REVIEW"
    NEEDS_MORE_INFO = "NEEDS_MORE_INFO"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"
    SUPERSEDED = "SUPERSEDED"


class HalalClaimAttachmentType(StrEnum):
    """What the uploaded document is supposed to prove.

    Free-form text could work, but a small enum makes admin review
    consistent and lets the UI render appropriate icons / sections.
    """

    HALAL_CERTIFICATE = "HALAL_CERTIFICATE"
    SUPPLIER_LETTER = "SUPPLIER_LETTER"
    INVOICE = "INVOICE"
    PHOTO = "PHOTO"
    OTHER = "OTHER"
