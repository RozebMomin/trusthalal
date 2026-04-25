"""add canonical address fields to places + raw_data to place_external_ids

Revision ID: a9d4c7b2e1f3
Revises: e4a1d5b9c2f7
Create Date: 2026-04-24

Purpose
-------
Formalize the "what city/state/country is this place in?" question as first-class
columns on ``places`` so admin list sort/filter and SEO city pages are a simple
indexed query rather than string-parsing ``address``.

Also carves out a place on ``place_external_ids`` to park the raw provider
payload (e.g. a full Google Place Details response) so we don't re-hit the
provider every time we want to know something about the place.

Design notes
------------
* Canonical fields are all NULLABLE — places can be hand-entered without an
  external source, and historical rows won't have this data yet.
* ``canonical_source`` points to the provider whose data is authoritative for
  these fields. NULL = hand-entered / no sync source. Followable enum pattern
  via CHECK constraint (same as ``ck_place_external_ids_provider_allowed``) so
  adding a new provider is an Alembic CHECK edit, not an ALTER TYPE migration.
* ``country_code`` is ISO-3166-1 alpha-2, two uppercase letters.
* Modest btree indexes on ``city`` and ``country_code`` — admin lists will sort
  and filter on these. No trigram index yet; revisit when the catalog grows.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "a9d4c7b2e1f3"
down_revision: Union[str, Sequence[str], None] = "e4a1d5b9c2f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Canonical address fields on places -------------------------------
    op.add_column(
        "places",
        sa.Column("city", sa.String(length=120), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("region", sa.String(length=120), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("country_code", sa.String(length=2), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("timezone", sa.String(length=64), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("canonical_source", sa.String(length=50), nullable=True),
        schema="app",
    )

    # ISO-3166-1 alpha-2: two uppercase letters, or NULL for legacy rows.
    op.create_check_constraint(
        "ck_places_country_code_iso2",
        "places",
        "country_code IS NULL OR country_code ~ '^[A-Z]{2}$'",
        schema="app",
    )

    # Mirrors the provider allowlist on place_external_ids.
    op.create_check_constraint(
        "ck_places_canonical_source_allowed",
        "places",
        "canonical_source IS NULL OR canonical_source IN ('GOOGLE','YELP','APPLE')",
        schema="app",
    )

    op.create_index(
        "ix_places_city",
        "places",
        ["city"],
        unique=False,
        schema="app",
    )
    op.create_index(
        "ix_places_country_code",
        "places",
        ["country_code"],
        unique=False,
        schema="app",
    )

    # --- Provider payload on place_external_ids ---------------------------
    op.add_column(
        "place_external_ids",
        sa.Column("raw_data", JSONB(), nullable=True),
        schema="app",
    )
    op.add_column(
        "place_external_ids",
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("place_external_ids", "last_synced_at", schema="app")
    op.drop_column("place_external_ids", "raw_data", schema="app")

    op.drop_index("ix_places_country_code", table_name="places", schema="app")
    op.drop_index("ix_places_city", table_name="places", schema="app")

    op.drop_constraint(
        "ck_places_canonical_source_allowed", "places", schema="app", type_="check"
    )
    op.drop_constraint(
        "ck_places_country_code_iso2", "places", schema="app", type_="check"
    )

    op.drop_column("places", "canonical_source", schema="app")
    op.drop_column("places", "timezone", schema="app")
    op.drop_column("places", "postal_code", schema="app")
    op.drop_column("places", "country_code", schema="app")
    op.drop_column("places", "region", schema="app")
    op.drop_column("places", "city", schema="app")
