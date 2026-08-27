"""Append-only admin notes on verification visits

Internal log an admin can add to a verification visit ("called the restaurant",
"waiting on a cert"). Distinct from the verifier's own note and the decision
note. Additive.

Revision ID: b5c6d7e8091a
Revises: a4b5c6d70819
Create Date: 2026-08-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "b5c6d7e8091a"
down_revision: Union[str, None] = "a4b5c6d70819"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "verification_visit_notes",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("visit_id", UUID(as_uuid=True), nullable=False),
        sa.Column("author_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["visit_id"], ["app.verification_visits.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["author_user_id"], ["app.users.id"], ondelete="SET NULL"
        ),
        schema="app",
    )
    op.create_index(
        "ix_verification_visit_notes_visit_id",
        "verification_visit_notes",
        ["visit_id"],
        schema="app",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_verification_visit_notes_visit_id",
        table_name="verification_visit_notes",
        schema="app",
    )
    op.drop_table("verification_visit_notes", schema="app")
