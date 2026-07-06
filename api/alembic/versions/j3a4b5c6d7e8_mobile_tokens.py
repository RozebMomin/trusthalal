"""app.mobile_tokens — bearer access/refresh tokens for the mobile app.

The web keeps HttpOnly session cookies; React Native can't hold one
reliably, so the mobile app authenticates with an opaque access token
(1 h) + single-use refresh token (30 d). Both are stored hash-only
(SHA-256 hex) so a database dump never yields usable credentials.
``pair_id`` groups the two tokens minted together so logout / rotation
revokes both with one UPDATE. See
``app/modules/auth/mobile_tokens.py`` for the full design rationale
(and why these are deliberately not JWTs).

Indexes:
  * unique on ``token_hash`` — the per-request point read
  * ``user_id`` — "revoke everything for this user" (password change)
  * ``pair_id`` — pair revocation on rotation / logout

Revision ID: j3a4b5c6d7e8
Revises: i2f3a4b5c6d7
Create Date: 2026-07-06 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "j3a4b5c6d7e8"
down_revision: Union[str, None] = "i2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mobile_tokens",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("pair_id", UUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('ACCESS', 'REFRESH')",
            name="ck_mobile_tokens_kind",
        ),
        schema="app",
    )
    op.create_index(
        "ux_mobile_tokens_token_hash",
        "mobile_tokens",
        ["token_hash"],
        unique=True,
        schema="app",
    )
    op.create_index(
        "ix_mobile_tokens_user_id",
        "mobile_tokens",
        ["user_id"],
        schema="app",
    )
    op.create_index(
        "ix_mobile_tokens_pair_id",
        "mobile_tokens",
        ["pair_id"],
        schema="app",
    )


def downgrade() -> None:
    op.drop_index("ix_mobile_tokens_pair_id", table_name="mobile_tokens", schema="app")
    op.drop_index("ix_mobile_tokens_user_id", table_name="mobile_tokens", schema="app")
    op.drop_index(
        "ux_mobile_tokens_token_hash", table_name="mobile_tokens", schema="app"
    )
    op.drop_table("mobile_tokens", schema="app")
