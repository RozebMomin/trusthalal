"""organizations: status enum + attachments table for verification

Background
----------
Slice 5 of the owner-portal redesign moves Organization creation off
the admin path and onto self-service. Owners create their own org,
upload supporting documents (articles of organization, business
filing, etc.), and submit for review; admin staff verifies or
rejects.

This migration lays the data foundation:

  * Add ``status`` to ``app.organizations`` with a CHECK constraint
    against the OrganizationStatus enum. Existing rows backfill to
    ``VERIFIED`` — they were created on the admin path, which is
    implicitly trusted.
  * Add ``submitted_at`` (nullable) to record when DRAFT → UNDER_REVIEW
    transitioned. Useful for admin queue triage.
  * Add ``created_by_user_id`` (nullable, ON DELETE SET NULL) so we
    can ask "who started this org?" in admin context. Nullable
    because admin-created orgs don't have a single owner-creator.
  * New table ``app.organization_attachments`` mirroring
    ``app.ownership_request_attachments``: storage_path, original
    filename, content type, size bytes, upload time. CASCADE on
    organization delete.

Revision ID: f1a3b8d6c2e9
Revises: e7c2a9f4b6d8
Create Date: 2026-04-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1a3b8d6c2e9"
down_revision: Union[str, Sequence[str], None] = "e7c2a9f4b6d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Organization status + audit columns
    # ------------------------------------------------------------------
    # status: nullable on add, backfill, then NOT NULL + CHECK. Done in
    # three steps to avoid CHECK violations on the implicit default.
    op.add_column(
        "organizations",
        sa.Column("status", sa.String(length=50), nullable=True),
        schema="app",
    )
    op.execute(
        "UPDATE app.organizations SET status = 'VERIFIED' WHERE status IS NULL"
    )
    op.alter_column(
        "organizations",
        "status",
        nullable=False,
        server_default=sa.text("'DRAFT'"),
        schema="app",
    )
    op.create_check_constraint(
        "ck_organizations_status",
        "organizations",
        "status::text = ANY (ARRAY['DRAFT','UNDER_REVIEW','VERIFIED','REJECTED']::text[])",
        schema="app",
    )

    op.add_column(
        "organizations",
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="app",
    )

    op.add_column(
        "organizations",
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        schema="app",
    )
    op.create_foreign_key(
        "fk_organizations_created_by_user_id",
        "organizations",
        "users",
        ["created_by_user_id"],
        ["id"],
        source_schema="app",
        referent_schema="app",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_organizations_created_by_user_id",
        "organizations",
        ["created_by_user_id"],
        unique=False,
        schema="app",
    )
    op.create_index(
        "ix_organizations_status",
        "organizations",
        ["status"],
        unique=False,
        schema="app",
    )

    # ------------------------------------------------------------------
    # Attachments table — mirror of ownership_request_attachments
    # ------------------------------------------------------------------
    op.create_table(
        "organization_attachments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column(
            "original_filename", sa.String(length=512), nullable=False
        ),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["app.organizations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "size_bytes >= 0 AND size_bytes <= 26214400",
            name="ck_org_attachment_size_bytes_range",
        ),
        sa.UniqueConstraint(
            "storage_path",
            name="uq_organization_attachments_storage_path",
        ),
        schema="app",
    )

    op.create_index(
        "ix_organization_attachments_organization_id",
        "organization_attachments",
        ["organization_id"],
        unique=False,
        schema="app",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_organization_attachments_organization_id",
        table_name="organization_attachments",
        schema="app",
    )
    op.drop_table("organization_attachments", schema="app")

    op.drop_index(
        "ix_organizations_status",
        table_name="organizations",
        schema="app",
    )
    op.drop_index(
        "ix_organizations_created_by_user_id",
        table_name="organizations",
        schema="app",
    )
    op.drop_constraint(
        "fk_organizations_created_by_user_id",
        "organizations",
        type_="foreignkey",
        schema="app",
    )
    op.drop_column("organizations", "created_by_user_id", schema="app")
    op.drop_column("organizations", "submitted_at", schema="app")
    op.drop_constraint(
        "ck_organizations_status", "organizations", schema="app", type_="check"
    )
    op.drop_column("organizations", "status", schema="app")
