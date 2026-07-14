"""Compute "open now" from stored Google opening hours + place timezone.

We store the canonical weekly schedule (``Place.opening_hours``) and the
place's IANA timezone, then evaluate open/closed ourselves rather than
trusting Google's point-in-time ``openNow`` flag — so the answer stays
correct between weekly syncs and for any "now" we're asked about.

Schedule shape (see integrations/google.py ``_extract_hours``):

    {"periods": [
        {"open":  {"day": 0, "hour": 9,  "minute": 0},
         "close": {"day": 0, "hour": 21, "minute": 0}},
        ...
    ]}

``day`` is Google's convention: 0=Sunday .. 6=Saturday. A period whose
``close`` is ``None`` means "open 24 hours" (Google's representation for
always-open places).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MINUTES_PER_WEEK = 7 * 24 * 60


def _abs_minute(point: dict[str, Any]) -> Optional[int]:
    day = point.get("day")
    hour = point.get("hour", 0)
    minute = point.get("minute", 0)
    if not isinstance(day, int):
        return None
    return day * 1440 + int(hour) * 60 + int(minute)


def _now_abs_minute(now: datetime) -> int:
    # Python: Monday=0..Sunday=6. Google: Sunday=0..Saturday=6.
    google_day = (now.weekday() + 1) % 7
    return google_day * 1440 + now.hour * 60 + now.minute


def is_open_now(
    opening_hours: Optional[dict],
    timezone: Optional[str],
    *,
    now: Optional[datetime] = None,
) -> Optional[bool]:
    """Return True/False if hours + timezone are known, else None (unknown).

    ``now`` is mainly for tests; production passes nothing and we use the
    current time in the place's timezone.
    """
    if not opening_hours or not timezone:
        return None
    periods = opening_hours.get("periods")
    if not isinstance(periods, list) or not periods:
        return None

    try:
        tz = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return None

    local_now = (now.astimezone(tz) if now is not None else datetime.now(tz))
    current = _now_abs_minute(local_now)

    for period in periods:
        if not isinstance(period, dict):
            continue
        open_pt = period.get("open")
        if not isinstance(open_pt, dict):
            continue
        open_abs = _abs_minute(open_pt)
        if open_abs is None:
            continue

        close_pt = period.get("close")
        if not isinstance(close_pt, dict):
            # No close = open 24 hours.
            return True
        close_abs = _abs_minute(close_pt)
        if close_abs is None:
            return True

        # Period wrapping past the end of the week (e.g. Sat 22:00 → Sun 02:00).
        if close_abs <= open_abs:
            close_abs += MINUTES_PER_WEEK

        # Test the current minute both as-is and shifted a week forward, so a
        # time early in the week that belongs to a wrap from the previous
        # Saturday still matches.
        if open_abs <= current < close_abs or open_abs <= current + MINUTES_PER_WEEK < close_abs:
            return True

    return False
