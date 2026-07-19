"""User blocks — "I don't want to see this person's content"

App Store Review Guideline 1.2 requires four things of an app with
user-generated content: filtering objectionable material, a way to report it,
**the ability to block abusive users**, and published contact information. We
had three of the four the moment reviews shipped.

Blocking is deliberately one-directional and private:

  * It hides the blocked person's reviews from the blocker. It does NOT hide
    the blocker from them, and it does not notify anyone. A block that pings
    the blocked user turns a quiet self-protective action into a confrontation.
  * It is not moderation. Reporting escalates to staff; blocking is a personal
    filter that changes nothing for anyone else. The two need to stay separate
    or people will use the wrong one and be surprised by the result.

Revision ID: t3f4a5b6c7d8
Revises: s2e3f4a5b6c7
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "t3f4a5b6c7d8"
down_revision: Union[str, None] = "s2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_blocks",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "blocker_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "blocked_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # Blocking twice is the same as blocking once.
        sa.UniqueConstraint(
            "blocker_user_id", "blocked_user_id", name="uq_user_blocks_pair"
        ),
        # You cannot block yourself. Cheap to enforce here, and it stops a
        # confusing state where your own review vanishes from your feed.
        sa.CheckConstraint(
            "blocker_user_id <> blocked_user_id", name="ck_user_blocks_not_self"
        ),
        schema="app",
    )
    # The hot path: "which authors is this viewer hiding?", asked on every
    # review list read.
    op.create_index(
        "ix_user_blocks_blocker",
        "user_blocks",
        ["blocker_user_id"],
        schema="app",
    )


def downgrade() -> None:
    op.drop_table("user_blocks", schema="app")
