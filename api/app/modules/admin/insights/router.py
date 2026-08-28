from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.admin.insights.repo import admin_trending_places
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/insights", tags=["admin: insights"])


class TrendingPlaceRead(BaseModel):
    place_id: str
    name: str
    city: str | None = None
    region: str | None = None
    is_deleted: bool
    views: int
    directions: int
    called: int
    shared: int
    favorited: int
    reviewed: int
    total: int
    score: int
    prev_total: int


class TrendingSummaryRead(BaseModel):
    window_days: int
    active_places: int
    total_views: int
    total_directions: int
    total_signals: int


class TrendingResponse(BaseModel):
    summary: TrendingSummaryRead
    places: list[TrendingPlaceRead]


@router.get(
    "/trending",
    response_model=TrendingResponse,
    summary="Top places by weighted engagement over a recent window",
    description=(
        "Rolls the first-party place_signals up per place over the last "
        "`window` days, weights the signal mix into a score, and includes the "
        "prior window's total for momentum. Views are server-recorded; "
        "directions/called/shared/favorited/reviewed come from real actions."
    ),
)
def trending_admin(
    window: int = Query(7, ge=1, le=90),
    limit: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> TrendingResponse:
    result = admin_trending_places(db, window_days=window, limit=limit)
    return TrendingResponse(
        summary=TrendingSummaryRead(**result.summary.__dict__),
        places=[TrendingPlaceRead(**row.__dict__) for row in result.places],
    )
