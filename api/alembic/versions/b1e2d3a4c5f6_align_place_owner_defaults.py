"""align place_owner defaults with model

Aligns app.place_owners server defaults with the SQLAlchemy model:
- role: OWNER -> PRIMARY
- status: ACTIVE -> PENDING

Also adds a CHECK constraint on status to encode the valid lifecycle
values (PENDING, ACTIVE, VERIFIED, REVOKED). Existing rows keep their
current values; only future inserts without explicit values are affected.

Revision ID: b1e2d3a4c5f6
Revises: cc91cbdccaee
Create Date: 2026-04-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b1e2d3a4c5f6"
down_revision: Union[str, Sequence[str], None] = "cc91cbdccaee"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Align server defaults with the model
    op.alter_column(
        "place_owners",
        "role",
        server_default="PRIMARY",
        schema="app",
    )
    op.alter_column(
        "place_owners",
        "status",
        server_default="PENDING",
        schema="app",
    )

    # Harden status with a check constraint
    op.create_check_constraint(
        "ck_place_owners_status",
        "place_owners",
        "status IN ('PENDING','ACTIVE','VERIFIED','REVOKED')",
        schema="app",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "ck_place_owners_status",
        "place_owners",
        schema="app",
        type_="check",
    )
    op.alter_column(
        "place_owners",
        "status",
        server_default="ACTIVE",
        schema="app",
    )
    op.alter_column(
        "place_owners",
        "role",
        server_default="OWNER",
        schema="app",
    )
