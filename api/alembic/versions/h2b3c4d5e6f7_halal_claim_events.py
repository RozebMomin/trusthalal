"""halal claim events: per-claim audit trail

Adds the ``halal_claim_events`` table that captures every meaningful
state transition on a ``HalalClaim`` — owner drafts, owner submits,
attachment uploads, admin decisions (approve / reject / request-info /
revoke), and system-driven events (supersession, expiry).

The pattern mirrors ``place_events`` and ``halal_profile_events``:
one row per transition, FK back to the claim, FK back to the actor
(nullable for system events), free-text ``description`` so callers
can stash a one-line context message ("admin asked for cert renewal",
"supplier letter doesn't match", etc.). Status itself isn't recorded
because the ``event_type`` column captures the transition more
precisely than a from/to status pair would.

The CHECK constraint on ``event_type`` mirrors the
``HalalClaimEventType`` StrEnum in code. New event types require a
migration update — small price for a database that won't quietly
accept typos.

Revision ID: h2b3c4d5e6f7
Revises: h1a2b3c4d5e6
Create Date: 2026-05-04 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "h2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = "h1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Kept in lock-step with ``HalalClaimEventType`` in
# ``app.modules.halal_claims.enums``. Adding a value here without
# adding it in code (or vice-versa) means inserts will 23514 against
# the CHECK constraint at runtime — better to fail loudly.
HALAL_CLAIM_EVENT_TYPE = (
    "DRAFT_CREATED",
    "SUBMITTED",
    "ATTACHMENT_ADDED",
    "APPROVED",
    "REJECTED",
    "INFO_REQUESTED",
    "REVOKED",
    "SUPERSEDED",
    "EXPIRED",
)


def _check(values: tuple[str, ...], col: str) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{col} IN ({quoted})"


def upgrade() -> None:
    op.create_table(
        "halal_claim_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "claim_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.halal_claims.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Free-text context. For decision events we stash the
        # decision_note here verbatim so the audit trail captures the
        # message even if the claim's decision_note column gets
        # overwritten by a later transition.
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            _check(HALAL_CLAIM_EVENT_TYPE, "event_type"),
            name="ck_halal_claim_event_type",
        ),
        schema="app",
    )

    # Two indexes:
    #   * claim_id — every read of the timeline filters here.
    #   * actor_user_id — supports admin's "what has user X done"
    #     audit queries. Cheap given the column is already indexed
    #     for the FK constraint.
    op.create_index(
        "ix_app_halal_claim_events_claim_id",
        "halal_claim_events",
        ["claim_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_halal_claim_events_actor_user_id",
        "halal_claim_events",
        ["actor_user_id"],
        schema="app",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_app_halal_claim_events_actor_user_id",
        table_name="halal_claim_events",
        schema="app",
    )
    op.drop_index(
        "ix_app_halal_claim_events_claim_id",
        table_name="halal_claim_events",
        schema="app",
    )
    op.drop_table("halal_claim_events", schema="app")
