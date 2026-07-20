"""Engagement capture.

The assertions that matter here are about deduplication, not counting.
Counting rules can be rewritten in a query whenever trending is actually
built; rows written without a usable dedup key can never be collapsed
retroactively. So these tests pin the behaviour that has to be right on the
first row and cannot be repaired later.
"""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from sqlalchemy import func, select

from app.modules.places.signals import (
    PlaceSignal,
    PlaceSignalRow,
    actor_hash,
    record_signal,
)


def _count(db, place_id, signal=None) -> int:
    stmt = select(func.count(PlaceSignalRow.id)).where(
        PlaceSignalRow.place_id == place_id
    )
    if signal is not None:
        stmt = stmt.where(PlaceSignalRow.signal == signal.value)
    return int(db.execute(stmt).scalar_one())


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------


def test_same_actor_same_day_counts_once(db_session, factories):
    """The whole point. One person refreshing is not forty people looking."""
    place = factories.place()
    for _ in range(40):
        record_signal(
            db_session, place_id=place.id, signal=PlaceSignal.VIEWED,
            subject="u:alice",
        )
    db_session.flush()
    assert _count(db_session, place.id, PlaceSignal.VIEWED) == 1


def test_record_signal_reports_whether_it_wrote(db_session, factories):
    place = factories.place()
    first = record_signal(
        db_session, place_id=place.id, signal=PlaceSignal.VIEWED, subject="u:alice"
    )
    second = record_signal(
        db_session, place_id=place.id, signal=PlaceSignal.VIEWED, subject="u:alice"
    )
    assert first is True and second is False


def test_different_actors_count_separately(db_session, factories):
    place = factories.place()
    for who in ("u:alice", "u:bob", "u:carol"):
        record_signal(
            db_session, place_id=place.id, signal=PlaceSignal.VIEWED, subject=who
        )
    db_session.flush()
    assert _count(db_session, place.id, PlaceSignal.VIEWED) == 3


def test_same_actor_counts_again_the_next_day(db_session, factories):
    """Trending is a velocity measure — someone coming back tomorrow is the
    signal — so the dedup window has to be the day, not forever."""
    place = factories.place()
    day = date(2026, 7, 20)
    record_signal(
        db_session, place_id=place.id, signal=PlaceSignal.VIEWED,
        subject="u:alice", on=day,
    )
    record_signal(
        db_session, place_id=place.id, signal=PlaceSignal.VIEWED,
        subject="u:alice", on=day + timedelta(days=1),
    )
    db_session.flush()
    assert _count(db_session, place.id, PlaceSignal.VIEWED) == 2


def test_signals_are_deduped_independently(db_session, factories):
    """Viewing and then asking for directions are two different facts about
    the same person, and the second is the one that means something."""
    place = factories.place()
    record_signal(
        db_session, place_id=place.id, signal=PlaceSignal.VIEWED, subject="u:alice"
    )
    record_signal(
        db_session, place_id=place.id, signal=PlaceSignal.DIRECTIONS, subject="u:alice"
    )
    db_session.flush()
    assert _count(db_session, place.id) == 2


# ---------------------------------------------------------------------------
# The hash
# ---------------------------------------------------------------------------


def test_actor_hash_does_not_contain_the_actor(db_session, factories):
    """The identifier must not be recoverable by reading the column."""
    place = factories.place()
    record_signal(
        db_session, place_id=place.id, signal=PlaceSignal.VIEWED,
        subject="u:alice@example.com",
    )
    db_session.flush()
    row = db_session.execute(
        select(PlaceSignalRow).where(PlaceSignalRow.place_id == place.id)
    ).scalars().first()
    assert "alice" not in row.actor_hash
    assert "@" not in row.actor_hash
    assert len(row.actor_hash) == 64


