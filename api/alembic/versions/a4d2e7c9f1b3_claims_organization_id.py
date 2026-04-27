"""place_ownership_requests: add nullable organization_id

Slice 5b of the owner-portal redesign couples ownership claims to a
specific Organization at submission time. New /me/ownership-requests
calls require an organization_id from one of the caller's orgs that
is at least UNDER_REVIEW; the column carries that all the way through
to admin approval.

The column lands nullable so existing claims (legacy admin-created or
beta-test rows submitted before this migration) remain valid. Slice
5d restructures admin approval to read organization_id directly off
the claim row instead of accepting it in the approval body. Once the
team has confirmed all live rows have a sensible org assigned, a
follow-up migration can flip the column to NOT NULL.

Revision ID: a4d2e7c9f1b3
Revises: f1a3b8d6c2e9
Create Date: 2026-04-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a4d2e7c9f1b3"
down_revision: Union[str, Sequence[str], None] = "f1a3b8d6c2e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "place_ownership_requests",
        sa.Column("organization_id", sa.UUID(), nullable=True),
        schema="app",
    )

    op.create_foreign_key(
        "fk_place_ownership_requests_organization_id",
        "place_ownership_requests",
        "organizations",
        ["organization_id"],
        ["id"],
        source_schema="app",
        referent_schema="app",
        # SET NULL on org delete — the claim survives as audit
        # context even if the underlying org is removed. CASCADE
        # would silently destroy claim history; RESTRICT would
        # block legitimate org cleanups.
        ondelete="SET NULL",
    )

    op.create_index(
        "ix_place_ownership_requests_organization_id",
        "place_ownership_requests",
        ["organization_id"],
        unique=False,
        schema="app",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_place_ownership_requests_organization_id",
        table_name="place_ownership_requests",
        schema="app",
    )
    op.drop_constraint(
        "fk_place_ownership_requests_organization_id",
        "place_ownership_requests",
        type_="foreignkey",
        schema="app",
    )
    op.drop_column(
        "place_ownership_requests",
        "organization_id",
        schema="app",
    )
