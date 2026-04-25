"""audit-truthful updated_at on place_ownership_requests

Adds a BEFORE UPDATE trigger on app.place_ownership_requests that sets
NEW.updated_at = now() whenever a row is updated. The SQLAlchemy model
also carries onupdate=func.now() so ORM updates bump the timestamp on
the Python side; this trigger covers raw SQL / psql / migrations that
modify rows without going through the ORM.

We define a reusable function `app.set_updated_at_now()` so future tables
can attach the same trigger.

Revision ID: c7f4a2e8d910
Revises: b1e2d3a4c5f6
Create Date: 2026-04-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c7f4a2e8d910"
down_revision: Union[str, Sequence[str], None] = "b1e2d3a4c5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Reusable trigger function. CREATE OR REPLACE so re-running is safe.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION app.set_updated_at_now()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$;
        """
    )

    # Drop any pre-existing trigger with the same name before creating
    # (idempotent replays in dev).
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_place_ownership_requests_set_updated_at
        ON app.place_ownership_requests;
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_place_ownership_requests_set_updated_at
        BEFORE UPDATE ON app.place_ownership_requests
        FOR EACH ROW
        EXECUTE FUNCTION app.set_updated_at_now();
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_place_ownership_requests_set_updated_at
        ON app.place_ownership_requests;
        """
    )
    # Leave the reusable function in place — future migrations may rely on
    # it — but drop it if no other triggers use it. We keep it for now.
    # op.execute("DROP FUNCTION IF EXISTS app.set_updated_at_now();")
