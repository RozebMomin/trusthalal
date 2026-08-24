"""Consumer prefs: red-meat slaughter columns -> zabihah

Rename ``beef/lamb/goat_slaughter`` (JSONB) to ``*_zabihah`` and convert any
saved value: a red-meat preference previously expressed as hand/machine means
"I want zabihah", so a non-null array becomes ``["ZABIHAH"]`` (locked mapping).
Chicken keeps its hand/machine ``chicken_slaughter`` column.

Revision ID: c39304051627
Revises: b28293040516
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c39304051627"
down_revision: Union[str, None] = "b28293040516"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RENAMES = (
    ("beef_slaughter", "beef_zabihah"),
    ("lamb_slaughter", "lamb_zabihah"),
    ("goat_slaughter", "goat_zabihah"),
)


def upgrade() -> None:
    for old, new in RENAMES:
        op.alter_column(
            "consumer_preferences", old, new_column_name=new, schema="app"
        )
        op.execute(
            f"""UPDATE app.consumer_preferences
                SET {new} = '["ZABIHAH"]'::jsonb
                WHERE {new} IS NOT NULL"""
        )


def downgrade() -> None:
    for old, new in RENAMES:
        op.alter_column(
            "consumer_preferences", new, new_column_name=old, schema="app"
        )
