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


class HalalClaimEventType(StrEnum):
    """What kind of transition this audit-event row represents.

    Lock-step with the CHECK constraint in the
    ``h2b3c4d5e6f7_halal_claim_events`` migration. Add a value here
    AND in the migration's ``HALAL_CLAIM_EVENT_TYPE`` tuple — adding
    only one side trips the CHECK at insert time.

    The set is intentionally narrow:

    * ``DRAFT_CREATED`` — owner started a new claim. Logged once
      per claim at creation (single + batch paths).
    * ``SUBMITTED`` — owner submitted DRAFT → PENDING_REVIEW. Also
      fires on NEEDS_MORE_INFO → PENDING_REVIEW re-submits, since
      that's another "owner is asking for review."
    * ``ATTACHMENT_ADDED`` — owner uploaded an evidence file.
    * ``APPROVED`` / ``REJECTED`` / ``INFO_REQUESTED`` / ``REVOKED``
      — the four admin decision transitions. ``description`` carries
      the owner-visible decision_note verbatim so a later overwrite
      doesn't lose the history.
    * ``SUPERSEDED`` — system-driven; logged when a fresher approval
      bumps a prior approved claim out of "current" status.
    * ``EXPIRED`` — system-driven; reserved for the renewal cron
      that lands in a later phase.

    Patches to the questionnaire while in DRAFT are NOT logged —
    iterating on the form is a high-frequency activity and writing
    an event per keystroke (or even per save) would drown the
    timeline. The submit event captures the meaningful "owner has
    decided this draft is ready" signal.
    """

    DRAFT_CREATED = "DRAFT_CREATED"
    SUBMITTED = "SUBMITTED"
    ATTACHMENT_ADDED = "ATTACHMENT_ADDED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    INFO_REQUESTED = "INFO_REQUESTED"
    REVOKED = "REVOKED"
    SUPERSEDED = "SUPERSEDED"
    EXPIRED = "EXPIRED"
