"""place_photos table — owner + consumer uploaded restaurant photos

Schema for owner- and consumer-uploaded photos of a place. Hero
selection is enforced at the DB level via a partial unique index so
the application doesn't have to defend against two heroes existing
at once.

Authority + display rules are derived from ``source``:
  * OWNER  — uploaded by an active OWNER_ADMIN/MANAGER on the org
             that owns the place. Eligible to be marked hero.
  * CONSUMER — uploaded by any other authenticated user. Cannot be
               hero (only owners pick the cover image).

Soft delete via ``deleted_at`` so admin moderation has an audit
trail and accidental deletes can be restored. The partial unique
index excludes deleted rows so a re-uploaded hero replacement
works after a soft-delete.

Bytes live in Supabase Storage at
``{place_id}/{photo_id}.{ext}`` inside the public ``place-photos``
bucket. The bucket is configured public-readable so URLs work
without signing — read-heavy public surface, signing every photo
request would defeat CDN caching.

Revision ID: h9c0d1e2f3a4
Revises: h8b9c0d1e2f3
Create Date: 2026-05-08 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "h9c0d1e2f3a4"
down_revision: Union[str, None] = "h8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "place_photos",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.places.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "uploaded_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # OWNER vs CONSUMER. Stored as TEXT (no native enum) so adding
        # VERIFIER later is a code-only change. Length-constrained so a
        # malformed write surfaces loudly rather than silently growing.
        sa.Column(
            "source",
            sa.String(length=32),
            nullable=False,
        ),
        # Storage object key inside the place-photos bucket. Unique so
        # a stale insert can't point at the same byte stream as an
        # earlier row (defense in depth — application UUIDs already
        # guarantee uniqueness).
        sa.Column("storage_path", sa.Text(), nullable=False, unique=True),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        # Dimensions are extracted server-side via Pillow on upload.
        # Nullable to defend against malformed uploads where Pillow
        # can't read the file — the row still lands so the operator
        # has something to debug, just without dimensions.
        sa.Column("width_px", sa.Integer(), nullable=True),
        sa.Column("height_px", sa.Integer(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        # is_hero: only one row per place can be true, enforced via
        # the partial unique index below. Owner-only mutation.
        sa.Column(
            "is_hero",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Soft delete. NULL = visible. Non-null = hidden from public
        # reads; admin queue / restore endpoints can still see it.
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        schema="app",
    )

    # Partial unique index: at most one hero per place among non-
    # deleted rows. Lets a soft-deleted hero be replaced by a fresh
    # upload without an explicit "clear hero" step.
    op.create_index(
        "ix_place_photos_one_hero_per_place",
        "place_photos",
        ["place_id"],
        unique=True,
        schema="app",
        postgresql_where=sa.text("is_hero = true AND deleted_at IS NULL"),
    )

    # Listing index: the public GET hits "non-deleted photos for this
    # place, hero-first". The (place_id, deleted_at IS NULL) filter
    # uses the FK index above; this one orders by created_at so the
    # gallery query stays index-only.
    op.create_index(
        "ix_place_photos_listing",
        "place_photos",
        ["place_id", "created_at"],
        schema="app",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_place_photos_listing",
        table_name="place_photos",
        schema="app",
    )
    op.drop_index(
        "ix_place_photos_one_hero_per_place",
        table_name="place_photos",
        schema="app",
    )
    op.drop_table("place_photos", schema="app")
