"""consumer preferences: per-user saved search filter defaults

Adds the ``consumer_preferences`` table — one row per user (only
ever populated for CONSUMER role accounts, but the schema doesn't
enforce the role; the API surface is what gates writes).

Stores the same filter knobs the consumer search page exposes:
minimum acceptable validation tier, minimum acceptable menu posture,
no-pork / no-alcohol / has-certification booleans. Per-meat slaughter
preferences are intentionally out of scope for v1 — a sequence-typed
filter doesn't fit cleanly in a single column and the search UI
treats them as advanced. We can add a JSONB ``slaughter_prefs``
column when the demand is real.

Why a separate table instead of columns on ``users``:
  * The set of preferences will grow; ``users`` already has plenty
    of orthogonal concerns (auth, role, soft-delete) and adding more
    columns there gums up unrelated migrations.
  * Most users (admins, owners, verifiers) never have prefs at all
    — keeping them in a side table avoids a large nullable footprint
    on the main table.
  * Future work can index ``consumer_preferences`` independently
    without touching the user catalog.

Revision ID: h3c4d5e6f7a8
Revises: h2b3c4d5e6f7
Create Date: 2026-05-06 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "h3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "h2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Mirrors of the StrEnums in app/modules/halal_profiles/enums.py.
# Adding a new enum value in code without updating these tuples will
# fail loudly at insert time with a 23514 — better than silently
# accepting typos.
VALIDATION_TIER = (
    "SELF_ATTESTED",
    "CERTIFICATE_ON_FILE",
    "TRUST_HALAL_VERIFIED",
)

MENU_POSTURE = (
    "FULLY_HALAL",
    "MIXED_SEPARATE_KITCHENS",
    "HALAL_OPTIONS_ADVERTISED",
    "HALAL_UPON_REQUEST",
    "MIXED_SHARED_KITCHEN",
)


def _check(values: tuple[str, ...], col: str) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{col} IN ({quoted})"


def upgrade() -> None:
    op.create_table(
        "consumer_preferences",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # Both threshold filters are nullable — null means "no
        # minimum, accept anything". The search query treats null
        # the same way it treats an absent param.
        sa.Column("min_validation_tier", sa.String(50), nullable=True),
        sa.Column("min_menu_posture", sa.String(50), nullable=True),
        # Boolean filters: tri-state via NULL ("don't care"). False is
        # rare in practice (a user explicitly toggling "I'm fine with
        # pork being served") but we store it for completeness rather
        # than collapsing False to NULL.
        sa.Column("no_pork", sa.Boolean(), nullable=True),
        sa.Column("no_alcohol_served", sa.Boolean(), nullable=True),
        sa.Column("has_certification", sa.Boolean(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            f"({_check(VALIDATION_TIER, 'min_validation_tier')}) "
            "OR min_validation_tier IS NULL",
            name="ck_consumer_preferences_min_validation_tier",
        ),
        sa.CheckConstraint(
            f"({_check(MENU_POSTURE, 'min_menu_posture')}) "
            "OR min_menu_posture IS NULL",
            name="ck_consumer_preferences_min_menu_posture",
        ),
        schema="app",
    )


def downgrade() -> None:
    op.drop_table("consumer_preferences", schema="app")
