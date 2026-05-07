"""organizations: add address fields for cross-state disambiguation

Adds five nullable address columns to ``app.organizations`` so admin
staff can tell same-name entities apart (very common with chains
operating across multiple states under separate LLCs). All optional
to preserve backwards compat — existing rows backfill to NULL and
the admin UI shows "no address on file" until owners add one.

Columns added:
  * ``address``       — street line(s), VARCHAR(500)
  * ``city``          — VARCHAR(120)
  * ``region``        — state / province / equivalent. VARCHAR(120),
                        kept as free text rather than a code so we
                        don't lock to USPS abbreviations.
  * ``country_code``  — ISO-3166-1 alpha-2, CHAR(2). Same shape we
                        use on ``places.country_code``.
  * ``postal_code``   — VARCHAR(20). Wide enough for international
                        postcodes; not validated server-side.

No index — the search posture is "look up an org by id from a
trusted user-facing flow," not "search-by-address." If/when admin
demand for address-search shows up, layer pg_trgm indexes the same
way ``places`` did.

Revision ID: h5e6f7a8b9c0
Revises: h4d5e6f7a8b9
Create Date: 2026-05-06 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "h5e6f7a8b9c0"
down_revision: Union[str, Sequence[str], None] = "h4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("address", sa.String(500), nullable=True),
        schema="app",
    )
    op.add_column(
        "organizations",
        sa.Column("city", sa.String(120), nullable=True),
        schema="app",
    )
    op.add_column(
        "organizations",
        sa.Column("region", sa.String(120), nullable=True),
        schema="app",
    )
    op.add_column(
        "organizations",
        sa.Column("country_code", sa.CHAR(2), nullable=True),
        schema="app",
    )
    op.add_column(
        "organizations",
        sa.Column("postal_code", sa.String(20), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("organizations", "postal_code", schema="app")
    op.drop_column("organizations", "country_code", schema="app")
    op.drop_column("organizations", "region", schema="app")
    op.drop_column("organizations", "city", schema="app")
    op.drop_column("organizations", "address", schema="app")
