"""Backfill per-meat slaughter columns from live supplier links

Search filters on the stored per-meat columns, while display composes the
method from supplier links. Existing linked places (created before the
fill-on-write logic) have a stale gap column (NOT_SERVED / NOT_DISCLOSED) even
though a live link supplies a real method — so they show e.g. "machine-cut"
but wouldn't match a machine-cut filter. This one-time backfill materialises
the link's method into the gap column so search and display agree.

Only fills a GAP column (NOT_SERVED / NOT_DISCLOSED) from a link whose product
line carries a REAL method (HAND_CUT / MACHINE_CUT) — never overwrites a stated
method, never manufactures NOT_DISCLOSED. Idempotent.

Revision ID: dd4e5f607182
Revises: cc3d4e5f6071
Create Date: 2026-08-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "dd4e5f607182"
down_revision: Union[str, None] = "cc3d4e5f6071"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MEATS = (
    ("CHICKEN", "chicken_slaughter"),
    ("BEEF", "beef_slaughter"),
    ("LAMB", "lamb_slaughter"),
    ("GOAT", "goat_slaughter"),
)


def upgrade() -> None:
    conn = op.get_bind()
    for meat, col in _MEATS:
        conn.execute(
            sa.text(
                f"""
                UPDATE app.halal_profiles hp
                SET {col} = sp.slaughter_method
                FROM app.place_supplier_links psl
                JOIN app.supplier_products sp ON sp.id = psl.supplier_product_id
                JOIN app.suppliers s ON s.id = sp.supplier_id
                WHERE psl.place_id = hp.place_id
                  AND psl.meat_type = :meat
                  AND psl.ended_at IS NULL
                  AND (psl.expires_at IS NULL OR psl.expires_at > now())
                  AND s.revoked_at IS NULL
                  AND sp.slaughter_method IN ('HAND_CUT', 'MACHINE_CUT')
                  AND hp.{col} IN ('NOT_SERVED', 'NOT_DISCLOSED')
                """
            ),
            {"meat": meat},
        )


def downgrade() -> None:
    # Not reversible — we can't distinguish a backfilled value from a genuine
    # one. No-op (leaving the materialised values in place is harmless).
    pass
