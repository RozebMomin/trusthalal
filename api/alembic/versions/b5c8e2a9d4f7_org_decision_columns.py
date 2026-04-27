"""organizations: decision audit fields for admin verify/reject

Slice 5c lets admin staff verify or reject an UNDER_REVIEW org. We
record the decision inline on the row rather than introducing a
full OrganizationEvent table — the workflow is simple enough that
"who decided, when, what was the note" is all the audit trail we
need today. If the workflow grows (re-review, manual amendments,
force-revocation), we can add an events table then.

  * decided_at — when the row last left UNDER_REVIEW. Null while
    DRAFT or UNDER_REVIEW.
  * decided_by_user_id — which admin made the call. Null on
    legacy/admin-bypass rows. SET NULL on user delete so a removed
    admin doesn't take the audit trail with them.
  * decision_note — free-form reason for REJECTED rows
    (server-required) or optional context for VERIFIED rows.

Revision ID: b5c8e2a9d4f7
Revises: a4d2e7c9f1b3
Create Date: 2026-04-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b5c8e2a9d4f7"
down_revision: Union[str, Sequence[str], None] = "a4d2e7c9f1b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        schema="app",
    )
    op.add_column(
        "organizations",
        sa.Column("decided_by_user_id", sa.UUID(), nullable=True),
        schema="app",
    )
    op.add_column(
        "organizations",
        sa.Column("decision_note", sa.Text(), nullable=True),
        schema="app",
    )

    op.create_foreign_key(
        "fk_organizations_decided_by_user_id",
        "organizations",
        "users",
        ["decided_by_user_id"],
        ["id"],
        source_schema="app",
        referent_schema="app",
        ondelete="SET NULL",
    )

    op.create_index(
        "ix_organizations_decided_by_user_id",
        "organizations",
        ["decided_by_user_id"],
        unique=False,
        schema="app",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_organizations_decided_by_user_id",
        table_name="organizations",
        schema="app",
    )
    op.drop_constraint(
        "fk_organizations_decided_by_user_id",
        "organizations",
        type_="foreignkey",
        schema="app",
    )
    op.drop_column("organizations", "decision_note", schema="app")
    op.drop_column("organizations", "decided_by_user_id", schema="app")
    op.drop_column("organizations", "decided_at", schema="app")
