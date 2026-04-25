"""add disputed status

Revision ID: 9a7e3ad2467a
Revises: 5a696e2dd245
Create Date: 2026-01-19 16:27:30.579826

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9a7e3ad2467a'
down_revision: Union[str, Sequence[str], None] = '5a696e2dd245'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint("ck_halal_claims_status", "halal_claims", schema="app", type_="check")
    op.create_check_constraint(
        "ck_halal_claims_status",
        "halal_claims",
        "status IN ('PENDING','VERIFIED','REJECTED','EXPIRED','DISPUTED')",
        schema="app",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_halal_claims_status", "halal_claims", schema="app", type_="check")
    op.create_check_constraint(
        "ck_halal_claims_status",
        "halal_claims",
        "status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')",
        schema="app",
    )
