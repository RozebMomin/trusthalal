"""places soft delete fields

Revision ID: 089318ec9422
Revises: 2ba16d66b41e
Create Date: 2026-01-27 20:49:42.743028

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '089318ec9422'
down_revision: Union[str, Sequence[str], None] = '2ba16d66b41e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add soft-delete fields to places
    op.add_column(
        "places",
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema="app",
    )

    op.add_column(
        "places",
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="app",
    )

    op.add_column(
        "places",
        sa.Column(
            "deleted_by_user_id",
            sa.UUID(),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema="app",
    )


def downgrade() -> None:
    # Remove soft-delete fields from places
    op.drop_column("places", "deleted_by_user_id", schema="app")

    op.drop_column("places", "deleted_at", schema="app")
    op.drop_column("places", "is_deleted", schema="app")