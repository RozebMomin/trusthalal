"""formalize claim event_type enum

Revision ID: e4a1d5b9c2f7
Revises: c7f4a2e8d910
Create Date: 2026-04-24 00:00:00.000000

Formalizes `app.claim_events.event_type` as a `ClaimEventType` StrEnum.
Follows the same VARCHAR + CHECK pattern used by HalalClaim enums
(native_enum=False) so we can evolve the allowed set by editing a
CHECK constraint rather than running ALTER TYPE.

Also normalizes existing rows to upper-case before adding the check,
in case historical rows were written in lower-case.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = "e4a1d5b9c2f7"
down_revision: Union[str, Sequence[str], None] = "c7f4a2e8d910"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


VALID_EVENT_TYPES = (
    "SUBMITTED",
    "EVIDENCE_ADDED",
    "VERIFIED",
    "REFRESH_REQUESTED",
    "DISPUTED",
    "ADMIN_VERIFIED",
    "ADMIN_REJECTED",
    "ADMIN_EXPIRED",
    "EXPIRED",
)


def upgrade() -> None:
    """Upgrade schema."""
    # Normalize any historical mixed-case rows (the repo has always written
    # upper-case values, but belt-and-suspenders before the CHECK).
    op.execute(
        "UPDATE app.claim_events SET event_type = UPPER(event_type) "
        "WHERE event_type IS NOT NULL"
    )

    in_list = ",".join(f"'{v}'" for v in VALID_EVENT_TYPES)
    op.create_check_constraint(
        "ck_claim_events_event_type",
        "claim_events",
        f"event_type IN ({in_list})",
        schema="app",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "ck_claim_events_event_type",
        "claim_events",
        schema="app",
        type_="check",
    )
