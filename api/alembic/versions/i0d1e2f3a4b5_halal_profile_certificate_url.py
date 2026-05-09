"""halal_profiles: add certificate_url + certificate_content_type

Adds two nullable columns to ``app.halal_profiles`` so the public
profile can carry a direct link to the halal certificate document
itself (in addition to the existing ``has_certification``,
``certifying_body_name`` and ``certificate_expires_at`` metadata).

Why a URL on the public read shape:

  * The cert is the strongest trust signal we surface — restaurants
    physically post it on the wall, and consumers want to verify
    against the issuing body's records. "Certified by IFANCA" alone
    leaves the consumer hunting for the actual document.
  * The cert image / PDF is already on file (uploaded by the owner
    as a HALAL_CERTIFICATE attachment on the halal_claim) — but the
    bytes live in the private ``evidence`` bucket. Profile
    derivation will copy the bytes to a separate public-readable
    ``halal-certificates`` bucket and store the resulting URL here.

``certificate_content_type`` lets the consumer UI pick the right
viewer at render time — image/* renders in an <img>, application/pdf
renders in an <iframe>, anything else falls back to a download link.

Both columns are nullable: existing rows backfill to NULL (the cert
copy step doesn't run retroactively here — a future renewal /
re-approval will populate them, or an opt-in backfill script can be
run separately).

Revision ID: i0d1e2f3a4b5
Revises: h9c0d1e2f3a4
Create Date: 2026-05-09 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "i0d1e2f3a4b5"
down_revision: Union[str, None] = "h9c0d1e2f3a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "halal_profiles",
        sa.Column("certificate_url", sa.Text(), nullable=True),
        schema="app",
    )
    op.add_column(
        "halal_profiles",
        sa.Column(
            "certificate_content_type",
            sa.String(length=128),
            nullable=True,
        ),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column(
        "halal_profiles", "certificate_content_type", schema="app"
    )
    op.drop_column("halal_profiles", "certificate_url", schema="app")
