"""auth: invite_tokens table for set-password / password-reset flows

Adds a single-use token store for the admin invite workflow. The token
plaintext is shown exactly once (in the admin-create response); the DB
holds only its SHA-256 hash so a DB leak can't replay outstanding
invites.

Table shape
-----------
  * ``id`` / ``created_at`` — standard UUID + timestamp.
  * ``user_id`` — FK to the user the token belongs to. ON DELETE
    CASCADE so removing a user cleans up pending invites.
  * ``token_hash`` — SHA-256 hex digest (64 chars). Unique index so
    verify can look it up directly.
  * ``purpose`` — VARCHAR + CHECK, so we can add "PASSWORD_RESET" in a
    later migration without an ALTER TYPE. Default 'INVITE' lets
    today's one caller omit the column.
  * ``expires_at`` — wall-clock TTL.
  * ``consumed_at`` — set on successful redeem. Single-use.
  * ``created_by_user_id`` — the admin who minted the token. SET NULL
    on user delete so the audit trail survives.

Indexes
-------
  * ``ix_invite_tokens_token_hash`` (unique) — primary lookup on verify.
  * ``ix_invite_tokens_user_id_live`` — partial unique on
    ``(user_id, purpose)`` WHERE consumed_at IS NULL AND expires_at >
    now(). Stops a user from having two live invites for the same
    purpose outstanding at once (admin re-invites transparently replace
    the previous pending invite by hard-deleting the old row, keeping
    this index consistent).

    We don't put ``expires_at > now()`` in the partial predicate
    because the planner can't prove a wall-clock predicate stays true
    — instead the repo code treats ``expires_at`` as a soft filter at
    redeem time. The partial covers the "same-user same-purpose
    still-pending" case; pretty much exactly what we want.

Revision ID: d8a6b2f4e193
Revises: c9e3a8f1d5b7
Create Date: 2026-04-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID


revision: str = "d8a6b2f4e193"
down_revision: Union[str, Sequence[str], None] = "c9e3a8f1d5b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "invite_tokens",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "token_hash",
            sa.String(length=64),
            nullable=False,
        ),
        sa.Column(
            "purpose",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'INVITE'"),
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "consumed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "created_by_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint(
            "purpose IN ('INVITE', 'PASSWORD_RESET')",
            name="ck_invite_tokens_purpose",
        ),
        schema="app",
    )

    # Primary lookup path: verify a plaintext token by hashing it
    # client-side of the DB and looking up the row. Unique so two
    # tokens can't collide (extremely unlikely with 256 bits of
    # entropy, but the index is cheap insurance).
    op.create_index(
        "ix_invite_tokens_token_hash",
        "invite_tokens",
        ["token_hash"],
        unique=True,
        schema="app",
    )

    # "One live invite per (user, purpose)" guard. Filtered on
    # consumed_at so historical rows don't block future invites. We
    # deliberately DON'T filter on expires_at: the planner can't prove
    # a wall-clock expression stays true over time, so the predicate
    # would be stale immediately. Expiry is checked at redeem time in
    # app code. The partial predicate still covers the common case:
    # "pending invite for this user."
    op.create_index(
        "ix_invite_tokens_user_id_live",
        "invite_tokens",
        ["user_id", "purpose"],
        unique=True,
        schema="app",
        postgresql_where=sa.text("consumed_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_invite_tokens_user_id_live",
        table_name="invite_tokens",
        schema="app",
    )
    op.drop_index(
        "ix_invite_tokens_token_hash",
        table_name="invite_tokens",
        schema="app",
    )
    op.drop_table("invite_tokens", schema="app")
