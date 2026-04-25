from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.db.deps import get_db
from app.modules.places.models import PlaceOwner
from app.modules.users.enums import UserRole


def require_place_owner_or_admin(place_id: UUID):
    def _dep(
        db: Session = Depends(get_db),
        user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if user.role == UserRole.ADMIN:
            return user

        if user.role != UserRole.OWNER:
            raise HTTPException(status_code=403, detail="Forbidden")

        ok = db.execute(
            select(PlaceOwner.id).where(
                PlaceOwner.place_id == place_id,
                PlaceOwner.user_id == user.id,
            )
        ).scalar_one_or_none()

        if not ok:
            raise HTTPException(status_code=403, detail="Not owner of this place")

        return user

    return _dep