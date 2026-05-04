"""halal v2: drop legacy claims, add new halal/dispute/verifier tables

Background
----------
The legacy ``halal_claims`` / ``evidence`` / ``claim_events`` schema
predated the owner-portal redesign and didn't capture the structured
halal-trust mechanic we settled on (validation tier × menu posture ×
per-meat slaughter, plus separate dispute and verifier flows).

Since we're still pre-launch, we drop the legacy tables outright and
build the new schema from scratch — clean break, no preserve-and-
migrate complexity. Production data wipe (drop schema + re-run all
migrations) is the user's existing reset workflow, so this migration
fits cleanly into that.

What this migration does
------------------------
1. Drop legacy tables: ``halal_claims``, ``evidence``, ``claim_events``.
2. Create ``halal_claims`` (new shape) — workflow rows for the owner-
   submitted halal questionnaire.
3. Create ``halal_claim_attachments`` — evidence files per claim.
4. Create ``halal_profiles`` — denormalized current-truth snapshot
   per place. 1:1 with Place (when one exists). Consumer search hits
   indexed columns here.
5. Create ``halal_profile_events`` — audit trail of profile changes.
6. Create ``consumer_disputes`` + ``consumer_dispute_attachments`` —
   signed-in consumer reports.
7. Create ``verifier_applications`` — public apply form rows.
8. Create ``verifier_profiles`` — sidecar to ``users`` for verifiers.
9. Create ``verification_visits`` + ``verification_visit_attachments``
   — site-visit records from verifiers.

The cross-references between these tables (halal_claim →
consumer_disputes via triggered_by_dispute_id; halal_profile_events →
both halal_claims and consumer_disputes; consumer_disputes →
halal_profiles) require careful ordering: create the tables that are
self-contained first, then layer on the cross-FKs after both sides
exist. We do that with an explicit ALTER pass at the end.

Revision ID: h1a2b3c4d5e6
Revises: b5c8e2a9d4f7
Create Date: 2026-04-29 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "h1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "b5c8e2a9d4f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Enum value lists, kept in lock-step with the StrEnum definitions in code.
# ---------------------------------------------------------------------------
HALAL_CLAIM_TYPE = ("INITIAL", "RENEWAL", "RECONCILIATION")
HALAL_CLAIM_STATUS = (
    "DRAFT",
    "PENDING_REVIEW",
    "NEEDS_MORE_INFO",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    "REVOKED",
    "SUPERSEDED",
)
HALAL_CLAIM_ATTACHMENT_TYPE = (
    "HALAL_CERTIFICATE",
    "SUPPLIER_LETTER",
    "INVOICE",
    "PHOTO",
    "OTHER",
)

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
SLAUGHTER_METHOD = ("ZABIHAH", "MACHINE", "NOT_SERVED")
ALCOHOL_POLICY = ("NONE", "BEER_AND_WINE_ONLY", "FULL_BAR")
DISPUTE_STATE = ("NONE", "DISPUTED", "RECONCILING")
PROFILE_EVENT_TYPE = (
    "CREATED",
    "UPDATED",
    "EXPIRED",
    "DISPUTE_OPENED",
    "DISPUTE_RESOLVED",
    "REVOKED",
    "RESTORED",
)

DISPUTE_STATUS = (
    "OPEN",
    "OWNER_RECONCILING",
    "ADMIN_REVIEWING",
    "RESOLVED_UPHELD",
    "RESOLVED_DISMISSED",
    "WITHDRAWN",
)
DISPUTED_ATTRIBUTE = (
    "PORK_SERVED",
    "ALCOHOL_PRESENT",
    "MENU_POSTURE_INCORRECT",
    "SLAUGHTER_METHOD_INCORRECT",
    "CERTIFICATION_INVALID",
    "PLACE_CLOSED",
    "OTHER",
)

VERIFIER_APPLICATION_STATUS = ("PENDING", "APPROVED", "REJECTED", "WITHDRAWN")
VERIFIER_PROFILE_STATUS = ("ACTIVE", "SUSPENDED", "REVOKED")
VISIT_DISCLOSURE = (
    "SELF_FUNDED",
    "MEAL_COMPED",
    "PAID_PARTNERSHIP",
    "OTHER_DISCLOSURE",
)
VERIFICATION_VISIT_STATUS = (
    "SUBMITTED",
    "UNDER_REVIEW",
    "ACCEPTED",
    "REJECTED",
)


def _check(values: tuple[str, ...], col: str) -> str:
    """Build a CHECK constraint clause for the given enum values."""
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{col} IN ({quoted})"


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Step 1: drop legacy tables (in dependency order — children first).
    # ------------------------------------------------------------------
    op.drop_table("claim_events", schema="app")
    op.drop_table("evidence", schema="app")
    op.drop_table("halal_claims", schema="app")

    # ------------------------------------------------------------------
    # Step 2: create halal_profiles first — halal_claims has an FK
    # to consumer_disputes and consumer_disputes has an FK to
    # halal_profiles, so we have a cycle. We resolve by creating
    # halal_profiles + halal_claims WITHOUT the cross-FKs first, then
    # adding them in step 9.
    # ------------------------------------------------------------------
    op.create_table(
        "halal_profiles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # source_claim_id FK added in step 9.
        sa.Column(
            "source_claim_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "validation_tier",
            sa.String(50),
            nullable=False,
            server_default="SELF_ATTESTED",
        ),
        sa.Column("menu_posture", sa.String(50), nullable=False),
        sa.Column(
            "has_pork",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "alcohol_policy",
            sa.String(50),
            nullable=False,
            server_default="NONE",
        ),
        sa.Column(
            "alcohol_in_cooking",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "chicken_slaughter",
            sa.String(50),
            nullable=False,
            server_default="NOT_SERVED",
        ),
        sa.Column(
            "beef_slaughter",
            sa.String(50),
            nullable=False,
            server_default="NOT_SERVED",
        ),
        sa.Column(
            "lamb_slaughter",
            sa.String(50),
            nullable=False,
            server_default="NOT_SERVED",
        ),
        sa.Column(
            "goat_slaughter",
            sa.String(50),
            nullable=False,
            server_default="NOT_SERVED",
        ),
        sa.Column(
            "seafood_only",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "has_certification",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("certifying_body_name", sa.String(255), nullable=True),
        sa.Column(
            "certificate_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column("caveats", sa.Text, nullable=True),
        sa.Column(
            "dispute_state",
            sa.String(50),
            nullable=False,
            server_default="NONE",
        ),
        sa.Column(
            "last_verified_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.UniqueConstraint("place_id", name="uq_halal_profile_place"),
        sa.CheckConstraint(
            _check(VALIDATION_TIER, "validation_tier"),
            name="ck_halal_profile_validation_tier",
        ),
        sa.CheckConstraint(
            _check(MENU_POSTURE, "menu_posture"),
            name="ck_halal_profile_menu_posture",
        ),
        sa.CheckConstraint(
            _check(ALCOHOL_POLICY, "alcohol_policy"),
            name="ck_halal_profile_alcohol_policy",
        ),
        sa.CheckConstraint(
            _check(SLAUGHTER_METHOD, "chicken_slaughter"),
            name="ck_halal_profile_chicken_slaughter",
        ),
        sa.CheckConstraint(
            _check(SLAUGHTER_METHOD, "beef_slaughter"),
            name="ck_halal_profile_beef_slaughter",
        ),
        sa.CheckConstraint(
            _check(SLAUGHTER_METHOD, "lamb_slaughter"),
            name="ck_halal_profile_lamb_slaughter",
        ),
        sa.CheckConstraint(
            _check(SLAUGHTER_METHOD, "goat_slaughter"),
            name="ck_halal_profile_goat_slaughter",
        ),
        sa.CheckConstraint(
            _check(DISPUTE_STATE, "dispute_state"),
            name="ck_halal_profile_dispute_state",
        ),
        schema="app",
    )
    op.create_index(
        "ix_app_halal_profiles_place_id",
        "halal_profiles",
        ["place_id"],
        schema="app",
    )

    # ------------------------------------------------------------------
    # Step 3: halal_claims (without cross-FKs).
    # ------------------------------------------------------------------
    op.create_table(
        "halal_claims",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "submitted_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # triggered_by_dispute_id FK added in step 9.
        sa.Column(
            "triggered_by_dispute_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("claim_type", sa.String(50), nullable=False),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="DRAFT",
        ),
        sa.Column(
            "structured_response",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decision_note", sa.Text, nullable=True),
        sa.Column("internal_notes", sa.Text, nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
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
            _check(HALAL_CLAIM_TYPE, "claim_type"),
            name="ck_halal_claim_type",
        ),
        sa.CheckConstraint(
            _check(HALAL_CLAIM_STATUS, "status"),
            name="ck_halal_claim_status",
        ),
        schema="app",
    )
    op.create_index(
        "ix_app_halal_claims_place_id",
        "halal_claims",
        ["place_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_halal_claims_submitted_by_user_id",
        "halal_claims",
        ["submitted_by_user_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_halal_claims_organization_id",
        "halal_claims",
        ["organization_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_halal_claims_decided_by_user_id",
        "halal_claims",
        ["decided_by_user_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_halal_claims_status",
        "halal_claims",
        ["status"],
        schema="app",
    )

    # ------------------------------------------------------------------
    # Step 4: halal_claim_attachments — depends only on halal_claims.
    # ------------------------------------------------------------------
    op.create_table(
        "halal_claim_attachments",
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
        sa.Column(
            "document_type",
            sa.String(50),
            nullable=False,
            server_default="OTHER",
        ),
        sa.Column("issuing_authority", sa.String(255), nullable=True),
        sa.Column("certificate_number", sa.String(255), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("storage_path", sa.Text, nullable=False, unique=True),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            _check(HALAL_CLAIM_ATTACHMENT_TYPE, "document_type"),
            name="ck_halal_claim_attachment_document_type",
        ),
        schema="app",
    )
    op.create_index(
        "ix_app_halal_claim_attachments_claim_id",
        "halal_claim_attachments",
        ["claim_id"],
        schema="app",
    )

    # ------------------------------------------------------------------
    # Step 5: consumer_disputes — references halal_profiles.
    # ------------------------------------------------------------------
    op.create_table(
        "consumer_disputes",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="OPEN",
        ),
        sa.Column("disputed_attribute", sa.String(50), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column(
            "contested_profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.halal_profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("admin_decision_note", sa.Text, nullable=True),
        sa.Column(
            "submitted_at",
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
            _check(DISPUTE_STATUS, "status"),
            name="ck_consumer_dispute_status",
        ),
        sa.CheckConstraint(
            _check(DISPUTED_ATTRIBUTE, "disputed_attribute"),
            name="ck_consumer_disputed_attribute",
        ),
        schema="app",
    )
    op.create_index(
        "ix_app_consumer_disputes_place_id",
        "consumer_disputes",
        ["place_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_consumer_disputes_reporter_user_id",
        "consumer_disputes",
        ["reporter_user_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_consumer_disputes_contested_profile_id",
        "consumer_disputes",
        ["contested_profile_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_consumer_disputes_status",
        "consumer_disputes",
        ["status"],
        schema="app",
    )

    op.create_table(
        "consumer_dispute_attachments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "dispute_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.consumer_disputes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("storage_path", sa.Text, nullable=False, unique=True),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="app",
    )
    op.create_index(
        "ix_app_consumer_dispute_attachments_dispute_id",
        "consumer_dispute_attachments",
        ["dispute_id"],
        schema="app",
    )

    # ------------------------------------------------------------------
    # Step 6: halal_profile_events — references halal_profiles,
    # halal_claims, consumer_disputes (all created above).
    # ------------------------------------------------------------------
    op.create_table(
        "halal_profile_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.halal_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "related_claim_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.halal_claims.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "related_dispute_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.consumer_disputes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            _check(PROFILE_EVENT_TYPE, "event_type"),
            name="ck_halal_profile_event_type",
        ),
        schema="app",
    )
    op.create_index(
        "ix_app_halal_profile_events_profile_id",
        "halal_profile_events",
        ["profile_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_halal_profile_events_actor_user_id",
        "halal_profile_events",
        ["actor_user_id"],
        schema="app",
    )

    # ------------------------------------------------------------------
    # Step 7: verifier_profiles — sidecar to users.
    # ------------------------------------------------------------------
    op.create_table(
        "verifier_profiles",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "public_handle",
            sa.String(80),
            nullable=True,
            unique=True,
        ),
        sa.Column("bio", sa.Text, nullable=True),
        sa.Column(
            "social_links",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "is_public",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.Column(
            "joined_as_verifier_at",
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
            _check(VERIFIER_PROFILE_STATUS, "status"),
            name="ck_verifier_profile_status",
        ),
        schema="app",
    )

    # ------------------------------------------------------------------
    # Step 8: verifier_applications — references verifier_profiles
    # via resulting_verifier_profile_id.
    # ------------------------------------------------------------------
    op.create_table(
        "verifier_applications",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "applicant_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("applicant_email", sa.String(320), nullable=False),
        sa.Column("applicant_name", sa.String(255), nullable=False),
        sa.Column("motivation", sa.Text, nullable=False),
        sa.Column("background", sa.Text, nullable=True),
        sa.Column(
            "social_links",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decision_note", sa.Text, nullable=True),
        sa.Column(
            "resulting_verifier_profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "app.verifier_profiles.user_id", ondelete="SET NULL"
            ),
            nullable=True,
        ),
        sa.Column(
            "submitted_at",
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
            _check(VERIFIER_APPLICATION_STATUS, "status"),
            name="ck_verifier_application_status",
        ),
        schema="app",
    )
    op.create_index(
        "ix_app_verifier_applications_applicant_user_id",
        "verifier_applications",
        ["applicant_user_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_verifier_applications_decided_by_user_id",
        "verifier_applications",
        ["decided_by_user_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_verifier_applications_status",
        "verifier_applications",
        ["status"],
        schema="app",
    )

    # ------------------------------------------------------------------
    # Step 9: verification_visits + attachments.
    # ------------------------------------------------------------------
    op.create_table(
        "verification_visits",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "verifier_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "app.verifier_profiles.user_id", ondelete="CASCADE"
            ),
            nullable=False,
        ),
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("visited_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "structured_findings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("notes_for_admin", sa.Text, nullable=True),
        sa.Column("public_review_url", sa.String(2048), nullable=True),
        sa.Column(
            "disclosure",
            sa.String(50),
            nullable=False,
            server_default="SELF_FUNDED",
        ),
        sa.Column("disclosure_note", sa.Text, nullable=True),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="SUBMITTED",
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decision_note", sa.Text, nullable=True),
        sa.Column(
            "submitted_at",
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
            _check(VISIT_DISCLOSURE, "disclosure"),
            name="ck_verification_visit_disclosure",
        ),
        sa.CheckConstraint(
            _check(VERIFICATION_VISIT_STATUS, "status"),
            name="ck_verification_visit_status",
        ),
        schema="app",
    )
    op.create_index(
        "ix_app_verification_visits_verifier_user_id",
        "verification_visits",
        ["verifier_user_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_verification_visits_place_id",
        "verification_visits",
        ["place_id"],
        schema="app",
    )
    op.create_index(
        "ix_app_verification_visits_status",
        "verification_visits",
        ["status"],
        schema="app",
    )

    op.create_table(
        "verification_visit_attachments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "visit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "app.verification_visits.id", ondelete="CASCADE"
            ),
            nullable=False,
        ),
        sa.Column("storage_path", sa.Text, nullable=False, unique=True),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("caption", sa.Text, nullable=True),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="app",
    )
    op.create_index(
        "ix_app_verification_visit_attachments_visit_id",
        "verification_visit_attachments",
        ["visit_id"],
        schema="app",
    )

    # ------------------------------------------------------------------
    # Step 10: layer on the cycle-creating cross-FKs.
    # ------------------------------------------------------------------
    # halal_profiles.source_claim_id -> halal_claims
    op.create_foreign_key(
        "fk_halal_profile_source_claim",
        "halal_profiles",
        "halal_claims",
        ["source_claim_id"],
        ["id"],
        source_schema="app",
        referent_schema="app",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_app_halal_profiles_source_claim_id",
        "halal_profiles",
        ["source_claim_id"],
        schema="app",
    )

    # halal_claims.triggered_by_dispute_id -> consumer_disputes
    op.create_foreign_key(
        "fk_halal_claim_triggered_by_dispute",
        "halal_claims",
        "consumer_disputes",
        ["triggered_by_dispute_id"],
        ["id"],
        source_schema="app",
        referent_schema="app",
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_app_halal_claims_triggered_by_dispute_id",
        "halal_claims",
        ["triggered_by_dispute_id"],
        schema="app",
    )


def downgrade() -> None:
    # Drop in reverse order of creation. Cross-FKs first so the
    # cyclical drops below succeed.
    op.drop_constraint(
        "fk_halal_claim_triggered_by_dispute",
        "halal_claims",
        schema="app",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_halal_profile_source_claim",
        "halal_profiles",
        schema="app",
        type_="foreignkey",
    )

    op.drop_table("verification_visit_attachments", schema="app")
    op.drop_table("verification_visits", schema="app")
    op.drop_table("verifier_applications", schema="app")
    op.drop_table("verifier_profiles", schema="app")
    op.drop_table("halal_profile_events", schema="app")
    op.drop_table("consumer_dispute_attachments", schema="app")
    op.drop_table("consumer_disputes", schema="app")
    op.drop_table("halal_claim_attachments", schema="app")
    op.drop_table("halal_claims", schema="app")
    op.drop_table("halal_profiles", schema="app")

    # We do NOT recreate the legacy halal_claims / evidence /
    # claim_events tables on downgrade — they were dropped as part of
    # this migration's intent (clean break, pre-launch). A real
    # rollback to the old shape would require restoring from a
    # backup, which is the user's existing reset workflow.
