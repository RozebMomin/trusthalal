"""Per-meat verifier verification (place_meat_verifications)

Records when a verifier last confirmed a specific meat in person, and who — so
a single-meat visit doesn't make the whole kitchen read as verified. Latest
visit wins per (place_id, meat_type). Additive.

Revision ID: a4b5c6d70819
Revises: f3a405172839
Create Date: 2026-08-25
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "a4b5c6d70819"
down_revision: Union[str, None] = "f3a405172839"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "place_meat_verifications",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("place_id", UUID(as_uuid=True), nullable=False),
        sa.Column("meat_type", sa.String(length=20), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("verifier_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["place_id"], ["app.places.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["verifier_user_id"], ["app.users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("place_id", "meat_type", name="uq_place_meat_verification"),
        schema="app",
    )
    op.create_index(
        "ix_place_meat_verifications_place_id",
        "place_meat_verifications",
        ["place_id"],
        schema="app",
    )


def downgrade() -> None:
    op.drop_index("ix_place_meat_verifications_place_id", table_name="place_meat_verifications", schema="app")
    op.drop_table("place_meat_verifications", schema="app")
