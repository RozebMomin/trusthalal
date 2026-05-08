"""places: add cuisine_types ARRAY column

Adds ``cuisine_types TEXT[]`` to ``app.places`` so the consumer
search surface can filter restaurants by cuisine (Pakistani,
Lebanese, etc.) without an extra join. Owners pick from the curated
``Cuisine`` enum on the halal-claim editor; the Google Places New
ingest auto-populates from ``primaryType`` for places the owner
hasn't tagged yet (handled in a follow-up migration / code change —
this migration just adds the column with an empty default).

Stored as ``TEXT[]`` rather than a Postgres ENUM type so adding a
new ``Cuisine`` variant is a code-only change. Validation lives in
Pydantic on the way in/out. A GIN index on the column makes the
overlap (``&&``) operator fast — the consumer filter is
``cuisine_types && ARRAY[?, ?]`` ("any of these cuisines"), which is
exactly what GIN is for.

Backfill: existing rows get ``ARRAY[]::text[]`` via the column
default. The follow-up Google Places New migration will resync
existing places and populate cuisine_types from primaryType where
possible.

Revision ID: h8b9c0d1e2f3
Revises: h7a8b9c0d1e2
Create Date: 2026-05-07 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "h8b9c0d1e2f3"
down_revision: Union[str, None] = "h7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "places",
        sa.Column(
            "cuisine_types",
            sa.dialects.postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("ARRAY[]::text[]"),
        ),
        schema="app",
    )

    # GIN index for array overlap (``&&``) queries — the consumer
    # filter "match any of these cuisines" hits this. Index name
    # follows the existing naming convention (ix_<table>_<col>).
    op.create_index(
        "ix_places_cuisine_types",
        "places",
        ["cuisine_types"],
        unique=False,
        schema="app",
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_places_cuisine_types",
        table_name="places",
        schema="app",
        postgresql_using="gin",
    )
    op.drop_column("places", "cuisine_types", schema="app")
