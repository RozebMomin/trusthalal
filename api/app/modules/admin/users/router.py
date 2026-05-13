from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.admin.organizations.repo import admin_list_user_memberships
from app.modules.admin.users.repo import (
    UserWithAccountState,
    admin_create_user,
    admin_get_user,
    admin_list_users,
    admin_patch_user,
    admin_resend_invite,
)
from app.modules.admin.users.schemas import (
    ResendInviteResponse,
    UserAdminCreate,
    UserAdminCreateResponse,
    UserAdminPatch,
    UserAdminRead,
    UserOrganizationMembershipRead,
    UserOrganizationSummary,
)
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/users", tags=["admin: users"])


def _to_admin_read(decorated: UserWithAccountState) -> UserAdminRead:
    """Flatten ``UserWithAccountState`` into the wire response shape.

    Kept inline (not on the dataclass) so the model stays a pure
    SQLAlchemy row carrier — the router owns the HTTP projection.
    """
    user = decorated.user
    return UserAdminRead(
        id=user.id,
        email=user.email,
        role=UserRole(user.role),
        display_name=user.display_name,
        is_active=user.is_active,
        account_state=decorated.account_state,
        invite_expires_at=decorated.invite_expires_at,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.post(
    "",
    response_model=UserAdminCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user and mint a single-use invite token",
    description=(
        "Used to onboard new staff (ADMIN, VERIFIER) and the rare "
        "admin-created OWNER. Returns a one-time invite URL the admin "
        "can share with the new user. The plaintext token is visible "
        "ONLY in this response — there's no endpoint to re-fetch it."
    ),
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


@router.get(
    "",
    response_model=list[UserAdminRead],
    summary="List users with role / active / search filters",
)
def list_users_admin(
    role: UserRole | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[UserAdminRead]:
    decorated = admin_list_users(
        db, role=role, is_active=is_active, q=q, limit=limit, offset=offset
    )
    return [_to_admin_read(d) for d in decorated]


@router.get(
    "/{user_id}",
    response_model=UserAdminRead,
    summary="Get a user by id",
)
def get_user_admin(
    user_id: UUID,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> UserAdminRead:
    return _to_admin_read(admin_get_user(db, user_id))


@router.patch(
    "/{user_id}",
    response_model=UserAdminRead,
    summary="Edit a user (display_name, role, is_active)",
    description=(
        "Self-demotion and self-deactivation are blocked at the repo "
        "layer — an ADMIN can't accidentally lock themselves out by "
        "editing their own row."
    ),
)
def patch_user_admin(
    user_id: UUID,
    payload: UserAdminPatch,
    db: Session = Depends(get_db),
    actor: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> UserAdminRead:
    return _to_admin_read(
        admin_patch_user(
            db,
            user_id=user_id,
            patch=payload,
            actor_user_id=actor.id,
        )
    )


@router.post(
    "/{user_id}/resend-invite",
    response_model=ResendInviteResponse,
    status_code=status.HTTP_200_OK,
    summary="Mint a fresh invite for a user who hasn't onboarded yet",
    description=(
        "Revokes any outstanding live invite for this user and mints a "
        "new one, then triggers the invite email. Returns the same "
        "``invite_token`` / ``invite_url`` / ``invite_expires_at`` "
        "fields as ``POST /admin/users`` so the admin UI can reuse its "
        "copy-to-clipboard widget. Rejects users who already set a "
        "password (use password-reset instead) or who are deactivated "
        "(reactivate first)."
    ),
)
def resend_invite_admin(
    user_id: UUID,
    db: Session = Depends(get_db),
    actor: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> ResendInviteResponse:
    resent = admin_resend_invite(
        db, user_id=user_id, actor_user_id=actor.id
    )
    return ResendInviteResponse(
        invite_token=resent.invite_token,
        invite_url=resent.invite_url,
        invite_expires_at=resent.invite_expires_at,
    )


@router.get(
    "/{user_id}/organizations",
    response_model=list[UserOrganizationMembershipRead],
    summary="List a user's organization memberships",
    description=(
        "Includes REMOVED memberships — the admin UI decides whether "
        "to surface them. Used by the admin user-detail page's "
        "Organizations section."
    ),
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
