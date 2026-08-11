"""Sourcing links: place_supplier_links

The restaurant → product-line edge, each with its own evidence tier. A live
link is one with ``ended_at IS NULL``; a partial unique index enforces one
live link per (place, product line). Additive; nothing reads it yet.

Revision ID: y8e9f0a1b2c3
Revises: x7d8e9f0a1b2
Create Date: 2026-08-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "y8e9f0a1b2c3"
down_revision: Union[str, None] = "x7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Mirror app/modules/suppliers/enums.py (+ MeatType).
SOURCING_EVIDENCE = ("OWNER_STATED", "DOCUMENTED", "VERIFIER_CONFIRMED")
LINK_SOURCE = ("OWNER_CLAIM", "VERIFIER_VISIT", "ADMIN")
MEAT_TYPE = ("CHICKEN", "BEEF", "LAMB", "GOAT", "TURKEY", "DUCK", "FISH", "OTHER")


def _check(values: tuple[str, ...], col: str) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{col} IN ({quoted})"


def upgrade() -> None:
    op.create_table(
        "place_supplier_links",
        sa.Column(
            "id",
            PG_UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "place_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "supplier_product_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.supplier_products.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("meat_type", sa.String(length=50), nullable=False),
        sa.Column(
            "evidence_tier",
            sa.String(length=50),
            nullable=False,
            server_default="OWNER_STATED",
        ),
        sa.Column(
            "source", sa.String(length=50), nullable=False, server_default="OWNER_CLAIM"
        ),
        sa.Column(
            "source_claim_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.halal_claims.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "source_visit_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.verification_visits.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "last_confirmed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(_check(MEAT_TYPE, "meat_type"), name="ck_place_supplier_links_meat_type"),
        sa.CheckConstraint(
            _check(SOURCING_EVIDENCE, "evidence_tier"),
            name="ck_place_supplier_links_evidence_tier",
        ),
        sa.CheckConstraint(
            _check(LINK_SOURCE, "source"), name="ck_place_supplier_links_source"
        ),
        schema="app",
    )
    op.create_index(
        "ix_place_supplier_links_place", "place_supplier_links", ["place_id"], schema="app"
    )
    op.create_index(
        "ix_place_supplier_links_product",
        "place_supplier_links",
        ["supplier_product_id"],
        schema="app",
    )
    # Fast per-meat filtering on live links.
    op.create_index(
        "ix_place_supplier_links_place_meat",
        "place_supplier_links",
        ["place_id", "meat_type"],
        schema="app",
    )
    # One live link per (place, product line).
    op.create_index(
        "uq_place_supplier_link_live",
        "place_supplier_links",
        ["place_id", "supplier_product_id"],
        unique=True,
        schema="app",
        postgresql_where=sa.text("ended_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_table("place_supplier_links", schema="app")
