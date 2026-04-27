"""ownership_request_attachments table for owner-uploaded evidence

Adds a child table tracking files an owner uploads when submitting a
claim. The actual file bytes live in object storage (Supabase Storage
for v1 — see app/core/storage.py); this row holds the metadata we
need to render the attachment list in admin review and to fetch a
signed URL on demand.

Design notes:
  * One-to-many: a claim can have N files (utility bill + SOS
    filing + photo of the menu, etc.). We cap at 5/claim in the
    upload endpoint.
  * ON DELETE CASCADE: if admin hard-deletes a claim, the
    attachment rows go with it. The bytes in object storage need
    a separate cleanup pass — we'll add that to a maintenance
    script later if storage cost ever becomes a concern.
  * storage_path is the canonical reference into the bucket
    (e.g. "ownership-requests/<request_id>/<uuid>.pdf"). The
    bucket name itself is config, not stored on the row, so we
    can rebrand or reorganize without a migration.
  * original_filename is preserved verbatim for admin review
    context. Owners often pick descriptive filenames that hint at
    what the document is.
  * No updated_at — attachments are write-once. If an owner needs
    to swap a file they upload a new one and we add it as a
    second row. Keeps the audit trail honest.
  * id is populated Python-side via uuid.uuid4() in the model, so
    no server_default here — matches the convention of every
    other table in this schema.

Revision ID: e7c2a9f4b6d8
Revises: d8a6b2f4e193
Create Date: 2026-04-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e7c2a9f4b6d8"
down_revision: Union[str, Sequence[str], None] = "d8a6b2f4e193"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ownership_request_attachments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column(
            "original_filename", sa.String(length=512), nullable=False
        ),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["request_id"],
            ["app.place_ownership_requests.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        # Belt-and-suspenders DB cap matching the application-level
        # 10MB limit (with overhead slack to 25MB). A misbehaving
        # client or future endpoint that forgets the validation
        # can't insert a negative or absurd size that breaks the UI.
        sa.CheckConstraint(
            "size_bytes >= 0 AND size_bytes <= 26214400",
            name="ck_attachment_size_bytes_range",
        ),
        # Storage paths are unique per upload (UUID-named files), but
        # belt-and-suspenders against an accidental double-write that
        # would leave two rows pointing at the same blob.
        sa.UniqueConstraint(
            "storage_path",
            name="uq_ownership_request_attachments_storage_path",
        ),
        schema="app",
    )

    # Lookup pattern: "give me every attachment for this claim",
    # called by both the owner's view and the admin review screen.
    op.create_index(
        "ix_ownership_request_attachments_request_id",
        "ownership_request_attachments",
        ["request_id"],
        unique=False,
        schema="app",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ownership_request_attachments_request_id",
        table_name="ownership_request_attachments",
        schema="app",
    )
    op.drop_table("ownership_request_attachments", schema="app")
