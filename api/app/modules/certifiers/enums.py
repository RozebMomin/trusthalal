"""Enums for the certifier registry.

A certifier is the practical unit of knowledge behind a halal claim: cut method
and standards are almost never published per plant, but they are published (or
notably *absent*) per certifying body. This registry canonicalises the bodies a
restaurant/supplier attributes a product to, so "IFANCA" always means one entry
(and "IFANCA"/"IFANCC" stop colliding), and so context — including adverse
history — has somewhere to live.

House idiom: values stored as VARCHAR + CHECK (``sa.Enum(native_enum=False)``),
so adding a value is a code-only change unless the CHECK needs widening.
"""
from enum import StrEnum


class CertifierAdverseEventType(StrEnum):
    """A documented adverse event against a certifying body. Admin-only context
    (never surfaced to consumers in the initial build) — it informs curation and
    gives facts like ISA's federal conviction alongside Midamar a home, which
    they have nowhere to live today."""

    CONVICTION = "CONVICTION"
    """Criminal conviction (e.g. ISA / Midamar falsified USDA export docs)."""

    SANCTION = "SANCTION"
    """Regulatory sanction, fine, or forfeiture short of conviction."""

    DELISTING = "DELISTING"
    """Removed / suspended by an accreditation body or authority."""

    DISPUTE = "DISPUTE"
    """A credible, documented dispute about the body's practices."""

    OTHER = "OTHER"
    """Anything else worth recording; detail in the summary."""
