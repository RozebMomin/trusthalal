"""halal_profile_events: allow VERIFIER_VISIT_ACCEPTED event type

Adds a single value (``VERIFIER_VISIT_ACCEPTED``) to the CHECK
constraint on ``app.halal_profile_events.event_type``. Phase 8b ships
the verification-visit acceptance flow, which writes one of these
events when an admin accepts a verifier's site visit and promotes
the place's validation_tier.

The bump uses the standard "drop + recreate the CHECK" dance —
Postgres doesn't have an ``ALTER CHECK`` for in-place updates, so
the CHECK is dropped and recreated with the larger value list.

Revision ID: h4d5e6f7a8b9
Revises: h3c4d5e6f7a8
Create Date: 2026-05-06 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "h4d5e6f7a8b9"
down_revision: Union[str, Sequence[str], None] = "h3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_OLD_VALUES = (
    "CREATED",
    "UPDATED",
    "EXPIRED",
    "DISPUTE_OPENED",
    "DISPUTE_RESOLVED",
    "REVOKED",
    "RESTORED",
)
_NEW_VALUES = _OLD_VALUES + ("VERIFIER_VISIT_ACCEPTED",)


def _check(values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"event_type IN ({quoted})"


def upgrade() -> None:
    op.drop_constraint(
        "ck_halal_profile_event_type",
        "halal_profile_events",
        schema="app",
    )
    op.create_check_constraint(
        "ck_halal_profile_event_type",
        "halal_profile_events",
        _check(_NEW_VALUES),
        schema="app",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_halal_profile_event_type",
        "halal_profile_events",
        schema="app",
    )
    op.create_check_constraint(
        "ck_halal_profile_event_type",
        "halal_profile_events",
        _check(_OLD_VALUES),
        schema="app",
    )
