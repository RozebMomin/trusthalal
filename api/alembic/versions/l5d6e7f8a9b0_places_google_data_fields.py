"""app.places — website, Google rating, opening hours from Google ingest.

Adds nullable columns populated from the Google Places (New) payload:

  * ``website_url``                — the listing's website (additive; a
    future owner override should win, so sync only fills when NULL).
  * ``google_rating``             — Google star rating (1.0–5.0).
  * ``google_rating_count``       — number of Google user ratings.
  * ``opening_hours``             — structured weekly schedule (JSONB):
    ``{"periods": [{"open": {...}, "close": {...}}, ...]}``. Powers the
    server-computed "open now" flag + filter.
  * ``opening_hours_weekday_text``— human-readable per-day strings (JSONB
    list) for display, e.g. ["Monday: 9 AM–9 PM", ...].
  * ``google_synced_at``          — when the volatile Google fields
    (rating/hours) were last refreshed, so consumers can see freshness.

All nullable; NULL for hand-entered places or rows ingested before this
capture. rating/hours/synced_at are refreshed (overwritten) on resync;
website is additive.

Revision ID: l5d6e7f8a9b0
Revises: k4c5d6e7f8a9
Create Date: 2026-07-13 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "l5d6e7f8a9b0"
down_revision: Union[str, None] = "k4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "places",
        sa.Column("website_url", sa.Text(), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("google_rating", sa.Numeric(precision=2, scale=1), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("google_rating_count", sa.Integer(), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("opening_hours", JSONB(), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("opening_hours_weekday_text", JSONB(), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column("google_synced_at", sa.DateTime(timezone=True), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("places", "google_synced_at", schema="app")
    op.drop_column("places", "opening_hours_weekday_text", schema="app")
    op.drop_column("places", "opening_hours", schema="app")
    op.drop_column("places", "google_rating_count", schema="app")
    op.drop_column("places", "google_rating", schema="app")
    op.drop_column("places", "website_url", schema="app")
