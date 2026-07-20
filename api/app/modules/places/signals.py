"""Engagement capture for a future "trending" surface.

## Why this exists now, when nothing reads it

Trending is a velocity measure: how much attention a place is getting this
week against its own baseline. That needs history, and history is the one
thing you cannot add later. Every day this isn't recording is a day the
feature can't reason about, so the capture ships well ahead of anything that
consumes it.

Nothing in the product reads this table yet. That's deliberate — see
docs/trending-data-capture.md for the reasons the tab isn't built.

## Why not just query PostHog

The client events already fire (``place_viewed``, ``directions_tapped``, …)
and PostHog has them. It's the wrong substrate for a product feature on three
counts: the retention window expires, the query API is too slow and too
rate-limited to sit in a request path, and the events are self-reported by
clients, so anyone who wants their restaurant to trend can say so. This table
is first-party, written server-side, and joins to ``places`` in one query.

## The dedup key is the part that can't be changed later

One row per (place, signal, day, actor). The actor is not stored — what's
stored is a salted hash of it, and the salt includes the date, so the value
for the same person changes every midnight and can't be used to follow anyone
across days. The raw identifier never lands in the table.

This has to be right from the first row. Counting is easy to fix in a query;
deduplication is not, because rows written without a usable key can never be
collapsed retroactively. A place with one obsessive fan and a place with forty
visitors have to be distinguishable in the data, or "trending" measures
enthusiasm for refreshing a page.

``user_id`` is deliberately absent. Nothing here needs to know who did what —
only how many distinct someones did it — and keeping the table unlinked means
this is unlinked usage data for App Privacy purposes, so it changes nothing
about the declarations already published.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import date, datetime, timezone
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.base import Base

logger = logging.getLogger(__name__)


class PlaceSignal(StrEnum):
    """What someone did. Weighting belongs to whatever computes trending, not
    here — the capture layer's job is to record what happened, not to decide
    in advance what it's worth. Weights get tuned against real data; a signal
    thrown away at write time is gone."""

    VIEWED = "VIEWED"
    """Opened the place detail page. Recorded server-side on the read, so it
    can't be forged by a client."""

    DIRECTIONS = "DIRECTIONS"
    """Tapped through to maps. The strongest intent signal short of a review —
    people don't ask for driving directions idly."""

    CALLED = "CALLED"
    SHARED = "SHARED"
    FAVORITED = "FAVORITED"
    REVIEWED = "REVIEWED"
    PHOTO_ADDED = "PHOTO_ADDED"


#: Signals a client is allowed to report. VIEWED is absent on purpose: it's
#: written server-side from the detail route, and accepting it from a client
#: would hand anyone a view counter to inflate.
CLIENT_REPORTABLE = frozenset(
    {PlaceSignal.DIRECTIONS, PlaceSignal.CALLED, PlaceSignal.SHARED}
)


class PlaceSignalRow(Base):
    __tablename__ = "place_signals"
    __table_args__ = (
        # The dedup contract. Same person, same place, same signal, same day
        # collapses to one row.
        UniqueConstraint(
            "place_id", "signal", "occurred_on", "actor_hash",
            name="uq_place_signals_dedup",
        ),
        {"schema": "app"},
    )

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    place_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("app.places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    signal: Mapped[str] = mapped_column(String(24), nullable=False)

    #: Date in UTC. Trending windows are counted in days, so the day is the
    #: unit that matters and storing it separately keeps the dedup constraint
    #: and the group-by on the same column.
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    #: Salted, date-rotated hash of the actor. Never the actor.
    actor_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


def actor_hash(subject: str, *, on: date, place_id: UUID, signal: PlaceSignal) -> str:
    """Pseudonymise an actor for one place, one signal, one day.

    ``subject`` is a user id when we have one and a coarse request fingerprint
    when we don't. Neither is stored.

    The place and signal are folded in as well as the date, so the same person
    produces unrelated values for two different places on the same day. That
    stops the column being usable to reconstruct one person's browsing even by
    someone holding the secret.
    """
    secret = settings.PLACE_SIGNAL_SECRET
    material = f"{secret}|{on.isoformat()}|{place_id}|{signal.value}|{subject}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def record_signal(
    db: Session,
    *,
    place_id: UUID,
    signal: PlaceSignal,
    subject: str,
    on: date | None = None,
) -> bool:
    """Record one signal. Returns True if a row was written, False if the
    actor already produced this signal for this place today.

    ``ON CONFLICT DO NOTHING`` rather than a read-then-write: this runs on the
    place-detail read path, where two tabs opening at once would otherwise
    race and raise. The database already holds the dedup contract, so let it
    enforce it.

    Never raises, and — the part that actually matters — never leaves the
    caller's transaction unusable. This is instrumentation riding on a request
    that has already done its real work; failing to count a view must not fail
    the view.

    Catching the exception is not enough on its own. Postgres aborts the whole
    transaction when a statement errors, so a swallowed failure here would
    surface as the caller's next statement or its commit blowing up instead —
    the same 500, just harder to trace back. The insert therefore runs inside a
    SAVEPOINT, and a failure rolls back only that, leaving the outer
    transaction intact.
    """
    day = on or datetime.now(timezone.utc).date()
    try:
        with db.begin_nested():
            # RETURNING, not rowcount. An INSERT ... ON CONFLICT DO NOTHING
            # that conflicts reports rowcount as -1 through this driver, and
            # bool(-1) is True — so the suppressed insert claimed to have
            # written a row. The table was correct the whole time (the dedup
            # test passed); only the return value lied, which is the more
            # dangerous failure, because a caller branching on it would have
            # been wrong silently. RETURNING yields no row when the insert is
            # suppressed, which is unambiguous and driver-independent.
            result = db.execute(
                pg_insert(PlaceSignalRow.__table__)
                .values(
                    id=uuid4(),
                    place_id=place_id,
                    signal=signal.value,
                    occurred_on=day,
                    actor_hash=actor_hash(
                        subject, on=day, place_id=place_id, signal=signal
                    ),
                )
                .on_conflict_do_nothing(constraint="uq_place_signals_dedup")
                .returning(PlaceSignalRow.__table__.c.id)
            )
            return result.first() is not None
    except Exception:  # noqa: BLE001 — see docstring
        logger.warning(
            "place signal not recorded (place_id=%s signal=%s)",
            place_id, signal.value, exc_info=True,
        )
        return False


def request_subject(request, user_id: UUID | None) -> str:
    """Best available identity for dedup, in preference order.

    A signed-in user id is stable and exact. Without one, fall back to the
    client address plus user agent — coarse (a household behind one NAT counts
    once, an office counts once) but wrong in the safe direction: it
    under-counts rather than letting one person manufacture traffic. Neither
    value is stored; both are hashed by the caller.
    """
    if user_id is not None:
        return f"u:{user_id}"
    client = getattr(request, "client", None)
    ip = getattr(client, "host", None) or "unknown"
    # X-Forwarded-For, when present, is the real client in front of the proxy.
    fwd = request.headers.get("x-forwarded-for") if hasattr(request, "headers") else None
    if fwd:
        ip = fwd.split(",")[0].strip()
    ua = (request.headers.get("user-agent") or "")[:120] if hasattr(request, "headers") else ""
    return f"a:{ip}|{ua}"
