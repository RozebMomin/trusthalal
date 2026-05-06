"""Admin endpoints for consumer-dispute review.

Phase 7 of the halal-trust v2 rebuild. Admin actions:

  * GET /admin/disputes — queue list (default filter: OPEN)
  * GET /admin/disputes/{id} — full detail (admin shape with
    reporter identity)
  * POST /admin/disputes/{id}/resolve — uphold or dismiss
  * POST /admin/disputes/{id}/request-owner-reconciliation —
    park the dispute on the owner side and wait for them to file
    a RECONCILIATION halal_claim
  * GET /admin/disputes/{id}/attachments — list metadata
  * GET /admin/disputes/{id}/attachments/{aid}/url — short-lived
    signed URL for downloading evidence files
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.admin.disputes.schemas import (
    AdminDisputeAttachmentSignedUrl,
    DisputeRequestReconciliation,
    DisputeResolve,
)
from app.modules.disputes.models import ConsumerDisputeAttachment
from app.modules.disputes.repo import (
    admin_get_dispute,
    admin_list_disputes,
    admin_request_owner_reconciliation,
    admin_resolve_dispute,
)
from app.modules.disputes.schemas import (
    ConsumerDisputeAdminRead,
    ConsumerDisputeAttachmentRead,
)
from app.modules.users.enums import UserRole


router = APIRouter(prefix="/admin/disputes", tags=["admin: disputes"])

# Match the shared admin-attachment signed-URL TTL (org,
# ownership-request, halal-claim). Tight enough that a leaked URL
# is moot within a minute, long enough for a click-then-redirect.
_SIGNED_URL_TTL_SECONDS = 60


@router.get(
    "",
    response_model=list[ConsumerDisputeAdminRead],
    summary="Consumer-dispute review queue",
    description=(
        "Newest-first list of disputes with optional `status`, "
        "`place_id`, and `reporter_user_id` filters. The admin "
        "queue page lands here with `status=OPEN`; the "
        "place detail surface filters by `place_id`."
    ),
)
def list_disputes_admin(
    status_filter: str | None = Query(default=None, alias="status"),
    place_id: UUID | None = Query(default=None),
    reporter_user_id: UUID | None = Query(default=None),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[ConsumerDisputeAdminRead]:
    rows = admin_list_disputes(
        db,
        status=status_filter,
        place_id=place_id,
        reporter_user_id=reporter_user_id,
        limit=limit,
        offset=offset,
    )
    return [ConsumerDisputeAdminRead.model_validate(r) for r in rows]


@router.get(
    "/{dispute_id}",
    response_model=ConsumerDisputeAdminRead,
    summary="Single dispute detail (admin view)",
    description=(
        "Full admin shape — includes `reporter_user_id` and the "
        "`contested_profile_id` snapshot so admin can pattern-match "
        "repeat reporters or repeat targets."
    ),
)
def get_dispute_admin(
    dispute_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> ConsumerDisputeAdminRead:
    dispute = admin_get_dispute(db, dispute_id)
    return ConsumerDisputeAdminRead.model_validate(dispute)


@router.post(
    "/{dispute_id}/resolve",
    response_model=ConsumerDisputeAdminRead,
    summary="Resolve a dispute as upheld or dismissed",
    description=(
        "Closes the dispute. UPHELD = consumer was right (data "
        "correction happens via a separate owner-driven "
        "RECONCILIATION halal_claim); DISMISSED = profile stays as-"
        "is. Either way the place's DISPUTED badge clears once no "
        "other active disputes remain."
    ),
)
def resolve_dispute_admin(
    dispute_id: UUID,
    payload: DisputeResolve,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> ConsumerDisputeAdminRead:
    dispute = admin_resolve_dispute(
        db,
        dispute_id=dispute_id,
        actor_user_id=user.id,
        decision=payload.decision,
        admin_decision_note=payload.admin_decision_note,
    )
    return ConsumerDisputeAdminRead.model_validate(dispute)


@router.post(
    "/{dispute_id}/request-owner-reconciliation",
    response_model=ConsumerDisputeAdminRead,
    summary="Move a dispute to OWNER_RECONCILING",
    description=(
        "Parks the dispute on the owner side, signaling they should "
        "file a RECONCILIATION halal_claim. Idempotent on a dispute "
        "already in OWNER_RECONCILING. Notification of the owner "
        "is a TODO — for now this just changes status; the admin "
        "can follow up via existing channels."
    ),
)
def request_owner_reconciliation_admin(
    dispute_id: UUID,
    payload: DisputeRequestReconciliation,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> ConsumerDisputeAdminRead:
    dispute = admin_request_owner_reconciliation(
        db,
        dispute_id=dispute_id,
        actor_user_id=user.id,
        admin_decision_note=payload.admin_decision_note,
    )
    return ConsumerDisputeAdminRead.model_validate(dispute)


# ---------------------------------------------------------------------------
# Attachments — review surface
# ---------------------------------------------------------------------------


@router.get(
    "/{dispute_id}/attachments",
    response_model=list[ConsumerDisputeAttachmentRead],
    summary="List evidence-file metadata on a dispute",
)
def list_dispute_attachments_admin(
    dispute_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[ConsumerDisputeAttachmentRead]:
    dispute = admin_get_dispute(db, dispute_id)
    return [
        ConsumerDisputeAttachmentRead.model_validate(a)
        for a in dispute.attachments
    ]


@router.get(
    "/{dispute_id}/attachments/{attachment_id}/url",
    response_model=AdminDisputeAttachmentSignedUrl,
    summary="Mint a short-lived signed URL for one attachment",
    description=(
        "Asserts the attachment belongs to the dispute before "
        "signing. TTL is 60 seconds, matching the other admin "
        "signed-URL endpoints."
    ),
)
def signed_url_for_dispute_attachment_admin(
    dispute_id: UUID,
    attachment_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    storage: StorageClient = Depends(get_storage_client),
) -> AdminDisputeAttachmentSignedUrl:
    attachment = db.execute(
        select(ConsumerDisputeAttachment).where(
            ConsumerDisputeAttachment.id == attachment_id,
            ConsumerDisputeAttachment.dispute_id == dispute_id,
        )
    ).scalar_one_or_none()
    if attachment is None:
        raise NotFoundError(
            "CONSUMER_DISPUTE_ATTACHMENT_NOT_FOUND",
            "No attachment with that id on this dispute.",
        )

    try:
        url = storage.signed_url(
            attachment.storage_path,
            expires_in_seconds=_SIGNED_URL_TTL_SECONDS,
        )
    except StorageError as exc:
        raise BadRequestError(
            "CONSUMER_DISPUTE_ATTACHMENT_SIGNED_URL_FAILED",
            f"Couldn't generate a download link for this attachment: {exc}",
        )

    return AdminDisputeAttachmentSignedUrl(
        url=url,
        expires_in_seconds=_SIGNED_URL_TTL_SECONDS,
        original_filename=attachment.original_filename,
        content_type=attachment.content_type,
    )
