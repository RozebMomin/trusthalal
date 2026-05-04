"""Pydantic schemas for consumer disputes.

Three read shapes — owner-redacted, admin-full, consumer-self —
because the same data needs different visibility per audience.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.disputes.enums import DisputeStatus, DisputedAttribute


class ConsumerDisputeAttachmentRead(BaseModel):
    """Attachment metadata. Bytes via signed URL."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    dispute_id: UUID
    original_filename: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime


class ConsumerDisputeCreate(BaseModel):
    """Payload for ``POST /places/{place_id}/disputes``.

    Reporter must be authenticated; the user_id comes from the
    session, not the body. The ``contested_profile_id`` is set
    server-side from the place's current profile at submission time.
    """

    model_config = ConfigDict(extra="forbid")

    disputed_attribute: DisputedAttribute
    description: str = Field(..., min_length=10, max_length=2000)


class ConsumerDisputeOwnerRead(BaseModel):
    """Owner-facing view — REDACTED.

    No reporter_user_id, no reporter name, no submission-time
    granularity that could identify them. Just the substance of the
    dispute the owner needs to respond to.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    place_id: UUID
    status: DisputeStatus
    disputed_attribute: DisputedAttribute
    description: str
    submitted_at: datetime
    # Owner sees the date the admin decided (if any) but no admin name.
    decided_at: Optional[datetime]


class ConsumerDisputeReporterRead(BaseModel):
    """Consumer-self view (their own disputes via /me/disputes).

    The reporter sees their own description + decision context. They
    don't see admin internal notes, only the resolution outcome.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    place_id: UUID
    status: DisputeStatus
    disputed_attribute: DisputedAttribute
    description: str
    attachments: list[ConsumerDisputeAttachmentRead] = Field(default_factory=list)
    submitted_at: datetime
    decided_at: Optional[datetime]
    admin_decision_note: Optional[str]


class ConsumerDisputeAdminRead(BaseModel):
    """Full admin view — sees everything.

    Reporter identity is here for pattern detection (repeat
    offenders / repeat targets). Admin UI surfaces it; admin staff
    is responsible for not leaking it sideways.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    place_id: UUID
    reporter_user_id: Optional[UUID]
    status: DisputeStatus
    disputed_attribute: DisputedAttribute
    description: str
    contested_profile_id: Optional[UUID]
    attachments: list[ConsumerDisputeAttachmentRead] = Field(default_factory=list)

    submitted_at: datetime
    decided_at: Optional[datetime]
    decided_by_user_id: Optional[UUID]
    admin_decision_note: Optional[str]
    updated_at: datetime


class DisputeResolutionPayload(BaseModel):
    """Payload for admin resolving a dispute (uphold or dismiss)."""

    model_config = ConfigDict(extra="forbid")

    decision: DisputeStatus = Field(
        ...,
        description=(
            "Must be RESOLVED_UPHELD or RESOLVED_DISMISSED. Other "
            "values are rejected at the validation layer."
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
