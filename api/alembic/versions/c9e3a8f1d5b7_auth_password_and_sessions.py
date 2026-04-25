"""auth: password_hash on users + sessions table

Adds the two schema pieces needed for real authentication:

  * ``users.password_hash`` — nullable so pre-auth rows keep working
    until they complete the set-password flow. Callers check for a
    non-null hash before allowing login.

  * ``sessions`` table — server-side session store. The cookie sent to
    the browser is just the ``id``; everything else (expiry, revocation,
    user link) is checked server-side on every request. We intentionally
    pick this over JWT for simplicity: revocation is instant, no
    encryption-key rotation, no refresh-token dance. If we ever need
    stateless auth (e.g. for a mobile API), we can add JWT alongside
    without ripping this out.

Two indexes earn their keep:
  * ``ix_sessions_user_id_revoked`` — for "is this user logged in
    anywhere?" admin queries and for bulk-revoke-on-password-change.
  * ``ix_sessions_expires_at``      — for the periodic cleanup job that
    deletes expired rows so the table doesn't grow forever.

Revision ID: c9e3a8f1d5b7
Revises: b4f1c8e2a7d5
Create Date: 2026-04-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID


revision: str = "c9e3a8f1d5b7"
down_revision: Union[str, Sequence[str], None] = "b4f1c8e2a7d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- users.password_hash -------------------------------------------------
    # Nullable because:
    #   1. Existing rows have no password (seeded via dev-login only).
    #   2. Invite flow creates users without a hash and mails them a
    #      set-password link to complete.
    # A non-null hash is the precondition for login.
    op.add_column(
        "users",
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        schema="app",
    )

    # --- sessions -----------------------------------------------------------
    op.create_table(
        "sessions",
        # UUIDs are generated client-side (default=uuid.uuid4 on the
        # SQLAlchemy model), matching the pattern used by every other
        # table in this schema. Avoids depending on pgcrypto / the
        # gen_random_uuid() built-in, which isn't universal across
        # Postgres versions.
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "revoked_at",
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
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        schema="app",
    )

    # Partial index: look up a user's *active* sessions efficiently.
    # WHERE revoked_at IS NULL keeps the index small even as history grows.
    op.create_index(
        "ix_sessions_user_id_active",
        "sessions",
        ["user_id"],
        unique=False,
        schema="app",
        postgresql_where=sa.text("revoked_at IS NULL"),
    )

    # Non-partial index on expires_at for the cleanup job. Scanning
    # revoked sessions during cleanup is fine — they're already dead,
    # and a partial index would need updating when revoked_at flips.
    op.create_index(
        "ix_sessions_expires_at",
        "sessions",
        ["expires_at"],
        unique=False,
        schema="app",
    )


def downgrade() -> None:
    op.drop_index("ix_sessions_expires_at", table_name="sessions", schema="app")
    op.drop_index(
        "ix_sessions_user_id_active", table_name="sessions", schema="app"
    )
    op.drop_table("sessions", schema="app")
    op.drop_column("users", "password_hash", schema="app")
