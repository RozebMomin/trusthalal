"""ownership_requests: drop unused contact_phone column

The ``contact_phone`` column was carried by the model + schemas + a
hidden field on the admin "create on behalf of someone" intake
form, but it was never asked for in the owner portal claim flow or
the public claim form. Reviewing the column showed almost no rows
ever populated it — only the rare admin phone-in intake. The polish
pass leans the other way: drop the field everywhere so we don't
display empty "Contact phone: —" lines on the admin detail dialog
and so the wire shape stays minimal.

If/when phone collection becomes useful again, re-adding a
nullable column is a one-migration change. Storing nothing is
preferable to storing a half-populated stub field.

Revision ID: h6f7a8b9c0d1
Revises: h5e6f7a8b9c0
Create Date: 2026-05-06 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "h6f7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "h5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column(
        "place_ownership_requests", "contact_phone", schema="app"
    )


def downgrade() -> None:
    # Restore the same shape the model carried before this drop:
    # nullable VARCHAR(50). Any previously-recorded values are gone
    # — downgrading lands the column with NULL across the board.
    op.add_column(
        "place_ownership_requests",
        sa.Column("contact_phone", sa.String(50), nullable=True),
        schema="app",
    )
