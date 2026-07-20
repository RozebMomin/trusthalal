"""Engagement capture for a future trending surface

Trending is a velocity measure — attention this week against a place's own
baseline — and that needs history nobody can backfill. So the capture table
lands well before anything reads it. Nothing in the product queries this yet.

The interesting column is ``actor_hash``: a salted, date-rotated hash of
whoever produced the signal, never the identity itself. It exists so one
person refreshing a page forty times counts once. Deduplication is the part
that cannot be fixed later — counting rules can be rewritten in a query, but
rows written without a usable dedup key can never be collapsed retroactively.

Backfills from data already carrying timestamps (favorites, reviews, consumer
photos) so the table starts with real history instead of starting from today.

Revision ID: u4a5b6c7d8e9
Revises: t3f4a5b6c7d8
Create Date: 2026-07-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "u4a5b6c7d8e9"
down_revision: Union[str, None] = "t3f4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "place_signals",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "place_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("signal", sa.String(length=24), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("actor_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "place_id", "signal", "occurred_on", "actor_hash",
            name="uq_place_signals_dedup",
        ),
        schema="app",
    )

    # The query trending will actually run: "signals for these places, in this
    # window, grouped by place and day". Leading with occurred_on because the
    # window is always the most selective predicate — a fortnight out of all
    # history — and place_id follows for the group-by.
    op.create_index(
        "ix_place_signals_window",
        "place_signals",
        ["occurred_on", "place_id", "signal"],
        schema="app",
    )
    op.create_index(
        "ix_place_signals_place", "place_signals", ["place_id"], schema="app"
    )

    # ---- backfill ---------------------------------------------------------
    # Favourites, reviews and diner photos already carry a timestamp and an
    # actor, so the history they imply is recoverable. Views and directions
    # taps are not — those only ever existed in PostHog — which is the whole
    # reason this table is landing before the feature that reads it.
    #
    # Hashed in Python by calling the application's own ``actor_hash``, not by
    # reimplementing it in SQL. A SQL version would need pgcrypto's digest()
    # and, worse, would be a second copy of the formula: if the two ever
    # drifted nothing would error, the backfilled rows would simply stop
    # deduplicating against live ones, and a place's earliest history would
    # quietly double-count. Volumes here are small enough that row-at-a-time
    # is irrelevant.
    from uuid import uuid4

    from app.modules.places.signals import PlaceSignal, actor_hash

    conn = op.get_bind()
    sources = (
        ("SELECT place_id, user_id, created_at FROM app.consumer_favorites",
         PlaceSignal.FAVORITED),
        ("SELECT place_id, author_user_id AS user_id, created_at FROM app.place_reviews",
         PlaceSignal.REVIEWED),
        ("SELECT place_id, uploaded_by_user_id AS user_id, created_at "
         "FROM app.place_photos "
         "WHERE uploaded_by_user_id IS NOT NULL AND source = 'CONSUMER'",
         PlaceSignal.PHOTO_ADDED),
    )
    insert = sa.text(
        "INSERT INTO app.place_signals "
        "(id, place_id, signal, occurred_on, actor_hash, created_at) "
        "VALUES (:id, :place_id, :signal, :occurred_on, :actor_hash, :created_at) "
        "ON CONFLICT ON CONSTRAINT uq_place_signals_dedup DO NOTHING"
    )

    total = 0
    for query, signal in sources:
        for place_id, user_id, created_at in conn.execute(sa.text(query)):
            if user_id is None:
                continue
            day = created_at.date()
            conn.execute(
                insert,
                {
                    "id": uuid4(),
                    "place_id": place_id,
                    "signal": signal.value,
                    "occurred_on": day,
                    "actor_hash": actor_hash(
                        f"u:{user_id}", on=day, place_id=place_id, signal=signal
                    ),
                    "created_at": created_at,
                },
            )
            total += 1
    print(f"place_signals: backfilled {total} row(s) from existing timestamps")


def downgrade() -> None:
    op.drop_index("ix_place_signals_place", table_name="place_signals", schema="app")
    op.drop_index("ix_place_signals_window", table_name="place_signals", schema="app")
    op.drop_table("place_signals", schema="app")
