"""Storage orphans: a to-do list for bucket objects whose row is gone

A photo lives as a row AND as bytes in a bucket. Those can't be removed
atomically, and today the bytes always lose:

  * soft-deleted photos keep their object forever (deliberate — restore is a
    one-column update — but nothing ever collects them),
  * and ``place_photos.review_id`` is ON DELETE CASCADE, so deleting a review
    takes its photo rows at the database level with no application code in
    the loop. Once the row is gone the storage path is gone with it, so
    nothing can even discover what to clean up.

The second case isn't a failure path. It's what happens whenever a diner
withdraws a review that had photos.

This table is the outbox that makes deferred deletion possible: the intent to
delete is recorded transactionally with the row's removal, and a data-ops job
drains it with retries. No foreign key, on purpose — the whole point is that
a row here outlives the thing it came from.

Revision ID: s2e3f4a5b6c7
Revises: r1d2e3f4a5b6
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "s2e3f4a5b6c7"
down_revision: Union[str, None] = "r1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "storage_orphans",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, nullable=False),
        # Stored rather than assumed: there are two buckets (public photos,
        # private evidence) and a future third shouldn't silently delete from
        # the wrong one.
        sa.Column("bucket", sa.String(128), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("reason", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("purge_error", sa.Text(), nullable=True),
        schema="app",
    )
    # The drain query: unpurged, oldest first.
    op.create_index(
        "ix_storage_orphans_pending",
        "storage_orphans",
        ["purged_at", "created_at"],
        schema="app",
    )


def downgrade() -> None:
    op.drop_table("storage_orphans", schema="app")