def test_same_actor_hashes_differently_per_day(factories):
    """Rotation. A stable per-person value would let anyone with table access
    reconstruct one person's history; this can't be followed across days."""
    place = factories.place()
    a = actor_hash("u:alice", on=date(2026, 7, 20),
                   place_id=place.id, signal=PlaceSignal.VIEWED)
    b = actor_hash("u:alice", on=date(2026, 7, 21),
                   place_id=place.id, signal=PlaceSignal.VIEWED)
    assert a != b


def test_same_actor_hashes_differently_per_place(factories):
    """Folding the place in means the column can't be used to join one
    person's visits to different restaurants together."""
    one, two = factories.place(), factories.place()
    a = actor_hash("u:alice", on=date(2026, 7, 20),
                   place_id=one.id, signal=PlaceSignal.VIEWED)
    b = actor_hash("u:alice", on=date(2026, 7, 20),
                   place_id=two.id, signal=PlaceSignal.VIEWED)
    assert a != b


# ---------------------------------------------------------------------------
# Failure posture
# ---------------------------------------------------------------------------


def test_a_failed_signal_leaves_the_transaction_usable(db_session, factories):
    """The promise is not just "doesn't raise" — it's "doesn't poison the
    caller's transaction". Postgres aborts a transaction when any statement
    errors, so without the savepoint this failure would surface as the next
    statement blowing up instead: the same 500, harder to trace. A signal for
    a place that doesn't exist violates the FK, which is the cheapest way to
    provoke it."""
    assert record_signal(
        db_session, place_id=uuid4(), signal=PlaceSignal.VIEWED, subject="u:alice"
    ) is False

    # The session must still work afterwards.
    place = factories.place()
    assert record_signal(
        db_session, place_id=place.id, signal=PlaceSignal.VIEWED, subject="u:alice"
    ) is True
    db_session.flush()
    assert _count(db_session, place.id, PlaceSignal.VIEWED) == 1


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def test_place_detail_records_a_view(api, db_session, factories):
    place = factories.place()
    db_session.commit()
    assert api.get(f"/places/{place.id}").status_code == 200
    assert _count(db_session, place.id, PlaceSignal.VIEWED) == 1


def test_beacon_records_directions(api, db_session, factories):
    place = factories.place()
    db_session.commit()
    r = api.post(f"/places/{place.id}/signals", json={"signal": "DIRECTIONS"})
    assert r.status_code == 204
    assert _count(db_session, place.id, PlaceSignal.DIRECTIONS) == 1


def test_beacon_is_idempotent_for_the_same_caller(api, db_session, factories):
    place = factories.place()
    db_session.commit()
    for _ in range(5):
        api.post(f"/places/{place.id}/signals", json={"signal": "CALLED"})
    assert _count(db_session, place.id, PlaceSignal.CALLED) == 1


def test_beacon_refuses_views(api, db_session, factories):
    """VIEWED is server-side only. Accepting it here would hand anyone a view
    counter to inflate, and views are what a trending rank leans on hardest."""
    place = factories.place()
    db_session.commit()
    r = api.post(f"/places/{place.id}/signals", json={"signal": "VIEWED"})
    assert r.status_code == 400
    assert _count(db_session, place.id, PlaceSignal.VIEWED) == 0


def test_beacon_404s_on_unknown_place(api):
    assert api.post(
        f"/places/{uuid4()}/signals", json={"signal": "CALLED"}
    ).status_code == 404


def test_beacon_rejects_unknown_signal(api, db_session, factories):
    place = factories.place()
    db_session.commit()
    assert api.post(
        f"/places/{place.id}/signals", json={"signal": "NOPE"}
    ).status_code == 422


# ---------------------------------------------------------------------------
# The signals that ride on existing writes
# ---------------------------------------------------------------------------


def test_favoriting_records_once_even_when_saved_twice(api, db_session, factories):
    """POST /me/favorites is idempotent, so a double-tap must not read as two
    separate acts of interest."""
    user = factories.consumer()
    place = factories.place()
    db_session.commit()
    client = api.as_user(user)
    client.post(f"/me/favorites/{place.id}")
    client.post(f"/me/favorites/{place.id}")
    assert _count(db_session, place.id, PlaceSignal.FAVORITED) == 1
