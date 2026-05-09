"""consumer_favorites table — signed-in consumers save places they want
to come back to.

One row per (user, place) pair. The composite primary key is
``(user_id, place_id)`` so the natural "is this place saved by me?"
lookup is a primary-key hit and a duplicate save is a no-op at the
constraint layer (we still gate on the API surface to return a clean
response, but the DB is the safety net).

Cascade-delete on both FKs so a deleted user / place doesn't leave
orphaned favorite rows. ``created_at`` lets the consumer surface
sort newest-first without an extra column.

Revision ID: i1e2f3a4b5c6
Revises: i0d1e2f3a4b5
Create Date: 2026-05-09 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "i1e2f3a4b5c6"
down_revision: Union[str, None] = "i0d1e2f3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "consumer_favorites",
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "place_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "user_id", "place_id", name="pk_consumer_favorites"
        ),
        schema="app",
    )

    # Per-user listing is the hot read path ("/me/favorites"). The PK
    # already covers (user_id, place_id) but the listing query orders
    # by ``created_at DESC`` — a dedicated index on (user_id,
    # created_at) makes that a single index scan instead of a sort.
    op.create_index(
        "ix_consumer_favorites_user_created",
        "consumer_favorites",
        ["user_id", sa.text("created_at DESC")],
        schema="app",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_consumer_favorites_user_created",
        table_name="consumer_favorites",
        schema="app",
    )
    op.drop_table("consumer_favorites", schema="app")
