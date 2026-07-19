"""Email verification: users.email_verified_at + EMAIL_VERIFICATION token purpose

Reviews are the first feature where an unverified account can publish content
that damages a named business, so signup's long-standing "no email
verification (deliberate; revisit if abuse warrants it)" gets revisited here.

Three changes:

  1. ``users.email_verified_at`` — nullable timestamptz rather than a boolean.
     A timestamp carries the same yes/no answer plus *when*, which is what
     you actually want when investigating an abusive account six months from
     now. NULL means "never confirmed".

  2. ``ck_invite_tokens_purpose`` gains ``'EMAIL_VERIFICATION'``. The
     InviteToken model docstring anticipated exactly this ("adding a new
     purpose (password reset, email verification) is a CHECK constraint
     change + app code change, no ALTER TYPE dance"), which is why the
     column is VARCHAR + CHECK instead of a native enum.

  3. Backfill. Accounts that completed an admin invite already proved control
     of their address — the single-use secret was delivered there — so they
     are marked verified as of now. Self-signup accounts are deliberately
     left NULL: they are precisely the population this gate exists for, and
     they'll be prompted the first time they try to post a review. Nothing
     they can do today breaks.

Downgrade drops the column and restores the two-value constraint. Any
EMAIL_VERIFICATION rows are deleted first, since they'd violate it.

Revision ID: p9b0c1d2e3f4
Revises: o8a9b0c1d2e3
Create Date: 2026-07-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p9b0c1d2e3f4"
down_revision: Union[str, None] = "o8a9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        schema="app",
    )

    # CHECK constraints can't be altered in place; drop and recreate.
    op.drop_constraint(
        "ck_invite_tokens_purpose",
        "invite_tokens",
        schema="app",
        type_="check",
    )
    op.create_check_constraint(
        "ck_invite_tokens_purpose",
        "invite_tokens",
        "purpose IN ('INVITE', 'PASSWORD_RESET', 'EMAIL_VERIFICATION')",
        schema="app",
    )

    # Invite-completed accounts proved inbox control at set-password time.
    op.execute(
        """
        UPDATE app.users u
           SET email_verified_at = now()
          FROM app.invite_tokens t
         WHERE t.user_id = u.id
           AND t.purpose = 'INVITE'
           AND t.consumed_at IS NOT NULL
           AND u.email_verified_at IS NULL
        """
    )


def downgrade() -> None:
    # These rows would violate the restored constraint.
    op.execute("DELETE FROM app.invite_tokens WHERE purpose = 'EMAIL_VERIFICATION'")

    op.drop_constraint(
        "ck_invite_tokens_purpose",
        "invite_tokens",
        schema="app",
        type_="check",
    )
    op.create_check_constraint(
        "ck_invite_tokens_purpose",
        "invite_tokens",
        "purpose IN ('INVITE', 'PASSWORD_RESET')",
        schema="app",
    )

    op.drop_column("users", "email_verified_at", schema="app")
