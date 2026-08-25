"""Move family amenity columns from app.halal_profiles to app.places

Amenities (prayer space, wudu, bidet, baby changing) are a PLACE attribute, not
a halal-verification signal — owners can declare them directly, no claim/visit
needed. So the four columns move off the halal profile (which only exists once a
place has an approved claim / verifier visit) onto the place itself.

Adds the columns to app.places, backfills each place from its existing profile,
then drops them from app.halal_profiles. Forward-only data move.

Revision ID: d1e2f3a40516
Revises: c39304051627
Create Date: 2026-08-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d1e2f3a40516"
down_revision: Union[str, None] = "c39304051627"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ("prayer_space", "wudu", "bidet", "baby_changing")


def upgrade() -> None:
    for col in _COLUMNS:
        op.add_column(
            "places",
            sa.Column(col, sa.String(length=20), nullable=True),
            schema="app",
        )

    # Backfill each place from its (single, non-revoked or latest) profile.
    # A place has at most one live profile; copy its amenity values over.
    set_clause = ", ".join(f"{c} = hp.{c}" for c in _COLUMNS)
    op.execute(
        f"""
        UPDATE app.places AS p
        SET {set_clause}
        FROM app.halal_profiles AS hp
        WHERE hp.place_id = p.id
        """
    )

    for col in reversed(_COLUMNS):
        op.drop_column("halal_profiles", col, schema="app")


def downgrade() -> None:
    for col in _COLUMNS:
        op.add_column(
            "halal_profiles",
            sa.Column(col, sa.String(length=20), nullable=True),
            schema="app",
        )
    set_clause = ", ".join(f"{c} = p.{c}" for c in _COLUMNS)
    op.execute(
        f"""
        UPDATE app.halal_profiles AS hp
        SET {set_clause}
        FROM app.places AS p
        WHERE p.id = hp.place_id
        """
    )
    for col in reversed(_COLUMNS):
        op.drop_column("places", col, schema="app")
