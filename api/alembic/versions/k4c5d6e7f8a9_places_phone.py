"""app.places.phone — business phone from Google ingest.

Adds a nullable ``phone`` column to ``app.places``. Populated on Google
ingest (and backfilled on resync); NULL for hand-entered places or rows
ingested before phone capture. Powers the consumer "Call" action.

Revision ID: k4c5d6e7f8a9
Revises: j3a4b5c6d7e8
Create Date: 2026-07-12 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "k4c5d6e7f8a9"
down_revision: Union[str, None] = "j3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "places",
        sa.Column("phone", sa.String(length=40), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("places", "phone", schema="app")
