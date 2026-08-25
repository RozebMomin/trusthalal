"""Re-add the amenity columns to app.halal_profiles (expand/contract fix)

The move migration (d1e2f3a40516) originally DROPPED the four amenity columns
from app.halal_profiles in the same release that stopped reading them. On a
rolling deploy that breaks any still-running old-code instance, which selects
the whole HalalProfile entity — including the now-missing columns — and 500s.

This restores the columns as nullable dead columns so old and new code coexist,
and backfills them from the place (the new source of truth) so old code still
renders correct amenity badges during the rollout. Idempotent: uses
``ADD COLUMN IF NOT EXISTS`` so it's a no-op on environments where the (now
fixed) move migration never dropped them.

A later cleanup migration can drop these for good once every instance is on the
new code.

Revision ID: e2f3a4061728
Revises: d1e2f3a40516
Create Date: 2026-08-25
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e2f3a4061728"
down_revision: Union[str, None] = "d1e2f3a40516"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ("prayer_space", "wudu", "bidet", "baby_changing")


def upgrade() -> None:
    for col in _COLUMNS:
        op.execute(
            f"ALTER TABLE app.halal_profiles "
            f"ADD COLUMN IF NOT EXISTS {col} VARCHAR(20)"
        )
    # Backfill from the place so old code sees current values.
    set_clause = ", ".join(f"{c} = p.{c}" for c in _COLUMNS)
    op.execute(
        f"""
        UPDATE app.halal_profiles AS hp
        SET {set_clause}
        FROM app.places AS p
        WHERE p.id = hp.place_id
        """
    )


def downgrade() -> None:
    # Leave the columns; dropping them is what caused the incident. A dedicated
    # cleanup migration owns the eventual drop.
    pass
