"""app.notification_unsubscribes — per-user, per-category email opt-outs.

Notifications default ON; a row here means the user opted OUT of that
category (transactional categories ignore this table). Composite PK
(user_id, category) makes the opt-out idempotent.

Revision ID: m6e7f8a9b0c1
Revises: l5d6e7f8a9b0
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "m6e7f8a9b0c1"
down_revision: Union[str, None] = "l5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_unsubscribes",
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["app.users.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "category"),
        schema="app",
    )


def downgrade() -> None:
    op.drop_table("notification_unsubscribes", schema="app")
