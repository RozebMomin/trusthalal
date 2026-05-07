"""Admin endpoints for halal-claim review.

Phase 3 of the halal-trust v2 rebuild. Admin actions:

  * GET /admin/halal-claims — queue list with status / place / org
    filters.
  * GET /admin/halal-claims/{id} — full detail (admin shape with
    internal_notes + decided_by_user_id).
  * POST /admin/halal-claims/{id}/approve — approve + run profile
    derivation. Admin assigns validation_tier here.
  * POST /admin/halal-claims/{id}/reject — reject with required
    decision_note.
  * POST /admin/halal-claims/{id}/request-info — pause for more
    evidence; opens up owner's attachment-upload path again.
  * POST /admin/halal-claims/{id}/revoke — pull an APPROVED claim.
    Marks the resulting HalalProfile as revoked_at.

Attachment review (the same shape used by the org and ownership-
request admin endpoints):

  * GET /admin/halal-claims/{id}/attachments — list metadata.
  * GET /admin/halal-claims/{id}/attachments/{attachment_id}/url —
    short-lived signed URL.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.admin.halal_claims.repo import (
    admin_approve_halal_claim,
    admin_get_halal_claim,
    admin_list_halal_claim_events,
    admin_list_halal_claims,
    admin_reject_halal_claim,
    admin_request_info_halal_claim,
    admin_revoke_halal_claim,
)
from app.modules.admin.halal_claims.schemas import (
    AdminAttachmentSignedUrl,
    HalalClaimApprove,
    HalalClaimReject,
    HalalClaimRequestInfo,
    HalalClaimRevoke,
)
from app.modules.halal_claims.models import HalalClaimAttachment
from app.modules.halal_claims.schemas import (
    HalalClaimAdminRead,
    HalalClaimAttachmentRead,
    HalalClaimEventRead,
)
from app.modules.users.enums import UserRole


router = APIRouter(
    prefix="/admin/halal-claims",
    tags=["admin: halal-claims"],
)


# Match the existing admin-attachment signed-URL TTL across modules
# (org, ownership-request). Tight enough that a leaked URL is moot
# within a minute, long enough for a click-then-redirect.
_SIGNED_URL_TTL_SECONDS = 60


@router.get(
    "",
    response_model=list[HalalClaimAdminRead],
    summary="Halal-claim review queue",
    description=(
        "Newest-first list of claims with optional `status` / "
        "`place_id` / `organization_id` filters. The admin queue "
        "page lands here with `status=PENDING_REVIEW`; the place "
        "detail page hits it with `place_id={id}` to render the "
        "per-place claims summary."
    ),
)
def list_claims_admin(
    status_filter: str | None = Query(default=None, alias="status"),
    place_id: UUID | None = Query(default=None),
    organization_id: UUID | None = Query(default=None),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[HalalClaimAdminRead]:
    """Halal-claim review queue.

    The default admin view passes ``?status=PENDING_REVIEW`` for the
    work queue. Status omitted returns every claim (useful for
    auditing rejected/expired/superseded history). place_id and
    organization_id let admin scope the queue when investigating a
    specific surface.
    """
    rows = admin_list_halal_claims(
        db,
        status=status_filter,
        place_id=place_id,
        organization_id=organization_id,
        limit=limit,
        offset=offset,
    )
    return [HalalClaimAdminRead.model_validate(r) for r in rows]


@router.get(
    "/{claim_id}",
    response_model=HalalClaimAdminRead,
    summary="Single halal-claim detail (admin view)",
    description=(
        "Admin shape — includes `submitted_by_user_id`, "
        "`decided_by_user_id`, `internal_notes`, and "
        "`triggered_by_dispute_id` on top of the owner-side fields."
    ),
)
def get_claim_admin(
    claim_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> HalalClaimAdminRead:
    """Single-claim detail. 404 on unknown id."""
    claim = admin_get_halal_claim(db, claim_id)
    return HalalClaimAdminRead.model_validate(claim)


@router.post(
    "/{claim_id}/approve",
    response_model=HalalClaimAdminRead,
    summary="Approve a halal claim",
    description=(
        "Approves a PENDING_REVIEW or NEEDS_MORE_INFO claim. Runs "
        "the profile-derivation service in the same transaction: "
        "creates or updates the place's `HalalProfile`, marks any "
        "prior source claim as SUPERSEDED, and writes "
        "`HalalClaimEvent` (APPROVED) + `HalalProfileEvent` "
        "(CREATED or UPDATED) audit rows. Admin assigns the "
        "`validation_tier` (SELF_ATTESTED / CERTIFICATE_ON_FILE / "
        "TRUST_HALAL_VERIFIED). Optional `expires_at_override` "
        "shortens the default 90-day TTL (overrides past 90 days "
        "are clamped server-side — company policy)."
    ),
)
def approve_claim_admin(
    claim_id: UUID,
    payload: HalalClaimApprove,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> HalalClaimAdminRead:
    """Approve a PENDING_REVIEW or NEEDS_MORE_INFO claim.

    Triggers the profile-derivation service: creates or updates the
    place's HalalProfile, marks any prior source_claim as
    SUPERSEDED, writes a CREATED or UPDATED HalalProfileEvent. The
    transaction is atomic — all of it lands or none of it.

    Admin assigns ``validation_tier`` here (SELF_ATTESTED /
    CERTIFICATE_ON_FILE / TRUST_HALAL_VERIFIED). Optional
    ``expires_at_override`` shortens the default 90-day TTL (the
    derivation service clamps any override past 90 days back to
    the cap — company policy).
    """
    claim = admin_approve_halal_claim(
        db,
        claim_id=claim_id,
        actor_user_id=user.id,
        payload=payload,
    )
    return HalalClaimAdminRead.model_validate(claim)


@router.post(
    "/{claim_id}/reject",
    response_model=HalalClaimAdminRead,
    summary="Reject a halal claim",
    description=(
        "Closes a PENDING_REVIEW or NEEDS_MORE_INFO claim with a "
        "required `decision_note` (min 3 chars) that the owner sees "
        "verbatim. Does NOT touch the place's `HalalProfile` — "
        "rejection is the absence of a new approval, not removal of "
        "an existing one. Use `revoke` to pull a live profile."
    ),
)
def reject_claim_admin(
    claim_id: UUID,
    payload: HalalClaimReject,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> HalalClaimAdminRead:
    """Reject a PENDING_REVIEW or NEEDS_MORE_INFO claim.

    decision_note is required and surfaces verbatim to the owner.
    Does NOT touch the place's HalalProfile — a rejection is the
    absence of a new profile, not a removal of an existing one.
    """
    claim = admin_reject_halal_claim(
        db,
        claim_id=claim_id,
        actor_user_id=user.id,
        payload=payload,
    )
    return HalalClaimAdminRead.model_validate(claim)


@router.post(
    "/{claim_id}/request-info",
    response_model=HalalClaimAdminRead,
    summary="Request more info from the owner",
    description=(
        "Moves the claim to NEEDS_MORE_INFO with a required "
        "`decision_note` shown verbatim to the owner — admin uses it "
        "to specify what's missing (e.g. 'please upload current "
        "IFANCA cert'). Re-opens the owner's attachment-upload + "
        "re-submit path. Re-requesting info on a claim already in "
        "NEEDS_MORE_INFO is allowed (lets admin update the message)."
    ),
)
def request_info_claim_admin(
    claim_id: UUID,
    payload: HalalClaimRequestInfo,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> HalalClaimAdminRead:
    """Move a claim to NEEDS_MORE_INFO with a message to the owner.

    decision_note is shown to the owner verbatim — admin uses it to
    specify what additional evidence is needed. Owner can then
    upload more attachments (the /me/halal-claims status guard
    permits uploads in NEEDS_MORE_INFO) and re-submit.
    """
    claim = admin_request_info_halal_claim(
        db,
        claim_id=claim_id,
        actor_user_id=user.id,
        payload=payload,
    )
    return HalalClaimAdminRead.model_validate(claim)


@router.post(
    "/{claim_id}/revoke",
    response_model=HalalClaimAdminRead,
    summary="Revoke a previously-approved halal claim",
    description=(
        "Pulls a live claim. Marks the linked `HalalProfile` "
        "`revoked_at=now` and writes a REVOKED `HalalProfileEvent`. "
        "Used for fraud discovery, restaurant closure, or "
        "recertification windows that lapsed without renewal. "
        "Idempotent on already-REVOKED claims."
    ),
)
def revoke_claim_admin(
    claim_id: UUID,
    payload: HalalClaimRevoke,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> HalalClaimAdminRead:
    """Pull a previously APPROVED claim.

    Marks the linked HalalProfile as revoked_at=now and writes a
    REVOKED HalalProfileEvent. Used for fraud discovery, restaurant
    closure, or other admin-driven takedowns. Idempotent on already-
    REVOKED claims.
    """
    claim = admin_revoke_halal_claim(
        db,
        claim_id=claim_id,
        actor_user_id=user.id,
        payload=payload,
    )
    return HalalClaimAdminRead.model_validate(claim)


# ---------------------------------------------------------------------------
# Audit timeline
# ---------------------------------------------------------------------------


@router.get(
    "/{claim_id}/events",
    response_model=list[HalalClaimEventRead],
    summary="Audit timeline for a claim (admin view)",
    description=(
        "Same shape the owner sees on their portal, with no "
        "ownership gate — admin can read any claim's events. "
        "Captures the full lifecycle: drafts, submits, attachment "
        "uploads, every prior decision, and supersession from a "
        "newer approval."
    ),
)
def list_claim_events_admin(
    claim_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[HalalClaimEventRead]:
    """Per-claim audit timeline (admin view).

    Same shape the owner sees on their portal, with no ownership
    gate — admin can read any claim's events. Powers the 'Activity'
    section on the admin claim detail page so reviewers can see the
    full lifecycle (when the owner drafted, when they submitted,
    every prior decision, supersession from a newer approval, etc.).
    """
    rows = admin_list_halal_claim_events(db, claim_id=claim_id)
    return [HalalClaimEventRead.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# Attachments — review surface for evidence files
# ---------------------------------------------------------------------------


@router.get(
    "/{claim_id}/attachments",
    response_model=list[HalalClaimAttachmentRead],
    summary="List evidence-file metadata on a claim",
    description=(
        "Bytes are not returned here — frontends call the "
        "signed-URL endpoint per attachment when admin clicks View."
    ),
)
def list_claim_attachments_admin(
    claim_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[HalalClaimAttachmentRead]:
    """List metadata for the claim's evidence files."""
    claim = admin_get_halal_claim(db, claim_id)
    return [
        HalalClaimAttachmentRead.model_validate(a) for a in claim.attachments
    ]


