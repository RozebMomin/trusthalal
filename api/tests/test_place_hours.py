"""Unit tests for is_open_now — pure logic, no DB/network."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from app.modules.places.hours import is_open_now

# Google day convention: 0=Sunday .. 6=Saturday. Monday is 1.
_MON_9_TO_21 = {
    "periods": [
        {
            "open": {"day": 1, "hour": 9, "minute": 0},
            "close": {"day": 1, "hour": 21, "minute": 0},
        }
    ]
}
NY = "America/New_York"


def _at(y, m, d, hh, mm, tz=NY):
    return datetime(y, m, d, hh, mm, tzinfo=ZoneInfo(tz))


def test_open_during_monday_hours():
    # 2026-07-13 is a Monday.
    assert is_open_now(_MON_9_TO_21, NY, now=_at(2026, 7, 13, 12, 0)) is True


def test_closed_before_open():
    assert is_open_now(_MON_9_TO_21, NY, now=_at(2026, 7, 13, 8, 0)) is False


def test_closed_after_close():
    assert is_open_now(_MON_9_TO_21, NY, now=_at(2026, 7, 13, 21, 30)) is False


def test_closed_on_a_day_with_no_period():
    # Tuesday — no period defined.
    assert is_open_now(_MON_9_TO_21, NY, now=_at(2026, 7, 14, 12, 0)) is False


def test_unknown_when_no_hours():
    assert is_open_now(None, NY) is None
    assert is_open_now({"periods": []}, NY) is None


def test_unknown_when_no_timezone():
    assert is_open_now(_MON_9_TO_21, None, now=_at(2026, 7, 13, 12, 0)) is None


def test_unknown_when_bad_timezone():
    assert is_open_now(_MON_9_TO_21, "Not/AZone", now=_at(2026, 7, 13, 12, 0)) is None


def test_24h_period_without_close_is_open():
    always = {"periods": [{"open": {"day": 0, "hour": 0, "minute": 0}}]}
    assert is_open_now(always, NY, now=_at(2026, 7, 15, 3, 0)) is True


def test_overnight_period_wraps_past_midnight():
    # Open Saturday 22:00 -> Sunday 02:00 (close day 0 < open day 6).
    overnight = {
        "periods": [
            {
                "open": {"day": 6, "hour": 22, "minute": 0},
                "close": {"day": 0, "hour": 2, "minute": 0},
            }
        ]
    }
    # 2026-07-19 is a Sunday. 01:00 Sunday should still be open.
    assert is_open_now(overnight, NY, now=_at(2026, 7, 19, 1, 0)) is True
    # 2026-07-18 is a Saturday. 23:00 Saturday should be open.
    assert is_open_now(overnight, NY, now=_at(2026, 7, 18, 23, 0)) is True
    # Sunday 03:00 should be closed.
    assert is_open_now(overnight, NY, now=_at(2026, 7, 19, 3, 0)) is False


def test_timezone_matters():
    # Same instant, different place tz → different local wall clock.
    # 2026-07-13 08:30 America/Los_Angeles == 11:30 America/New_York.
    now_la = _at(2026, 7, 13, 8, 30, tz="America/Los_Angeles")
    # Against NY hours + NY tz the LA-instant is 11:30 NY → open.
    assert is_open_now(_MON_9_TO_21, NY, now=now_la) is True
    # Against the same hours interpreted in LA tz it's 08:30 → closed.
    assert is_open_now(_MON_9_TO_21, "America/Los_Angeles", now=now_la) is False
