"""Add de-list columns to app.places

Two nullable columns supporting reason-required, reversible de-listing:

  * ``delist_reason`` (VARCHAR) — a DelistReason value. Its presence on a
    soft-deleted place is the discriminator between a public tombstone
    (de-listed for cause) and a silent junk/duplicate delete (reason NULL).
  * ``delist_note`` (TEXT) — the admin's free-text specifics.

Additive and nullable, so it's a safe forward-only change; existing
soft-deleted rows keep ``delist_reason IS NULL`` and stay silent 404s.

Revision ID: aa1b2c3d4e5f
Revises: z9f0a1b2c3d4
Create Date: 2026-08-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "aa1b2c3d4e5f"
down_revision: Union[str, None] = "z9f0a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "places",
        sa.Column("delist_reason", sa.String(length=40), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("delist_note", sa.Text(), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("places", "delist_note", schema="app")
    op.drop_column("places", "delist_reason", schema="app")