@router.get(
    "/{claim_id}/attachments/{attachment_id}/url",
    response_model=AdminAttachmentSignedUrl,
    summary="Mint a short-lived signed URL for one attachment",
    description=(
        "Asserts the attachment belongs to the claim before signing "
        "— guards against guessed UUIDs leaking unrelated files. "
        "TTL is 60 seconds, matching the org and "
        "ownership-request signed-URL endpoints."
    ),
)
def signed_url_for_attachment_admin(
    claim_id: UUID,
    attachment_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    storage: StorageClient = Depends(get_storage_client),
) -> AdminAttachmentSignedUrl:
    """Mint a short-lived signed URL for one attachment.

    Asserts the attachment belongs to the claim before signing —
    guards against guessed UUIDs surfacing files for an unrelated
    claim. TTL is 60 seconds, same as the org / ownership-request
    signed-URL endpoints.
    """
    attachment = db.execute(
        select(HalalClaimAttachment).where(
            HalalClaimAttachment.id == attachment_id,
            HalalClaimAttachment.claim_id == claim_id,
        )
    ).scalar_one_or_none()
    if attachment is None:
        raise NotFoundError(
            "HALAL_CLAIM_ATTACHMENT_NOT_FOUND",
            "No attachment with that id on this halal claim.",
        )

    try:
        url = storage.signed_url(
            attachment.storage_path,
            expires_in_seconds=_SIGNED_URL_TTL_SECONDS,
        )
    except StorageError as exc:
        raise BadRequestError(
            "HALAL_CLAIM_ATTACHMENT_SIGNED_URL_FAILED",
            f"Couldn't generate a download link for this attachment: {exc}",
        )

    return AdminAttachmentSignedUrl(
        url=url,
        expires_in_seconds=_SIGNED_URL_TTL_SECONDS,
        original_filename=attachment.original_filename,
        content_type=attachment.content_type,
    )
