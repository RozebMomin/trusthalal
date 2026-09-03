"""Admin-side payloads for the consumer-dispute review surface.

The read shape (``ConsumerDisputeAdminRead``) lives in the
consumer-side Pydantic module so admin and consumer stay in
lock-step. These payloads are admin-only WRITE shapes for the
decision endpoints (resolve, request-owner-reconciliation).
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.modules.disputes.enums import DisputeStatus
from app.modules.halal_profiles.enums import (
    AlcoholPolicy,
    MenuPosture,
    SlaughterMethod,
    ZabihahStatus,
)
from app.modules.places.enums import DelistReason


class ProfileCorrection(BaseModel):
    """Direct admin correction to a place's halal profile, applied when a
    dispute is upheld. Every field is optional — only the ones set are changed.
    The pathway for ownerless, verifier-established profiles where the data is
    wrong and there's no owner to file a reconciliation claim.
    """

    model_config = ConfigDict(extra="forbid")

    alcohol_policy: Optional[AlcoholPolicy] = None
    alcohol_in_cooking: Optional[bool] = None
    menu_posture: Optional[MenuPosture] = None
    chicken_slaughter: Optional[SlaughterMethod] = None
    beef_zabihah: Optional[ZabihahStatus] = None
    lamb_zabihah: Optional[ZabihahStatus] = None
    goat_zabihah: Optional[ZabihahStatus] = None
    has_certification: Optional[bool] = None
    certifying_body_name: Optional[str] = Field(default=None, max_length=255)

    def changes(self) -> dict:
        """Only the explicitly-set fields, as column-writable values."""
        return self.model_dump(exclude_none=True)


class DisputeResolveDelist(BaseModel):
    """Optional de-list escalation bundled into a dispute resolution.

    When present on an UPHELD resolution, the place is de-listed (public
    tombstone) in the same action — the 'we verified it's not halal, take
    it down' path. Only valid alongside ``RESOLVED_UPHELD``.
    """

    model_config = ConfigDict(extra="forbid")

    reason: DelistReason = Field(
        default=DelistReason.NOT_HALAL,
        description="De-list reason; defaults to NOT_HALAL for this flow.",
    )
    note: Optional[str] = Field(default=None, max_length=1000)


class DisputeResolve(BaseModel):
    """Payload for ``POST /admin/disputes/{id}/resolve``.

    Decision must be one of the two terminal states. The
    ``admin_decision_note`` is required on DISMISSED so the
    consumer understands the outcome; UPHELD makes it optional
    because "we agreed, the place needs a reconciliation claim"
    speaks for itself.
    """

    model_config = ConfigDict(extra="forbid")

    decision: DisputeStatus = Field(
        ...,
        description=(
            "Must be `RESOLVED_UPHELD` or `RESOLVED_DISMISSED`. The "
            "repo layer also rejects other values defensively."
        ),
    )
    admin_decision_note: Optional[str] = Field(
        default=None,
        max_length=2000,
        description=(
            "Required when DISMISSED so the consumer understands the "
            "outcome; optional when UPHELD."
        ),
    )
    delist: Optional[DisputeResolveDelist] = Field(
        default=None,
        description=(
            "Optional. When set on an UPHELD resolution, also de-lists the "
            "place (public tombstone) in the same action. Ignored/invalid on "
            "a DISMISSED resolution."
        ),
    )
    correction: Optional[ProfileCorrection] = Field(
        default=None,
        description=(
            "Optional. When set on an UPHELD resolution, apply these profile "
            "field changes directly (the 'uphold & correct' path for ownerless "
            "places). Only valid alongside RESOLVED_UPHELD."
        ),
    )


class DisputeRequestReconciliation(BaseModel):
    """Payload for ``POST /admin/disputes/{id}/request-owner-reconciliation``.

    Used when a dispute is plausible enough to ask the owner to
    file a RECONCILIATION halal_claim instead of admin resolving
    directly. ``admin_decision_note`` is staff-only context.
    """

    model_config = ConfigDict(extra="forbid")

    admin_decision_note: Optional[str] = Field(
        default=None, max_length=2000
    )


class AdminDisputeAttachmentSignedUrl(BaseModel):
    """Signed-URL response. Same TTL as the org / ownership-request
    / halal-claim signed URLs (60 seconds)."""

    model_config = ConfigDict(extra="forbid")

    url: str
    expires_in_seconds: int
    original_filename: str
    content_type: str
