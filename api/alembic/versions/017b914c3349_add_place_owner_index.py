"""add place owner index

Revision ID: 017b914c3349
Revises: d1f9a9091e2f
Create Date: 2026-01-20 19:10:10.636550

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '017b914c3349'
down_revision: Union[str, Sequence[str], None] = 'd1f9a9091e2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
    CREATE UNIQUE INDEX uq_place_owners_one_active_owner
    ON app.place_owners (place_id)
    WHERE status IN ('PENDING','ACTIVE','VERIFIED');
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS app.uq_place_owners_one_active_owner;")
