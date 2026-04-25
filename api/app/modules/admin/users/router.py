from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.admin.organizations.repo import admin_list_user_memberships
from app.modules.admin.users.repo import (
    admin_create_user,
    admin_get_user,
    admin_list_users,
    admin_patch_user,
)
from app.modules.admin.users.schemas import (
    UserAdminCreate,
    UserAdminCreateResponse,
    UserAdminPatch,
    UserAdminRead,
    UserOrganizationMembershipRead,
    UserOrganizationSummary,
)
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/users", tags=["admin"])


@router.post(
    "",
    response_model=UserAdminCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_admin(
    payload: UserAdminCreate,
    db: Session = Depends(get_db),
    actor: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> UserAdminCreateResponse:
    """Create a user + mint a single-use invite token.

    The response carries both the canonical user columns and the
    one-time invite fields (``invite_token``, ``invite_url``,
    ``invite_expires_at``) so the admin panel can show the URL in a
    copy-to-clipboard pane. The plaintext token is only visible here —
    there is no endpoint to re-fetch it.

    ``actor.id`` is threaded through to ``invite_tokens.created_by_user_id``
    so the audit trail carries "which admin minted this invite."
    """
    result = admin_create_user(db, payload, actor_user_id=actor.id)
    return UserAdminCreateResponse(
        id=result.user.id,
        email=result.user.email,
        role=UserRole(result.user.role),
        display_name=result.user.display_name,
        is_active=result.user.is_active,
        created_at=result.user.created_at,
        updated_at=result.user.updated_at,
        invite_token=result.invite_token,
        invite_url=result.invite_url,
        invite_expires_at=result.invite_expires_at,
    )


@router.get("", response_model=list[UserAdminRead])
def list_users_admin(
    role: UserRole | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[UserAdminRead]:
    return admin_list_users(db, role=role, is_active=is_active, q=q, limit=limit, offset=offset)


@router.get("/{user_id}", response_model=UserAdminRead)
def get_user_admin(
    user_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> UserAdminRead:
    return admin_get_user(db, user_id)


@router.patch("/{user_id}", response_model=UserAdminRead)
def patch_user_admin(
    user_id: UUID,
    payload: UserAdminPatch,
    db: Session = Depends(get_db),
    actor: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> UserAdminRead:
    return admin_patch_user(
        db,
        user_id=user_id,
        patch=payload,
        actor_user_id=actor.id,
    )


@router.get(
    "/{user_id}/organizations",
    response_model=list[UserOrganizationMembershipRead],
)
def list_user_organizations_admin(
    user_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[UserOrganizationMembershipRead]:
    """List a user's org memberships + nested org info.

    Powers the Organizations section on the admin user detail page.
    Includes REMOVED memberships — the UI decides whether to surface
    them. 404s cleanly if the user id is unknown.
    """
    rows = admin_list_user_memberships(db, user_id=user_id)
    return [
        UserOrganizationMembershipRead(
            id=member.id,
            role=member.role,
            status=member.status,
            created_at=member.created_at,
            updated_at=member.updated_at,
            organization=UserOrganizationSummary.model_validate(org),
        )
        for member, org in rows
    ]
