"""verification_visits.status: add WITHDRAWN to the CHECK constraint.

The ``VerificationVisitStatus`` enum gained ``WITHDRAWN`` in the
verifier portal slice so a verifier can pull a misfired SUBMITTED
visit before admin reviews it. The Python enum + the route wiring
landed, but the original ``h1a2b3c4d5e6_halal_v2_schema`` migration
hard-coded the CHECK tuple to (SUBMITTED, UNDER_REVIEW, ACCEPTED,
REJECTED), so the column rejects ``WITHDRAWN`` at write time with
a ``CheckViolation``.

``sa.Enum(..., native_enum=False)`` emits a regular VARCHAR + CHECK
under the hood — adding a value to the Python enum doesn't
auto-update the constraint. This migration drops the old check and
recreates it with the full value set so the verifier withdraw flow
actually works.

Idempotency: the DROP uses ``IF EXISTS`` so a fresh DB built
straight from the latest models (no historical CHECK to drop) still
applies cleanly.

Revision ID: i2f3a4b5c6d7
Revises: i1e2f3a4b5c6
Create Date: 2026-05-13 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "i2f3a4b5c6d7"
down_revision: Union[str, None] = "i1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CONSTRAINT = "ck_verification_visit_status"
_TABLE = "app.verification_visits"


def upgrade() -> None:
    # Drop the legacy 4-value constraint. ``IF EXISTS`` makes the
    # migration tolerant of fresh DBs where Alembic may have produced
    # the constraint with a different name (e.g. autogen-style hash)
    # — the recreate step below installs the canonical name either
    # way.
    op.execute(
        f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {_CONSTRAINT}"
    )
    op.execute(
        f"ALTER TABLE {_TABLE} "
        f"ADD CONSTRAINT {_CONSTRAINT} CHECK ("
        "status IN ("
        "'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', "
        "'REJECTED', 'WITHDRAWN'"
        ")"
        ")"
    )


def downgrade() -> None:
    # Reverting strips WITHDRAWN back out — only safe if no rows
    # carry that value, but a downgrade in any real environment
    # would be the operator's call.
    op.execute(
        f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {_CONSTRAINT}"
    )
    op.execute(
        f"ALTER TABLE {_TABLE} "
        f"ADD CONSTRAINT {_CONSTRAINT} CHECK ("
        "status IN ("
        "'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED'"
        ")"
        ")"
    )
