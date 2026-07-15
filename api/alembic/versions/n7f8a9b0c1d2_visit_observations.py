"""app.verification_visits.observations — structured on-the-spot signals.

Adds a nullable JSONB column holding the verifier's quick observations
from the mobile observe step:
    {"ordered_items": ["Chicken boti", ...],
     "checks": {"Halal cert visible on premises": "YES", ...}}
Kept separate from ``structured_findings`` (the heavy questionnaire).

Revision ID: n7f8a9b0c1d2
Revises: m6e7f8a9b0c1
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "n7f8a9b0c1d2"
down_revision: Union[str, None] = "m6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "verification_visits",
        sa.Column("observations", JSONB(), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("verification_visits", "observations", schema="app")
