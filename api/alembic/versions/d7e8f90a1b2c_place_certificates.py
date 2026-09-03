"""Multiple certificates per place (place_certificates)

A place can hold several halal certificates — a chicken cert from one body, a
beef cert from another. Replaces the single certificate on the profile. Backfills
each profile's existing cert as the first entry. Additive.

Revision ID: d7e8f90a1b2c
Revises: c6d7e8f90a1b
Create Date: 2026-09-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "d7e8f90a1b2c"
down_revision: Union[str, None] = "c6d7e8f90a1b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "place_certificates",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("place_id", UUID(as_uuid=True), nullable=False),
        sa.Column("certifier_id", UUID(as_uuid=True), nullable=True),
        sa.Column("certifier_name", sa.String(length=255), nullable=True),
        sa.Column("meat_types", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("certificate_url", sa.Text(), nullable=True),
        sa.Column("certificate_content_type", sa.String(length=128), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["place_id"], ["app.places.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["certifier_id"], ["app.certifiers.id"], ondelete="SET NULL"),
        schema="app",
    )
    op.create_index(
        "ix_place_certificates_place_id", "place_certificates", ["place_id"], schema="app",
    )

    # Backfill: every profile that already has a certificate becomes the first
    # entry in the new table, tagged LEGACY and covering all meats ([]).
    op.execute(
        """
        INSERT INTO app.place_certificates
            (id, place_id, certifier_name, meat_types, certificate_url,
             certificate_content_type, expires_at, source, created_at, updated_at)
        SELECT gen_random_uuid(), hp.place_id, hp.certifying_body_name, '[]'::jsonb,
               hp.certificate_url, hp.certificate_content_type,
               hp.certificate_expires_at, 'LEGACY', now(), now()
        FROM app.halal_profiles hp
        WHERE hp.certificate_url IS NOT NULL AND hp.revoked_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_place_certificates_place_id", table_name="place_certificates", schema="app")
    op.drop_table("place_certificates", schema="app")
