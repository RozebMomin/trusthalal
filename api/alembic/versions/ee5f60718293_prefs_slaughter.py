"""Add per-meat slaughter-method columns to app.consumer_preferences

Four nullable JSONB columns holding an array of the user-selectable slaughter
methods (``["HAND_CUT", "MACHINE_CUT"]``) — a saved version of the per-meat
multi-select in the search filter sheet, so a diner's default "chicken must be
hand-cut" carries across searches. NULL / absent = no preference for that meat.
Additive, forward-only.

Revision ID: ee5f60718293
Revises: dd4e5f607182
Create Date: 2026-08-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ee5f60718293"
down_revision: Union[str, None] = "dd4e5f607182"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    "chicken_slaughter",
    "beef_slaughter",
    "lamb_slaughter",
    "goat_slaughter",
)


def upgrade() -> None:
    for col in _COLUMNS:
        op.add_column(
            "consumer_preferences",
            sa.Column(col, postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            schema="app",
        )


def downgrade() -> None:
    for col in reversed(_COLUMNS):
        op.drop_column("consumer_preferences", col, schema="app")
