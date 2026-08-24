"""Certifier registry: certifiers, certifier_aliases, certifier_adverse_events

Canonicalises the certifying bodies a restaurant/supplier attributes a product
to (research handoff §5.1, reduced to the attribution model — no cut-rule
columns). Seeds the 9 bodies from the research CSV plus their known aliases, and
the one adverse event with nowhere else to live: ISA's federal conviction
alongside Midamar (admin-only context).

Purely additive — nothing reads these yet.

Revision ID: ff60718293a4
Revises: ee5f60718293
Create Date: 2026-08-24
"""
from typing import Sequence, Union
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = "ff60718293a4"
down_revision: Union[str, None] = "ee5f60718293"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ADVERSE_EVENT_TYPE = ("CONVICTION", "SANCTION", "DELISTING", "DISPUTE", "OTHER")


def upgrade() -> None:
    op.create_table(
        "certifiers",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("legal_entity", sa.String(length=255), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("website", sa.String(length=512), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("slug", name="uq_certifiers_slug"),
        schema="app",
    )
    op.create_index("ix_certifiers_slug", "certifiers", ["slug"], schema="app")
    op.create_index("ix_certifiers_legal_entity", "certifiers", ["legal_entity"], schema="app")

    op.create_table(
        "certifier_aliases",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("certifier_id", PG_UUID(as_uuid=True), sa.ForeignKey("app.certifiers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alias", sa.String(length=255), nullable=False),
        sa.UniqueConstraint("alias", name="uq_certifier_alias"),
        schema="app",
    )
    op.create_index("ix_certifier_aliases_certifier_id", "certifier_aliases", ["certifier_id"], schema="app")

    op.create_table(
        "certifier_adverse_events",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("certifier_id", PG_UUID(as_uuid=True), sa.ForeignKey("app.certifiers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("source_url", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "event_type IN (" + ", ".join(f"'{v}'" for v in ADVERSE_EVENT_TYPE) + ")",
            name="ck_certifier_adverse_event_type",
        ),
        schema="app",
    )
    op.create_index("ix_certifier_adverse_events_certifier_id", "certifier_adverse_events", ["certifier_id"], schema="app")

    _seed()


def _seed() -> None:
    certifiers = sa.table(
        "certifiers",
        sa.column("id", PG_UUID(as_uuid=True)),
        sa.column("slug", sa.String),
        sa.column("name", sa.String),
        sa.column("legal_entity", sa.String),
        sa.column("country_code", sa.String),
        sa.column("website", sa.String),
        schema="app",
    )
    aliases = sa.table(
        "certifier_aliases",
        sa.column("id", PG_UUID(as_uuid=True)),
        sa.column("certifier_id", PG_UUID(as_uuid=True)),
        sa.column("alias", sa.String),
        schema="app",
    )
    adverse = sa.table(
        "certifier_adverse_events",
        sa.column("id", PG_UUID(as_uuid=True)),
        sa.column("certifier_id", PG_UUID(as_uuid=True)),
        sa.column("event_type", sa.String),
        sa.column("summary", sa.Text),
        sa.column("source_url", sa.String),
        schema="app",
    )

    # (slug, name, legal_entity, country, website, [aliases...])
    rows = [
        ("hto", "Halal Transactions of Omaha", "Halal Transactions, Inc.", "US",
         "https://halaltransactions.org",
         ["HTO", "Halal Transactions of Omaha", "Halal Transactions", "Halal Transactions of Omaha (HTO)"]),
        ("ifanca", "IFANCA", "Islamic Food and Nutrition Council of America", "US",
         "https://ifanca.org",
         ["IFANCA", "Islamic Food and Nutrition Council of America"]),
        ("ifancc", "IFANCC", "Islamic Food and Nutrition Council of Canada", "CA",
         "https://www.ifancc.org",
         ["IFANCC", "Islamic Food and Nutrition Council of Canada"]),
        ("isa", "Islamic Services of America", "ISA, Inc.", "US",
         "https://www.isahalal.com",
         ["ISA", "Islamic Services of America", "Islamic Services of America (ISA)",
          "Islamic Services of America (ISA) / ISNA", "ISA / ISNA"]),
        ("hfsaa", "HFSAA", "Halal Advocates of America", "US",
         "https://www.hfsaa.org",
         ["HFSAA", "Halal Food Standards Alliance of America", "Halal Advocates of America"]),
        ("hms", "Halal Monitoring Services", "Rahmat-e-Alam Foundation", "US",
         "https://hmsusa.org",
         ["HMS", "Halal Monitoring Services", "Shariah Board of America",
          "Shar'i Zabihah Committee",
          "Halal Monitoring Services (HMS) / Shariah Board of America"]),
        ("sbny", "Shariah Board of New York", "Shariah Board of New York", "US",
         "https://sbny.org",
         ["SBNY", "Shariah Board of New York"]),
        ("cdial", "CDIAL Halal", "CDIAL Halal Certification Authority Ltda", "BR",
         "https://cdialhalal.com.br",
         ["CDIAL", "CDIAL Halal"]),
        ("fambras", "FAMBRAS Halal", "FAMBRAS HALAL Certificacao LTDA", "BR",
         "https://www.fambrashalal.com.br",
         ["FAMBRAS", "FAMBRAS Halal"]),
    ]

    cert_records = []
    alias_records = []
    by_slug: dict[str, uuid.UUID] = {}
    for slug, name, legal, country, website, alias_list in rows:
        cid = uuid.uuid4()
        by_slug[slug] = cid
        cert_records.append({
            "id": cid, "slug": slug, "name": name,
            "legal_entity": legal, "country_code": country, "website": website,
        })
        for a in alias_list:
            alias_records.append({"id": uuid.uuid4(), "certifier_id": cid, "alias": a})

    op.bulk_insert(certifiers, cert_records)
    op.bulk_insert(aliases, alias_records)

    op.bulk_insert(adverse, [{
        "id": uuid.uuid4(),
        "certifier_id": by_slug["isa"],
        "event_type": "CONVICTION",
        "summary": (
            "ISA was criminally convicted alongside Midamar: $60,000 fine, "
            "$600,000 forfeiture, five-year probation, for falsified USDA export "
            "documents. The fraud specifically involved claiming beef was "
            "hand-slaughtered by a Muslim when it originated from a plant using "
            "penetrating captive bolt with no Muslim slaughtermen. Related-party "
            "risk: ISA's listed president shares a surname with Midamar's "
            "convicted founder. Admin-only context."
        ),
        "source_url": (
            "https://www.justice.gov/usao-ndia/pr/prison-term-and-nearly-1-"
            "million-judgments-ordered-against-midamar-founder-midamar-and"
        ),
    }])


def downgrade() -> None:
    op.drop_table("certifier_adverse_events", schema="app")
    op.drop_table("certifier_aliases", schema="app")
    op.drop_table("certifiers", schema="app")
