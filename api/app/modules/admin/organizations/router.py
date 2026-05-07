from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import BadRequestError, NotFoundError
from app.core.storage import StorageClient, StorageError, get_storage_client
from app.db.deps import get_db
from app.modules.admin.organizations.repo import (
    admin_add_member,
    admin_create_organization,
    admin_deactivate_member,
    admin_get_organization,
    admin_list_members,
    admin_list_org_places,
    admin_list_organizations,
    admin_patch_organization,
    admin_reject_organization,
    admin_verify_organization,
)
from app.modules.admin.organizations.schemas import (
    MemberAdminCreate,
    OrganizationAdminCreate,
    OrganizationAdminPatch,
    OrganizationAdminRead,
    OrganizationDetailRead,
    OrganizationMemberAdminRead,
    OrganizationPlaceOwnerRead,
    OrganizationPlaceSummary,
    OrganizationRejectAdmin,
    OrganizationVerifyAdmin,
)
from app.modules.organizations.enums import OrganizationStatus
from app.modules.organizations.models import OrganizationAttachment
from app.modules.organizations.schemas import OrganizationAttachmentRead
from app.modules.users.enums import UserRole


# Signed URL TTL for admin attachment downloads. 60s matches the
# claim-attachment endpoint — long enough for a click, short enough
# that a stale tab can't replay later.
_ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60


class _AdminAttachmentSignedUrl(BaseModel):
    """Response shape for the org-attachment signed-URL endpoint.

    Same shape as the claim-attachment variant: URL + filename +
    MIME so the client can label the download or render an inline
    preview without a second fetch.
    """

    url: str
    expires_in_seconds: int
    original_filename: str
    content_type: str

router = APIRouter(prefix="/admin/organizations", tags=["admin: organizations"])


