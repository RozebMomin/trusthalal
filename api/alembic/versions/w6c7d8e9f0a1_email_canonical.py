"""Canonical-email dedup key on users

Adds ``users.email_canonical`` so signup can reject a second account at an
address that reaches an inbox we already have — Gmail dot-insertion and
``+tag`` sub-addressing look distinct to the exact-match check but deliver to
the same place. See app.core.email_hygiene for the full reasoning.

Two deliberate choices:

- **Nullable, and NO unique constraint.** The accounts this feature exists to
  stop are already in the table. A unique index would make this migration
  fail on those existing duplicates, or force us to delete rows inside a
  schema migration, which is the wrong place for it. Uniqueness is enforced in
  the signup handler instead, which can surface EMAIL_TAKEN gracefully and
  leaves the historical dupes for a human to clean up.

- **Backfill logic is inlined, not imported from app.core.email_hygiene.** A
  migration is a frozen historical artifact; importing app code would let a
  future change to the canonicalisation silently change what this migration
  does on a fresh database. The canonical form is only a dedup key, so old
  rows keeping the migration-time logic is harmless even if the app's logic
  later gets sharper.

Revision ID: w6c7d8e9f0a1
Revises: v5b6c7d8e9f0
Create Date: 2026-07-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "w6c7d8e9f0a1"
down_revision: Union[str, None] = "v5b6c7d8e9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copies — see module docstring for why these aren't imported.
_DOT_INSENSITIVE = {"gmail.com", "googlemail.com"}
_PLUS_ALIASING = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
    "icloud.com", "me.com", "fastmail.com", "proton.me", "protonmail.com",
}


def _canonical(email: str) -> str:
    raw = (email or "").strip().lower()
    if "@" not in raw:
        return raw
    local, _, domain = raw.rpartition("@")
    if domain in _PLUS_ALIASING and "+" in local:
        local = local.split("+", 1)[0]
    if domain in _DOT_INSENSITIVE:
        local = local.replace(".", "")
    if domain == "googlemail.com":
        domain = "gmail.com"
    return f"{local}@{domain}"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_canonical", sa.String(length=320), nullable=True),
        schema="app",
    )
    op.create_index(
        "ix_users_email_canonical",
        "users",
        ["email_canonical"],
        unique=False,
        schema="app",
    )

    # Backfill existing rows.
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, email FROM app.users WHERE email IS NOT NULL")
    ).fetchall()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE app.users SET email_canonical = :c WHERE id = :i"
            ),
            {"c": _canonical(row.email), "i": row.id},
        )


def downgrade() -> None:
    op.drop_index("ix_users_email_canonical", table_name="users", schema="app")
    op.drop_column("users", "email_canonical", schema="app")
