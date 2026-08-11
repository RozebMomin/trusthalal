"""Supplier registry: suppliers, supplier_products, attachments, events

Slaughter method becomes a *supplier* fact captured per product line
(see docs/2026-08-11-supplier-provenance-plan.md). Purely additive — no
existing table is touched, nothing reads these yet. The consumer-facing
composition + display land in later, test-gated changes.

Enum columns follow the house idiom: VARCHAR(50) + a CHECK constraint, with
the value tuples duplicated here and kept in lock-step with
app/modules/suppliers/enums.py. Adding a value is code-only unless the CHECK
needs widening.

Revision ID: x7d8e9f0a1b2
Revises: w6c7d8e9f0a1
Create Date: 2026-08-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PG_UUID

revision: str = "x7d8e9f0a1b2"
down_revision: Union[str, None] = "w6c7d8e9f0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Enum value tuples — mirror app/modules/suppliers/enums.py (+ MeatType).
SUPPLIER_TIER = ("LISTED", "CERTIFICATE_ON_FILE", "TRUST_HALAL_VERIFIED")
SLAUGHTER_METHOD = ("HAND_CUT", "MACHINE_CUT", "NOT_DISCLOSED")
STUNNING = ("STUNNED", "NON_STUNNED", "NOT_DISCLOSED")
MEAT_TYPE = ("CHICKEN", "BEEF", "LAMB", "GOAT", "TURKEY", "DUCK", "FISH", "OTHER")
SUPPLIER_ATTACHMENT_TYPE = (
    "HALAL_CERTIFICATE",
    "AUDIT_REPORT",
    "SUPPLIER_LETTER",
    "INVOICE",
    "PHOTO",
    "OTHER",
)
SUPPLIER_EVENT_TYPE = (
    "LISTED",
    "VERIFIED",
    "CERT_UPDATED",
    "LINE_ADDED",
    "REVOKED",
    "CORRECTED",
)


def _check(values: tuple[str, ...], col: str) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{col} IN ({quoted})"


def upgrade() -> None:
    # ---- suppliers --------------------------------------------------------
    op.create_table(
        "suppliers",
        sa.Column(
            "id",
            PG_UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column(
            "aliases",
            ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("ARRAY[]::text[]"),
        ),
        sa.Column("website_url", sa.Text(), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("region", sa.String(length=120), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column(
            "verification_tier",
            sa.String(length=50),
            nullable=False,
            server_default="LISTED",
        ),
        sa.Column("certifying_body_name", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "last_verified_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.UniqueConstraint("slug", name="uq_suppliers_slug"),
        sa.CheckConstraint(
            _check(SUPPLIER_TIER, "verification_tier"),
            name="ck_suppliers_verification_tier",
        ),
        schema="app",
    )
    op.create_index("ix_suppliers_name", "suppliers", ["name"], schema="app")
    op.create_index("ix_suppliers_revoked_at", "suppliers", ["revoked_at"], schema="app")

    # ---- supplier_products (the method lives here) ------------------------
    op.create_table(
        "supplier_products",
        sa.Column(
            "id",
            PG_UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "supplier_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.suppliers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("meat_type", sa.String(length=50), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column(
            "slaughter_method",
            sa.String(length=50),
            nullable=False,
            server_default="NOT_DISCLOSED",
        ),
        sa.Column(
            "line_tier", sa.String(length=50), nullable=False, server_default="LISTED"
        ),
        sa.Column("stunning", sa.String(length=50), nullable=True),
        sa.Column("certifying_body_name", sa.String(length=255), nullable=True),
        sa.Column("certificate_number", sa.String(length=255), nullable=True),
        sa.Column("certificate_url", sa.Text(), nullable=True),
        sa.Column("certificate_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "last_verified_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("evidence_expires_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint(_check(MEAT_TYPE, "meat_type"), name="ck_supplier_products_meat_type"),
        sa.CheckConstraint(
            _check(SLAUGHTER_METHOD, "slaughter_method"),
            name="ck_supplier_products_slaughter_method",
        ),
        sa.CheckConstraint(
            _check(SUPPLIER_TIER, "line_tier"), name="ck_supplier_products_line_tier"
        ),
        sa.CheckConstraint(
            f"stunning IS NULL OR {_check(STUNNING, 'stunning')}",
            name="ck_supplier_products_stunning",
        ),
        schema="app",
    )
    op.create_index(
        "ix_supplier_products_supplier", "supplier_products", ["supplier_id"], schema="app"
    )
    op.create_index(
        "ix_supplier_products_supplier_meat",
        "supplier_products",
        ["supplier_id", "meat_type"],
        schema="app",
    )

    # ---- supplier_attachments --------------------------------------------
    op.create_table(
        "supplier_attachments",
        sa.Column(
            "id",
            PG_UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "supplier_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.suppliers.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "supplier_product_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.supplier_products.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("document_type", sa.String(length=50), nullable=False),
        sa.Column("issuing_authority", sa.String(length=255), nullable=True),
        sa.Column("certificate_number", sa.String(length=255), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("original_filename", sa.String(length=512), nullable=True),
        sa.Column("content_type", sa.String(length=128), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("storage_path", name="uq_supplier_attachments_storage_path"),
        sa.CheckConstraint(
            _check(SUPPLIER_ATTACHMENT_TYPE, "document_type"),
            name="ck_supplier_attachments_document_type",
        ),
        schema="app",
    )
    op.create_index(
        "ix_supplier_attachments_supplier",
        "supplier_attachments",
        ["supplier_id"],
        schema="app",
    )
    op.create_index(
        "ix_supplier_attachments_product",
        "supplier_attachments",
        ["supplier_product_id"],
        schema="app",
    )

    # ---- supplier_events (append-only audit) ------------------------------
    op.create_table(
        "supplier_events",
        sa.Column(
            "id",
            PG_UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "supplier_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.suppliers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column(
            "actor_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            _check(SUPPLIER_EVENT_TYPE, "event_type"),
            name="ck_supplier_events_event_type",
        ),
        schema="app",
    )
    op.create_index(
        "ix_supplier_events_supplier", "supplier_events", ["supplier_id"], schema="app"
    )


def downgrade() -> None:
    op.drop_table("supplier_events", schema="app")
    op.drop_table("supplier_attachments", schema="app")
    op.drop_table("supplier_products", schema="app")
    op.drop_table("suppliers", schema="app")
