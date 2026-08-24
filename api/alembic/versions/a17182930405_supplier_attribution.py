"""Supplier product attribution: zabihah_status + certifier_id

Red meat (beef/lamb/goat) moves off the hand/machine axis onto an attribution
axis: the restaurant/supplier declares zabihah status and names a certifying
body, which resolves to the canonical certifier registry. Poultry lines keep
``slaughter_method``.

Data steps:
  1. Resolve existing free-text ``certifying_body_name`` on supplier_products to
     ``certifier_id`` via the alias table (exact, case-insensitive). Non-matches
     stay NULL for admin to reconcile.
  2. Backfill ``zabihah_status`` on existing red-meat lines: any prior positive
     method (HAND_CUT / MACHINE_CUT) → ZABIHAH; NOT_DISCLOSED → UNSURE. (Locked
     decision — see SLAUGHTER_PROVENANCE_PLAN.md.)

Revision ID: a17182930405
Revises: ff60718293a4
Create Date: 2026-08-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "a17182930405"
down_revision: Union[str, None] = "ff60718293a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ZABIHAH_STATUS = ("ZABIHAH", "NOT_ZABIHAH", "UNSURE", "NOT_SERVED")
RED_MEAT = ("BEEF", "LAMB", "GOAT")


def upgrade() -> None:
    op.add_column(
        "supplier_products",
        sa.Column("zabihah_status", sa.String(length=30), nullable=True),
        schema="app",
    )
    op.add_column(
        "supplier_products",
        sa.Column("certifier_id", PG_UUID(as_uuid=True), nullable=True),
        schema="app",
    )
    op.create_check_constraint(
        "ck_supplier_products_zabihah_status",
        "supplier_products",
        "zabihah_status IS NULL OR zabihah_status IN ("
        + ", ".join(f"'{v}'" for v in ZABIHAH_STATUS)
        + ")",
        schema="app",
    )
    op.create_foreign_key(
        "fk_supplier_products_certifier_id",
        "supplier_products",
        "certifiers",
        ["certifier_id"],
        ["id"],
        source_schema="app",
        referent_schema="app",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_supplier_products_certifier_id",
        "supplier_products",
        ["certifier_id"],
        schema="app",
    )

    # 1. Resolve free-text certifying_body_name -> certifier_id via aliases.
    op.execute(
        """
        UPDATE app.supplier_products sp
        SET certifier_id = ca.certifier_id
        FROM app.certifier_aliases ca
        WHERE sp.certifier_id IS NULL
          AND sp.certifying_body_name IS NOT NULL
          AND lower(btrim(sp.certifying_body_name)) = lower(ca.alias)
        """
    )

    # 2. Backfill red-meat zabihah_status from the old slaughter_method.
    red = ", ".join(f"'{m}'" for m in RED_MEAT)
    op.execute(
        f"""
        UPDATE app.supplier_products
        SET zabihah_status = CASE
            WHEN slaughter_method IN ('HAND_CUT', 'MACHINE_CUT') THEN 'ZABIHAH'
            ELSE 'UNSURE'
        END
        WHERE meat_type IN ({red})
          AND zabihah_status IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_supplier_products_certifier_id", table_name="supplier_products", schema="app")
    op.drop_constraint("fk_supplier_products_certifier_id", "supplier_products", schema="app", type_="foreignkey")
    op.drop_constraint("ck_supplier_products_zabihah_status", "supplier_products", schema="app", type_="check")
    op.drop_column("supplier_products", "certifier_id", schema="app")
    op.drop_column("supplier_products", "zabihah_status", schema="app")
