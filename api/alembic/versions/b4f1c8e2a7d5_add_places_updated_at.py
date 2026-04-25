"""add places.updated_at

Tracks when a Place row was last modified. We deliberately skip adding a
matching `created_at` column: the CREATED audit event on ``place_events``
already records ingest time with the actor attribution, so `created_at`
would duplicate that information without adding query convenience.

``updated_at`` is bumped by the SQLAlchemy model's ``onupdate=func.now()``
on every UPDATE, which covers admin edits, ingest resyncs, link/unlink
operations, and soft-delete/restore — anything the admin panel can do to
a place. The admin places list uses it as the default sort key so the
most recently-touched rows float to the top.

Revision ID: b4f1c8e2a7d5
Revises: a9d4c7b2e1f3
Create Date: 2026-04-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b4f1c8e2a7d5"
down_revision: Union[str, Sequence[str], None] = "a9d4c7b2e1f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default=now() backfills existing rows at ADD COLUMN time, so
    # the column can land NOT NULL immediately without a two-step migration.
    # Postgres ≥11 applies volatile defaults efficiently — no full-table
    # rewrite, just a catalog update.
    op.add_column(
        "places",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        schema="app",
    )

    # Index on updated_at because the admin places list defaults to
    # ORDER BY updated_at DESC. Without an index, that becomes a full
    # seq-scan + sort as the catalog grows.
    op.create_index(
        "ix_places_updated_at",
        "places",
        ["updated_at"],
        unique=False,
        schema="app",
    )


def downgrade() -> None:
    op.drop_index("ix_places_updated_at", table_name="places", schema="app")
    op.drop_column("places", "updated_at", schema="app")
