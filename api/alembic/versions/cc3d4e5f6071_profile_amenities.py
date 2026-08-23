"""Add family/cleanliness amenity columns to app.halal_profiles

Four nullable VARCHAR columns holding an AmenityStatus (YES / ON_REQUEST / NO /
UNSURE) rolled up from a verifier visit's observations, so amenities become
queryable for the family-priority search boost and renderable as badges. NULL =
never assessed. Additive, forward-only.

Revision ID: cc3d4e5f6071
Revises: bb2c3d4e5f60
Create Date: 2026-08-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "cc3d4e5f6071"
down_revision: Union[str, None] = "bb2c3d4e5f60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ("prayer_space", "wudu", "bidet", "baby_changing")


def upgrade() -> None:
    for col in _COLUMNS:
        op.add_column(
            "halal_profiles",
            sa.Column(col, sa.String(length=20), nullable=True),
            schema="app",
        )


def downgrade() -> None:
    for col in reversed(_COLUMNS):
        op.drop_column("halal_profiles", col, schema="app")
