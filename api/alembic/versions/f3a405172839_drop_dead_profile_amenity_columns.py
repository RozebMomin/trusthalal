"""Drop the now-dead amenity columns from app.halal_profiles (contract step)

Final step of the expand/contract move of family amenities from the halal
profile to the place. By the time this runs, every instance is on code that
reads/writes amenities on ``app.places`` and never touches these columns, so
they can be dropped safely.

Uses ``DROP COLUMN IF EXISTS`` so it's a no-op on any environment where they
were already gone. Downgrade re-adds them (nullable) and backfills from the
place, mirroring e2f3a4061728, so the move stays reversible.

Revision ID: f3a405172839
Revises: e2f3a4061728
Create Date: 2026-08-25
"""
from typing import Sequence, Union

from alembic import op

revision: str = "f3a405172839"
down_revision: Union[str, None] = "e2f3a4061728"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ("prayer_space", "wudu", "bidet", "baby_changing")


def upgrade() -> None:
    for col in _COLUMNS:
        op.execute(f"ALTER TABLE app.halal_profiles DROP COLUMN IF EXISTS {col}")


def downgrade() -> None:
    for col in _COLUMNS:
        op.execute(
            f"ALTER TABLE app.halal_profiles "
            f"ADD COLUMN IF NOT EXISTS {col} VARCHAR(20)"
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
