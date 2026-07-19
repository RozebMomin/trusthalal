"""Photo reports + owner-only hero policy

Two changes:

  1. ``place_photo_reports`` — owners report diner photos rather than deleting
     them, matching Google and Yelp. Separate from ``place_review_reports``
     on purpose: no rating, no reply, different reasons, and merging them
     would mean a nullable-everything super-table.

  2. **Data fix.** Cover photos are now owner-supplied only (OWNER or GOOGLE
     source, never a diner's, never review-attached). Any place whose current
     hero is a CONSUMER photo has to be re-pointed, or it keeps a cover the
     new rule forbids and no code path will ever correct it.

     Re-point order: newest OWNER photo, else newest GOOGLE photo, else clear
     the hero entirely and let the place fall back to its placeholder. Losing
     a card image is the right outcome — it's recoverable by the owner
     uploading one, whereas a diner's photo silently representing a business
     is not something they can fix.

Revision ID: r1d2e3f4a5b6
Revises: q0c1d2e3f4a5
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "r1d2e3f4a5b6"
down_revision: Union[str, None] = "q0c1d2e3f4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_REASON = sa.Enum(
    "NOT_THIS_PLACE",
    "INAPPROPRIATE",
    "MISLEADING",
    "PERSONAL_INFO",
    "COPYRIGHT",
    "OTHER",
    name="photo_report_reason",
    native_enum=False,
    length=32,
)
_STATUS = sa.Enum(
    "OPEN",
    "UPHELD",
    "DISMISSED",
    name="photo_report_status",
    native_enum=False,
    length=32,
)


def upgrade() -> None:
    op.create_table(
        "place_photo_reports",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "photo_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.place_photos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", _REASON, nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("status", _STATUS, nullable=False, server_default=sa.text("'OPEN'")),
        sa.Column(
            "resolved_by_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "photo_id", "reporter_user_id", name="uq_photo_reports_photo_reporter"
        ),
        schema="app",
    )
    op.create_index(
        "ix_photo_reports_photo", "place_photo_reports", ["photo_id"], schema="app"
    )
    op.create_index(
        "ix_photo_reports_reporter",
        "place_photo_reports",
        ["reporter_user_id"],
        schema="app",
    )
    op.create_index(
        "ix_photo_reports_status", "place_photo_reports", ["status"], schema="app"
    )

    # ------------------------------------------------------------------
    # Re-point heroes that the new policy forbids.
    # ------------------------------------------------------------------
    # Step 1: demote every ineligible hero. Done first and separately so the
    # partial unique index on (place_id) WHERE is_hero can't collide when we
    # promote the replacement below.
    op.execute(
        """
        UPDATE app.place_photos
           SET is_hero = false
         WHERE is_hero = true
           AND deleted_at IS NULL
           AND (source = 'CONSUMER' OR review_id IS NOT NULL)
        """
    )

    # Step 2: promote the newest eligible photo for any place left without
    # one. DISTINCT ON picks a single winner per place, ordered so OWNER
    # beats GOOGLE and newer beats older.
    op.execute(
        """
        WITH candidates AS (
            SELECT DISTINCT ON (p.place_id)
                   p.id
              FROM app.place_photos p
             WHERE p.deleted_at IS NULL
               AND p.review_id IS NULL
               AND p.source IN ('OWNER', 'GOOGLE')
               AND NOT EXISTS (
                     SELECT 1
                       FROM app.place_photos h
                      WHERE h.place_id = p.place_id
                        AND h.is_hero = true
                        AND h.deleted_at IS NULL
                   )
             ORDER BY p.place_id,
                      (p.source = 'OWNER') DESC,
                      p.created_at DESC
        )
        UPDATE app.place_photos
           SET is_hero = true
          FROM candidates
         WHERE app.place_photos.id = candidates.id
        """
    )


def downgrade() -> None:
    # The hero re-pointing is not reversed: we don't record which photo was
    # demoted, and restoring a diner photo to cover would re-create exactly
    # the state this migration exists to remove.
    op.drop_table("place_photo_reports", schema="app")
