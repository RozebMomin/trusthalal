"""Halal profile red-meat zabihah columns + backfill

Beef/lamb/goat move off the hand/machine axis onto the zabihah attribution axis.
Adds ``beef_zabihah`` / ``lamb_zabihah`` / ``goat_zabihah`` and backfills them
from the retained ``*_slaughter`` columns (locked decision):

    HAND_CUT / MACHINE_CUT  -> ZABIHAH   (any prior positive method)
    NOT_SERVED              -> NOT_SERVED
    NOT_DISCLOSED           -> UNSURE

The old ``beef/lamb/goat_slaughter`` columns are left in place (unread) so the
switch is non-destructive; a later cleanup migration can drop them. Chicken is
untouched (keeps hand/machine).

Revision ID: b28293040516
Revises: a17182930405
Create Date: 2026-08-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b28293040516"
down_revision: Union[str, None] = "a17182930405"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ZABIHAH_STATUS = ("ZABIHAH", "NOT_ZABIHAH", "UNSURE", "NOT_SERVED")
COLUMNS = (("beef_zabihah", "beef_slaughter"),
           ("lamb_zabihah", "lamb_slaughter"),
           ("goat_zabihah", "goat_slaughter"))


def upgrade() -> None:
    check = "{col} IN (" + ", ".join(f"'{v}'" for v in ZABIHAH_STATUS) + ")"
    for zcol, _ in COLUMNS:
        op.add_column(
            "halal_profiles",
            sa.Column(zcol, sa.String(length=30), nullable=False, server_default="NOT_SERVED"),
            schema="app",
        )
        op.create_check_constraint(
            f"ck_halal_profiles_{zcol}", "halal_profiles", check.format(col=zcol), schema="app"
        )

    # Backfill from the retained slaughter columns.
    for zcol, scol in COLUMNS:
        op.execute(
            f"""
            UPDATE app.halal_profiles
            SET {zcol} = CASE
                WHEN {scol} IN ('HAND_CUT', 'MACHINE_CUT') THEN 'ZABIHAH'
                WHEN {scol} = 'NOT_SERVED' THEN 'NOT_SERVED'
                ELSE 'UNSURE'
            END
            """
        )


def downgrade() -> None:
    for zcol, _ in COLUMNS:
        op.drop_constraint(f"ck_halal_profiles_{zcol}", "halal_profiles", schema="app", type_="check")
        op.drop_column("halal_profiles", zcol, schema="app")
