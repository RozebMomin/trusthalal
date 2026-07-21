"""Record who accepted the terms, and which version

Guideline 1.2 requires users of a UGC app to agree to terms. The notice on the
signup screens satisfies that going forward. This table change answers the
separate question the notice cannot: who agreed, to what, and when.

Both columns are nullable and there is deliberately no backfill. Every account
that existed when this shipped had never been shown terms at all — including
the people whose reviews and photos the content licence is written to cover —
and stamping them with an acceptance they never gave would manufacture
evidence of consent. NULL is the honest state, and it is what makes the
in-app acknowledgement prompt fire for exactly the right population.

``terms_version`` is a string rather than a flag so a later revision
re-prompts everyone by bumping app.core.legal.TERMS_VERSION, with no
migration and nothing to remember to reset.

Revision ID: v5b6c7d8e9f0
Revises: u4a5b6c7d8e9
Create Date: 2026-07-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v5b6c7d8e9f0"
down_revision: Union[str, None] = "u4a5b6c7d8e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
        schema="app",
    )
    op.add_column(
        "users",
        sa.Column("terms_version", sa.String(length=32), nullable=True),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("users", "terms_version", schema="app")
    op.drop_column("users", "terms_accepted_at", schema="app")
