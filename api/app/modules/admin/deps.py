from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user, require_roles
from app.modules.users.enums import UserRole
from app.db.deps import get_db


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    # require_roles returns a dependency callable; easiest is just do a simple check
    if user.role != UserRole.ADMIN:
        # require_roles would raise HTTPException(403); mirror same behavior
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Forbidden")
    return user


def admin_db(db: Session = Depends(get_db)) -> Session:
    return db