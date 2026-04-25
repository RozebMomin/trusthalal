from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.claims.enums import ClaimScope, ClaimStatus, ClaimType


class ClaimEventRead(BaseModel):
    """Admin-only event row with the actor joined in.

    We surface ``actor_email`` / ``actor_display_name`` so the admin panel
    can answer "who did this?" without a second round-trip. These
    fields are intentionally nullable:

      * Batch-job events (``EXPIRED``) and historical rows with a
        SET-NULL'd FK have no actor.
      * The user may have been deleted since; the FK is ON DELETE SET
        NULL so ``actor_user_id`` itself can be null even when a join
        is attempted.

    This shape is admin-only on purpose. The public ``/claims/{id}``
    endpoint returns the plain ``ClaimEventRead`` from
    ``modules/claims/schemas.py`` which carries only the UUID — we
    don't want to leak admin emails to anonymous callers triaging
    their own claims.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    claim_id: UUID
    event_type: str
    message: str | None
    actor_user_id: UUID | None
    actor_email: str | None
    actor_display_name: str | None
    created_at: datetime


class AdminClaimAction(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class ClaimAdminRead(BaseModel):
    """Row shape for the /admin/claims queue.

    Mirrors ClaimDetailRead minus the nested evidence/events lists.
    evidence_count is a denormalized counter so the queue table can
    surface "already has proof attached" without N+1-ing /claims/{id}.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    claim_type: ClaimType
    scope: ClaimScope
    status: ClaimStatus
    expires_at: datetime
    created_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime

    evidence_count: int