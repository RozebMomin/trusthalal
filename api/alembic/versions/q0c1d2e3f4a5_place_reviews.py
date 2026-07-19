"""Diner reviews: reviews, owner replies, reports, and place aggregates

The last major feature before launch. Consumers rate and review places, owners
reply publicly, and bad content is handled by a report button plus an admin
queue rather than a pre-publish gate.

Five changes:

  1. ``place_reviews`` — the review itself. The unique constraint on
     (place_id, author_user_id) is the single most valuable anti-spam control
     in the feature and costs nothing: you edit rather than stack.
  2. ``place_review_replies`` — one per review, unique-constrained. Owners
     carry the same moderation states as diners; they are not exempt.
  3. ``place_review_reports`` — a flag against a review or (via the nullable
     ``reply_id``) a reply.
  4. ``places.review_rating_avg`` / ``review_count`` — denormalized
     first-party aggregates, mirroring how ``google_rating`` already lives on
     the place so search and cards need no join.
  5. ``place_photos.review_id`` — a review photo *is* a place photo that
     happens to be attached to a review. Same table means it inherits the
     existing SafeSearch, EXIF-strip, soft-delete and gallery paths for free.

Enum columns follow the house idiom: VARCHAR + CHECK via
``native_enum=False``, so adding a status or a report reason later is a code
change rather than an ``ALTER TYPE`` dance.

Revision ID: q0c1d2e3f4a5
Revises: p9b0c1d2e3f4
Create Date: 2026-07-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "q0c1d2e3f4a5"
down_revision: Union[str, None] = "p9b0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STATUS = sa.Enum(
    "PUBLISHED",
    "HIDDEN",
    "REMOVED",
    name="place_review_status",
    native_enum=False,
    length=32,
)
_REASON = sa.Enum(
    "SPAM",
    "OFF_TOPIC",
    "HARASSMENT",
    "FALSE_INFO",
    "CONFLICT_OF_INTEREST",
    "OTHER",
    name="review_report_reason",
    native_enum=False,
    length=32,
)
_REPORT_STATUS = sa.Enum(
    "OPEN",
    "UPHELD",
    "DISMISSED",
    name="review_report_status",
    native_enum=False,
    length=32,
)


def upgrade() -> None:
    # -----------------------------------------------------------------
    # place_reviews
    # -----------------------------------------------------------------
    op.create_table(
        "place_reviews",
        sa.Column(
            "id", PG_UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column(
            "place_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # CASCADE, unlike disputes/photos which use SET NULL: a review is a
        # personal opinion attributed by name, and an orphan attributed to
        # nobody helps no reader.
        sa.Column(
            "author_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("visited_on", sa.Date(), nullable=True),
        sa.Column(
            "status", _STATUS, nullable=False, server_default=sa.text("'PUBLISHED'")
        ),
        sa.Column("moderation_note", sa.Text(), nullable=True),
        sa.Column(
            "moderated_by_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        # Reserved for a later "did the halal info match?" question that
        # would feed the dispute flow. Unused by v1.
        sa.Column("halal_matched", sa.Boolean(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "place_id", "author_user_id", name="uq_place_reviews_place_author"
        ),
        sa.CheckConstraint(
            "rating BETWEEN 1 AND 5", name="ck_place_reviews_rating_range"
        ),
        schema="app",
    )
    op.create_index(
        "ix_place_reviews_place_id", "place_reviews", ["place_id"], schema="app"
    )
    op.create_index(
        "ix_place_reviews_status", "place_reviews", ["status"], schema="app"
    )
    op.create_index(
        "ix_place_reviews_author", "place_reviews", ["author_user_id"], schema="app"
    )
    # The shape of every public read: this place, visible, newest first.
    op.execute(
        """
        CREATE INDEX ix_place_reviews_place_status_created
            ON app.place_reviews (place_id, status, created_at DESC)
        """
    )

    # -----------------------------------------------------------------
    # place_review_replies
    # -----------------------------------------------------------------
    op.create_table(
        "place_review_replies",
        sa.Column(
            "id", PG_UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column(
            "review_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.place_reviews.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # SET NULL: the reply speaks for the business, so it survives the
        # individual manager's account being deleted.
        sa.Column(
            "author_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "organization_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "status", _STATUS, nullable=False, server_default=sa.text("'PUBLISHED'")
        ),
        sa.Column("moderation_note", sa.Text(), nullable=True),
        sa.Column(
            "moderated_by_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # One reply per review, in the schema rather than the handler.
        sa.UniqueConstraint("review_id", name="uq_place_review_replies_review"),
        schema="app",
    )
    op.create_index(
        "ix_place_review_replies_org",
        "place_review_replies",
        ["organization_id"],
        schema="app",
    )

    # -----------------------------------------------------------------
    # place_review_reports
    # -----------------------------------------------------------------
    op.create_table(
        "place_review_reports",
        sa.Column(
            "id", PG_UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column(
            "review_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.place_reviews.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Non-null when the reply is what's being reported. review_id stays
        # populated either way so the moderator sees the exchange in context.
        sa.Column(
            "reply_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.place_review_replies.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "reporter_user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", _REASON, nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column(
            "status",
            _REPORT_STATUS,
            nullable=False,
            server_default=sa.text("'OPEN'"),
        ),
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
        # One report per person per review — a brigade of one can't inflate
        # the queue, so the report count stays a meaningful signal.
        sa.UniqueConstraint(
            "review_id",
            "reporter_user_id",
            name="uq_review_reports_review_reporter",
        ),
        schema="app",
    )
    op.create_index(
        "ix_review_reports_review",
        "place_review_reports",
        ["review_id"],
        schema="app",
    )
    op.create_index(
        "ix_review_reports_reporter",
        "place_review_reports",
        ["reporter_user_id"],
        schema="app",
    )
    op.create_index(
        "ix_review_reports_status",
        "place_review_reports",
        ["status"],
        schema="app",
    )

    # -----------------------------------------------------------------
    # Denormalized aggregates on places
    # -----------------------------------------------------------------
    op.add_column(
        "places",
        sa.Column("review_rating_avg", sa.Numeric(2, 1), nullable=True),
        schema="app",
    )
    op.add_column(
        "places",
        sa.Column(
            "review_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        schema="app",
    )

    # -----------------------------------------------------------------
    # Review photos reuse the existing place-photo pipeline
    # -----------------------------------------------------------------
    op.add_column(
        "place_photos",
        sa.Column(
            "review_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("app.place_reviews.id", ondelete="CASCADE"),
            nullable=True,
        ),
        schema="app",
    )
    # Partial: the overwhelming majority of photos aren't attached to a
    # review, and the only query is "photos for this review".
    op.execute(
        """
        CREATE INDEX ix_place_photos_review_id
            ON app.place_photos (review_id)
            WHERE review_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS app.ix_place_photos_review_id")
    op.drop_column("place_photos", "review_id", schema="app")

    op.drop_column("places", "review_count", schema="app")
    op.drop_column("places", "review_rating_avg", schema="app")

    op.drop_table("place_review_reports", schema="app")
    op.drop_table("place_review_replies", schema="app")
    op.execute("DROP INDEX IF EXISTS app.ix_place_reviews_place_status_created")
    op.drop_table("place_reviews", schema="app")