@router.post(
    "",
    response_model=OrganizationAdminRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create an organization (admin path)",
    description=(
        "Admin can mint an org directly without going through the "
        "owner self-service draft → submit flow. Lands in any status "
        "the admin specifies (typically VERIFIED for orgs vetted "
        "out-of-band)."
    ),
)
def create_org_admin(
    payload: OrganizationAdminCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationAdminRead:
    return admin_create_organization(db, payload)


@router.get(
    "",
    response_model=list[OrganizationAdminRead],
    summary="List organizations (filterable by status)",
    description=(
        "Pass `?status=UNDER_REVIEW` to get the verification queue; "
        "omit for the full catalog. Newest-first."
    ),
)
def list_orgs_admin(
    q: str | None = Query(default=None, max_length=200),
    status_filter: OrganizationStatus | None = Query(
        default=None, alias="status"
    ),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[OrganizationAdminRead]:
    """List orgs, optionally narrowed by status.

    Pass ``?status=UNDER_REVIEW`` to get the verification queue;
    omit the param for the full catalog. Newest-first either way.
    """
    rows = admin_list_organizations(
        db,
        q=q,
        status=status_filter.value if status_filter is not None else None,
        limit=limit,
        offset=offset,
    )
    return [OrganizationAdminRead.model_validate(o) for o in rows]


@router.get(
    "/{org_id}",
    response_model=OrganizationDetailRead,
    summary="Get an organization with members + attachments",
)
def get_org_admin(
    org_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationDetailRead:
    org = admin_get_organization(db, org_id)
    members = admin_list_members(db, org_id)
    # Build the response by validating off the ORM row (picks up
    # status + decision fields + attachments via from_attributes),
    # then layer on the members list which lives in the
    # OrganizationDetailRead extension.
    base = OrganizationAdminRead.model_validate(org)
    return OrganizationDetailRead(
        **base.model_dump(),
        members=[_member_view(m) for m in members],
    )


def _member_view(member) -> OrganizationMemberAdminRead:
    """Project an OrganizationMember row + its eager-loaded user
    onto the admin read shape with display_name + email pulled
    through.

    The User relationship has ``lazy="selectin"`` so the join is one
    extra query for the whole member set, not one per row. Falls
    back to ``None`` if the user FK got SET NULL'd somehow — the
    member row is kept for audit even if the user is gone.
    """
    user = getattr(member, "user", None)
    return OrganizationMemberAdminRead.model_validate(
        {
            "id": member.id,
            "organization_id": member.organization_id,
            "user_id": member.user_id,
            "user_email": user.email if user else None,
            "user_display_name": user.display_name if user else None,
            "role": member.role,
            "status": member.status,
            "created_at": member.created_at,
            "updated_at": member.updated_at,
        }
    )


@router.get(
    "/{org_id}/places",
    response_model=list[OrganizationPlaceOwnerRead],
    summary="List places this org owns (live + historical)",
    description=(
        "ACTIVE first, then REVOKED. Includes soft-deleted places "
        "(`place.is_deleted` lets the UI fade them). Powers the org "
        "detail page's 'Places owned' section."
    ),
)
def list_org_places_admin(
    org_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[OrganizationPlaceOwnerRead]:
    """List places this org owns (live + historical).

    Closes the user ↔ org ↔ place triangle visually: the org detail
    page can now show "which places does Acme run?" without bouncing
    through the places admin and filtering by owner.

    ACTIVE rows come first; REVOKED history rows follow so admins can
    see what the org USED to own — useful when triaging "we never
    worked with Acme, why does our catalog show them?"

    Soft-deleted places are included (the ``place.is_deleted`` flag
    lets the UI fade or badge them).
    """
    rows = admin_list_org_places(db, org_id=org_id)
    return [
        OrganizationPlaceOwnerRead(
            id=owner.id,
            role=owner.role,
            status=owner.status,
            created_at=owner.created_at,
            place=OrganizationPlaceSummary.model_validate(place),
        )
        for owner, place in rows
    ]


@router.patch(
    "/{org_id}",
    response_model=OrganizationAdminRead,
    summary="Edit an organization (admin)",
)
def patch_org_admin(
    org_id: UUID,
    payload: OrganizationAdminPatch,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationAdminRead:
    """Partial update for an organization.

    Omitted fields are left alone. Sending ``contact_email: null``
    clears the field; omitting the key leaves the existing value.
    """
    return admin_patch_organization(db, org_id=org_id, patch=payload)


@router.post(
    "/{org_id}/members",
    response_model=OrganizationMemberAdminRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a user as a member of an organization",
)
def add_member_admin(
    org_id: UUID,
    payload: MemberAdminCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationMemberAdminRead:
    member = admin_add_member(db, org_id=org_id, payload=payload)
    return _member_view(member)


@router.delete(
    "/{org_id}/members/{user_id}",
    response_model=OrganizationMemberAdminRead,
    summary="Deactivate an organization membership",
    description="Soft-removes the membership; the row stays for audit history.",
)
def deactivate_member_admin(
    org_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationMemberAdminRead:
    member = admin_deactivate_member(db, org_id=org_id, user_id=user_id)
    return _member_view(member)


# ---------------------------------------------------------------------------
# Verification workflow — admin-only verify / reject decisions
# ---------------------------------------------------------------------------
@router.post(
    "/{org_id}/verify",
    response_model=OrganizationAdminRead,
    summary="Verify an organization (UNDER_REVIEW → VERIFIED)",
    description=(
        "Records the deciding admin, timestamp, and optional note. "
        "Once VERIFIED, the org can sponsor claim approvals (slice 5d)."
    ),
)
def verify_org_admin(
    org_id: UUID,
    payload: OrganizationVerifyAdmin,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationAdminRead:
    """Move an UNDER_REVIEW org → VERIFIED.

    Records the deciding admin + timestamp + optional note inline
    on the org row. Once verified, the org is eligible to sponsor
    new claims and admin claim approvals can proceed (slice 5d
    will gate approval on this status).
    """
    org = admin_verify_organization(
        db, org_id=org_id, note=payload.note, actor_user_id=user.id
    )
    return OrganizationAdminRead.model_validate(org)


@router.post(
    "/{org_id}/reject",
    response_model=OrganizationAdminRead,
    summary="Reject an organization (UNDER_REVIEW → REJECTED, requires reason)",
    description=(
        "The reason is surfaced to the owner so they understand why "
        "verification didn't pass. REJECTED orgs are read-only — "
        "the owner creates a fresh org if they want to retry."
    ),
)
def reject_org_admin(
    org_id: UUID,
    payload: OrganizationRejectAdmin,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> OrganizationAdminRead:
    """Move an UNDER_REVIEW org → REJECTED with a required reason.

    The reason is surfaced to the owner on their org detail page so
    they understand why verification didn't pass. REJECTED orgs are
    read-only artifacts; the owner creates a new org if they want
    to try again.
    """
    org = admin_reject_organization(
        db, org_id=org_id, reason=payload.reason, actor_user_id=user.id
    )
    return OrganizationAdminRead.model_validate(org)


# ---------------------------------------------------------------------------
# Attachments viewer — list + signed-URL fetcher for admin review
# ---------------------------------------------------------------------------
@router.get(
    "/{org_id}/attachments",
    response_model=list[OrganizationAttachmentRead],
    summary="List supporting documents on an org (admin view)",
)
def list_org_attachments_admin(
    org_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[OrganizationAttachmentRead]:
    """List supporting documents on an org. Same metadata shape the
    owner sees, scoped to admin role."""
    org = admin_get_organization(db, org_id)
    return [
        OrganizationAttachmentRead.model_validate(a)
        for a in org.attachments
    ]


@router.get(
    "/{org_id}/attachments/{attachment_id}/url",
    response_model=_AdminAttachmentSignedUrl,
    summary="Mint a short-lived signed URL for an org attachment",
    description=(
        "Returns a Supabase Storage signed URL the admin panel can "
        "render in an iframe / image tag for review. Short TTL so a "
        "shared screenshot doesn't keep working forever."
    ),
)
def signed_url_for_org_attachment_admin(
    org_id: UUID,
    attachment_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    storage: StorageClient = Depends(get_storage_client),
) -> _AdminAttachmentSignedUrl:
    """Mint a short-lived signed URL for an org attachment.

    Mirrors the claim-attachment variant: 60s default TTL, asserts
    the attachment belongs to the requested org so a guessed UUID
    can't surface files from an unrelated org.
    """
    attachment = db.execute(
        select(OrganizationAttachment).where(
            OrganizationAttachment.id == attachment_id,
            OrganizationAttachment.organization_id == org_id,
        )
    ).scalar_one_or_none()
    if attachment is None:
        raise NotFoundError(
            "ATTACHMENT_NOT_FOUND",
            "No attachment with that id on this organization.",
        )

    try:
        url = storage.signed_url(
            attachment.storage_path,
            expires_in_seconds=_ATTACHMENT_SIGNED_URL_TTL_SECONDS,
        )
    except StorageError as exc:
        raise BadRequestError(
            "ATTACHMENT_SIGNED_URL_FAILED",
            f"Couldn't generate a download link for this attachment: {exc}",
        )

    return _AdminAttachmentSignedUrl(
        url=url,
        expires_in_seconds=_ATTACHMENT_SIGNED_URL_TTL_SECONDS,
        original_filename=attachment.original_filename,
        content_type=attachment.content_type,
    )
