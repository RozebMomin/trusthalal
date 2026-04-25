"""claim type and scope constraints

Revision ID: 0dc2385fe882
Revises: 8770ff5403d4
Create Date: 2026-01-08 18:22:06.020751

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0dc2385fe882'
down_revision: Union[str, Sequence[str], None] = '8770ff5403d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    """Upgrade schema."""
    op.add_column(
        "halal_claims",
        sa.Column("scope", sa.String(length=50), nullable=False, server_default=sa.text("'ALL_MENU'")),
        schema="app",
    )


def downgrade():
    """Downgrade schema."""
    op.drop_column("halal_claims", "scope", schema="app")