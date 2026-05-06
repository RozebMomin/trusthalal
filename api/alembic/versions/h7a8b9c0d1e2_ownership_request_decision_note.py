"""ownership_requests: add decision_note for admin guidance

Adds a single nullable ``decision_note`` column to
``app.place_ownership_requests``. The admin "request more evidence"
flow now writes the note here so the owner portal can render
"Trust Halal staff requested: <note>" on the claim detail. Without
this column the note only landed on a PlaceEvent row, which the
owner-facing surface didn't read from.

Mirrors the same column on ``organizations.decision_note`` —
single-source-of-truth for "what did admin say last about this
row?". When admin re-requests evidence, the column overwrites with
the latest instruction; the per-event audit trail still lives on
``place_events`` for historical context.

Revision ID: h7a8b9c0d1e2
Revises: h6f7a8b9c0d1
Create Date: 2026-05-06 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "h7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = "h6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "place_ownership_requests",
        sa.Column("decision_note", sa.Text(), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column(
        "place_ownership_requests", "decision_note", schema="app"
    )
