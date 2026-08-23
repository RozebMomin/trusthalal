"""Add NOT_DISCLOSED to the per-meat slaughter CHECK constraints

A protein can be *served but with an unconfirmed method* — e.g. a verifier
sees chicken on the menu and a supplier cert but can't establish hand-cut vs
machine-cut without asking staff. That state had no column value (only
HAND_CUT / MACHINE_CUT / NOT_SERVED), so it wrongly collapsed to NOT_SERVED.
Widen the four per-meat CHECK constraints to allow NOT_DISCLOSED. No data
rewrite — this only broadens the allowed set.

Revision ID: bb2c3d4e5f60
Revises: aa1b2c3d4e5f
Create Date: 2026-08-23
"""
from typing import Sequence, Union

from alembic import op

revision: str = "bb2c3d4e5f60"
down_revision: Union[str, None] = "aa1b2c3d4e5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MEATS = ("chicken", "beef", "lamb", "goat")
_OLD = ("HAND_CUT", "MACHINE_CUT", "NOT_SERVED")
_NEW = ("HAND_CUT", "MACHINE_CUT", "NOT_SERVED", "NOT_DISCLOSED")


def _check(values: tuple[str, ...], col: str) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{col} IN ({quoted})"


def _recreate(allowed: tuple[str, ...]) -> None:
    for meat in _MEATS:
        op.drop_constraint(
            f"ck_halal_profile_{meat}_slaughter",
            "halal_profiles",
            schema="app",
            type_="check",
        )
        op.create_check_constraint(
            f"ck_halal_profile_{meat}_slaughter",
            "halal_profiles",
            _check(allowed, f"{meat}_slaughter"),
            schema="app",
        )


def upgrade() -> None:
    _recreate(_NEW)


def downgrade() -> None:
    # Fold any NOT_DISCLOSED back to NOT_SERVED so the narrower CHECK holds.
    conn = op.get_bind()
    import sqlalchemy as sa

    for meat in _MEATS:
        conn.execute(
            sa.text(
                f"UPDATE app.halal_profiles SET {meat}_slaughter = 'NOT_SERVED' "
                f"WHERE {meat}_slaughter = 'NOT_DISCLOSED'"
            )
        )
    _recreate(_OLD)
