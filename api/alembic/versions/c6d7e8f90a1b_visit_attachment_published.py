"""Track publication of verification-visit attachments

Records whether an attachment has been pushed to the place (gallery photo or
the profile certificate), so the admin can see what's already published and we
don't blindly re-upload. Additive, nullable.

Revision ID: c6d7e8f90a1b
Revises: b5c6d7e8091a
Create Date: 2026-09-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c6d7e8f90a1b"
down_revision: Union[str, None] = "b5c6d7e8091a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "verification_visit_attachments",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        schema="app",
    )
    op.add_column(
        "verification_visit_attachments",
        sa.Column("published_kind", sa.String(length=16), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("verification_visit_attachments", "published_kind", schema="app")
    op.drop_column("verification_visit_attachments", "published_at", schema="app")
