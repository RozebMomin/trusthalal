"""Admin engagement / trending read-out over ``place_signals``.

Signals are already deduped to one row per (place, signal, day, person), so a
plain count is an honest "distinct people who did X" — no extra dedup needed
here. We roll the current window up per place, weight the signal mix into a
single score, and compare against the immediately preceding window of the same
length so the UI can show momentum.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.places.models import Place
from app.modules.places.signals import PlaceSignal, PlaceSignalRow

# Weight the signal mix into one score. Leaving the app for maps or a phone
# call is far stronger intent than a page view; a review is the strongest of
# all. Views still dominate by volume, so they carry weight 1 and the rest lift
# a place above a pure eyeball count.
WEIGHTS: dict[str, int] = {
    PlaceSignal.VIEWED.value: 1,
    PlaceSignal.FAVORITED.value: 2,
    PlaceSignal.CALLED.value: 3,
    PlaceSignal.SHARED.value: 3,
    PlaceSignal.DIRECTIONS.value: 4,
    PlaceSignal.REVIEWED.value: 5,
}


@dataclass
class TrendingRow:
    place_id: str
    name: str
    city: str | None
    region: str | None
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


@dataclass
class TrendingSummary:
    window_days: int
    active_places: int
    total_views: int
    total_directions: int
    total_signals: int


@dataclass
class TrendingResult:
    summary: TrendingSummary
    places: list[TrendingRow]


def _count(sig: PlaceSignal):
    return func.count().filter(PlaceSignalRow.signal == sig.value)


def _counts_by_place(db: Session, *, start, end) -> dict:
    """Per-place per-signal counts for occurred_on in [start, end)."""
    rows = db.execute(
        select(
            PlaceSignalRow.place_id.label("place_id"),
            _count(PlaceSignal.VIEWED).label("views"),
            _count(PlaceSignal.DIRECTIONS).label("directions"),
            _count(PlaceSignal.CALLED).label("called"),
            _count(PlaceSignal.SHARED).label("shared"),
            _count(PlaceSignal.FAVORITED).label("favorited"),
            _count(PlaceSignal.REVIEWED).label("reviewed"),
            func.count().label("total"),
        )
        .where(
            PlaceSignalRow.occurred_on >= start,
            PlaceSignalRow.occurred_on < end,
        )
        .group_by(PlaceSignalRow.place_id)
    ).all()
    return {r.place_id: r for r in rows}


def _totals_by_place(db: Session, *, start, end) -> dict:
    rows = db.execute(
        select(PlaceSignalRow.place_id, func.count())
        .where(
            PlaceSignalRow.occurred_on >= start,
            PlaceSignalRow.occurred_on < end,
        )
        .group_by(PlaceSignalRow.place_id)
    ).all()
    return {pid: total for pid, total in rows}


def admin_trending_places(
    db: Session, *, window_days: int = 7, limit: int = 25
) -> TrendingResult:
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=window_days - 1)  # window ends today, inclusive
    end = today + timedelta(days=1)  # exclusive upper bound includes today
    prev_start = start - timedelta(days=window_days)

    cur = _counts_by_place(db, start=start, end=end)
    prev = _totals_by_place(db, start=prev_start, end=start)

    if not cur:
        return TrendingResult(
            summary=TrendingSummary(window_days, 0, 0, 0, 0), places=[]
        )

    places = {
        p.id: p
        for p in db.execute(
            select(Place).where(Place.id.in_(list(cur.keys())))
        ).scalars()
    }

    rows: list[TrendingRow] = []
    for place_id, c in cur.items():
        place = places.get(place_id)
        if place is None:
            continue  # signal for a hard-deleted place; skip
        score = (
            c.views * WEIGHTS[PlaceSignal.VIEWED.value]
            + c.directions * WEIGHTS[PlaceSignal.DIRECTIONS.value]
            + c.called * WEIGHTS[PlaceSignal.CALLED.value]
            + c.shared * WEIGHTS[PlaceSignal.SHARED.value]
            + c.favorited * WEIGHTS[PlaceSignal.FAVORITED.value]
            + c.reviewed * WEIGHTS[PlaceSignal.REVIEWED.value]
        )
        rows.append(
            TrendingRow(
                place_id=str(place_id),
                name=place.name,
                city=place.city,
                region=place.region,
                is_deleted=bool(place.is_deleted),
                views=c.views,
                directions=c.directions,
                called=c.called,
                shared=c.shared,
                favorited=c.favorited,
                reviewed=c.reviewed,
                total=c.total,
                score=score,
                prev_total=int(prev.get(place_id, 0)),
            )
        )

    rows.sort(key=lambda r: (r.score, r.total), reverse=True)

    summary = TrendingSummary(
        window_days=window_days,
        active_places=len(cur),
        total_views=sum(c.views for c in cur.values()),
        total_directions=sum(c.directions for c in cur.values()),
        total_signals=sum(c.total for c in cur.values()),
    )
    return TrendingResult(summary=summary, places=rows[:limit])
