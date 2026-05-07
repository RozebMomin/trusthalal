"""Admin-side payloads for halal-claim review decisions.

The read shape is shared with the owner-side (``HalalClaimAdminRead``
in app.modules.halal_claims.schemas) — admin sees everything the
owner sees plus internal_notes + decided_by_user_id.

These payloads are admin-only WRITE shapes for the four decision
endpoints (approve / reject / request-info / revoke).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.modules.halal_profiles.enums import ValidationTier


class HalalClaimApprove(BaseModel):
    """Payload for ``POST /admin/halal-claims/{id}/approve``.

    ``validation_tier`` is the admin's confidence-level call —
    SELF_ATTESTED (no evidence verified beyond on-file docs),
    CERTIFICATE_ON_FILE (cert verified), or TRUST_HALAL_VERIFIED
    (Trust Halal staff or community verifier site visit confirms).

    ``expires_at_override`` lets admin pick a SHORTER-than-default
    expiry. Defaults to 90 days from approve (company policy: every
    approved claim has a 90-day lifetime so the catalog stays
    self-correcting). Overrides past 90 days are clamped server-
    side; useful when a cert expires sooner than 90 days and the
    admin wants the profile to time-out with the cert.

    ``certificate_expires_at`` mirrors the cert's own expiry date.
    Optional and metadata-only — drives the consumer-facing
    "Certificate expires Mar 2027" line.
    """

    model_config = ConfigDict(extra="forbid")

    validation_tier: ValidationTier
    decision_note: Optional[str] = Field(default=None, max_length=2000)
    internal_notes: Optional[str] = Field(default=None, max_length=4000)
    expires_at_override: Optional[datetime] = None
    certificate_expires_at: Optional[datetime] = None
    # Acknowledgement flag for approving outside the standard
    # PENDING_REVIEW → APPROVED happy path. The server returns
    # ``HALAL_CLAIM_APPROVAL_REQUIRES_OVERRIDE`` when the claim is
    # in DRAFT / NEEDS_MORE_INFO / REJECTED / REVOKED and this is
    # False; the admin UI catches that code and shows a confirm
    # dialog that re-submits with the flag flipped + a
    # required decision_note explaining the reasoning.
    #
    # Why not auto-allow: a NEEDS_MORE_INFO → APPROVED transition
    # without the owner ever resubmitting evidence is the
    # textbook accident — admin meant to flip a different claim,
    # or forgot the owner's missing-info request was unanswered.
    # Requiring a deliberate ack + a note gives the audit trail
    # a paper trail for "admin overrode the standard flow on
    # 2026-05-06 because <reason>."
    override_acknowledged: bool = False


class HalalClaimReject(BaseModel):
    """Payload for ``POST /admin/halal-claims/{id}/reject``.

    Decision note is REQUIRED — the owner sees this on their claim
    detail to understand why their submission didn't pass. A
    rejection without a reason makes for a frustrating UX.
    """

    model_config = ConfigDict(extra="forbid")

    decision_note: str = Field(..., min_length=3, max_length=2000)
    internal_notes: Optional[str] = Field(default=None, max_length=4000)


class HalalClaimRequestInfo(BaseModel):
    """Payload for ``POST /admin/halal-claims/{id}/request-info``.

    Moves the claim to NEEDS_MORE_INFO. The decision_note is shown
    to the owner verbatim — admin uses it to specify what additional
    evidence is needed ("Please upload a current cert from IFANCA",
    etc.). Owner can then upload more attachments and re-submit.
    """

    model_config = ConfigDict(extra="forbid")

    decision_note: str = Field(..., min_length=3, max_length=2000)
    internal_notes: Optional[str] = Field(default=None, max_length=4000)


class HalalClaimRevoke(BaseModel):
    """Payload for ``POST /admin/halal-claims/{id}/revoke``.

    Used when admin pulls a previously-APPROVED claim (fraud
    discovered, restaurant closed, recertification window passed
    without renewal, etc.). The associated HalalProfile gets a
    revoked_at marker; the consumer-facing render hides the place
    or surfaces a 'no longer verified' badge depending on UX
    decisions in Phase 9.
    """

    model_config = ConfigDict(extra="forbid")

    decision_note: str = Field(..., min_length=3, max_length=2000)
    internal_notes: Optional[str] = Field(default=None, max_length=4000)


class AdminAttachmentSignedUrl(BaseModel):
    """Response shape for the signed-URL endpoint. Same shape as
    the org and ownership-request signed-URL endpoints — short TTL,
    URL + filename + MIME so the client can render the download
    label without a second fetch."""

    model_config = ConfigDict(extra="forbid")

    url: str
    expires_in_seconds: int
    original_filename: str
    content_type: str
