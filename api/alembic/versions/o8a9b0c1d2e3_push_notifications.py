"""Push notifications: device_tokens + per-channel notification opt-outs.

Two changes:

  1. ``app.device_tokens`` — Expo push tokens, unique on the token itself so
     re-registering the same device is an upsert rather than a duplicate.

  2. ``app.notification_unsubscribes`` gains a ``channel`` column and folds it
     into the primary key. Existing rows are backfilled to 'EMAIL' (the only
     channel that existed when they were written), so nobody who opted out of
     an email silently starts getting pushed instead.

Revision ID: o8a9b0c1d2e3
Revises: n7f8a9b0c1d2
Create Date: 2026-07-18 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "o8a9b0c1d2e3"
down_revision: Union[str, None] = "n7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- 1. Push device registrations -------------------------------------
    op.create_table(
        "device_tokens",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("platform", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["app.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_device_tokens_token"),
        schema="app",
    )
    op.create_index(
        "ix_device_tokens_user_id",
        "device_tokens",
        ["user_id"],
        schema="app",
    )

    # --- 2. Per-channel opt-outs ------------------------------------------
    # server_default backfills every existing row to EMAIL in place.
    op.add_column(
        "notification_unsubscribes",
        sa.Column(
            "channel",
            sa.String(length=16),
            nullable=False,
            server_default="EMAIL",
        ),
        schema="app",
    )
    op.drop_constraint(
        "notification_unsubscribes_pkey",
        "notification_unsubscribes",
        schema="app",
        type_="primary",
    )
    op.create_primary_key(
        "notification_unsubscribes_pkey",
        "notification_unsubscribes",
        ["user_id", "category", "channel"],
        schema="app",
    )


def downgrade() -> None:
    # Collapse back to one row per (user, category): drop PUSH-only opt-outs
    # first so the narrower primary key can't collide.
    op.execute("DELETE FROM app.notification_unsubscribes WHERE channel <> 'EMAIL'")
    op.drop_constraint(
        "notification_unsubscribes_pkey",
        "notification_unsubscribes",
        schema="app",
        type_="primary",
    )
    op.create_primary_key(
        "notification_unsubscribes_pkey",
        "notification_unsubscribes",
        ["user_id", "category"],
        schema="app",
    )
    op.drop_column("notification_unsubscribes", "channel", schema="app")

    op.drop_index("ix_device_tokens_user_id", table_name="device_tokens", schema="app")
    op.drop_table("device_tokens", schema="app")
