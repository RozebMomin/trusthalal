"""add places geography gist index

Revision ID: 5a696e2dd245
Revises: 2152acab1afd
Create Date: 2026-01-08 20:44:00.433341

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5a696e2dd245'
down_revision: Union[str, Sequence[str], None] = '2152acab1afd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_places_geog "
        "ON app.places USING GIST ((geom::geography));"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS app.idx_places_geog;")
