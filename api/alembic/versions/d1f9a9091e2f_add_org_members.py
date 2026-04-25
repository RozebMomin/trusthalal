"""add org members

Revision ID: d1f9a9091e2f
Revises: 9a7e3ad2467a
Create Date: 2026-01-20 18:56:19.208466

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d1f9a9091e2f"
down_revision: Union[str, Sequence[str], None] = "9a7e3ad2467a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "organization_members",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),

        # membership role inside the org (NOT platform role)
        sa.Column(
            "role",
            sa.String(length=50),
            server_default=sa.text("'OWNER_ADMIN'"),
            nullable=False,
        ),

        # lifecycle
        sa.Column(
            "status",
            sa.String(length=50),
            server_default=sa.text("'ACTIVE'"),
            nullable=False,
        ),

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

        sa.ForeignKeyConstraint(["organization_id"], ["app.organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["app.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_org_member_org_user"),
        schema="app",
    )

    op.create_index(
        "ix_org_members_org_id",
        "organization_members",
        ["organization_id"],
        schema="app",
    )
    op.create_index(
        "ix_org_members_user_id",
        "organization_members",
        ["user_id"],
        schema="app",
    )

    op.create_check_constraint(
        "ck_org_members_role",
        "organization_members",
        "role IN ('OWNER_ADMIN','MANAGER','STAFF')",
        schema="app",
    )
    op.create_check_constraint(
        "ck_org_members_status",
        "organization_members",
        "status IN ('ACTIVE','INVITED','REMOVED')",
        schema="app",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "ck_org_members_status",
        "organization_members",
        schema="app",
        type_="check",
    )
    op.drop_constraint(
        "ck_org_members_role",
        "organization_members",
        schema="app",
        type_="check",
    )

    op.drop_index(
        "ix_org_members_user_id",
        table_name="organization_members",
        schema="app",
    )
    op.drop_index(
        "ix_org_members_org_id",
        table_name="organization_members",
        schema="app",
    )

    op.drop_table("organization_members", schema="app")
