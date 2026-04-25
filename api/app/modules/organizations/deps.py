from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.db.deps import get_db
from app.modules.users.enums import UserRole
from app.modules.organizations.models import OrganizationMember, PlaceOwner


def assert_can_manage_place(db: Session, user: CurrentUser, place_id: UUID) -> None:
    if user.role == UserRole.ADMIN:
        return

    ok = db.execute(
        select(PlaceOwner.id)
        .join(OrganizationMember, OrganizationMember.organization_id == PlaceOwner.organization_id)
        .where(
            PlaceOwner.place_id == place_id,
            PlaceOwner.status.in_(["ACTIVE", "VERIFIED"]),
            OrganizationMember.user_id == user.id,
            OrganizationMember.status == "ACTIVE",
            OrganizationMember.role.in_(["OWNER_ADMIN", "MANAGER"]),
        )
    ).scalar_one_or_none()

    if not ok:
        raise HTTPException(status_code=403, detail="Not authorized for this place")


def require_place_owner_member_or_admin(place_id: UUID):
    def _dep(
        db: Session = Depends(get_db),
        user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        assert_can_manage_place(db, user, place_id)
        return user

    return _dep