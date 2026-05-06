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
