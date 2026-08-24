"""Enums for the supplier registry — where slaughter method actually lives.

The redefinition (docs/2026-08-11-supplier-provenance-plan.md) makes slaughter
method a *supplier* fact, captured **per product line**, with confidence that
inherits the weaker of {supplier vetting, sourcing evidence}. These enums back
that model.

Vocabulary note: this module carries the **canonical slaughter vocabulary**
(``HAND_CUT`` / ``MACHINE_CUT`` / ``NOT_DISCLOSED``). The
``halal_profiles.SlaughterMethod`` enum that governs the per-meat profile
columns was migrated to the same words (``HAND_CUT`` / ``MACHINE_CUT`` /
``NOT_SERVED``) so both surfaces speak one vocabulary; the profile enum keeps
``NOT_SERVED`` (a menu fact) where this one carries ``NOT_DISCLOSED`` (a
sourcing-evidence gap).
"""
from enum import StrEnum


class SlaughterMethod(StrEnum):
    """Observable slaughter method for a supplier product line.

    We describe the *fact* and let each user apply their own standard — we do
    not render a verdict. Never ranked in-product.
    """

    HAND_CUT = "HAND_CUT"
    """Each animal hand-slaughtered by a Muslim reciting tasmiyah."""

    MACHINE_CUT = "MACHINE_CUT"
    """Mechanical / mechanized slaughter (blade on a line, blesser reciting)."""

    NOT_DISCLOSED = "NOT_DISCLOSED"
    """Method not stated / unknown. The default, and not a demerit."""


class ZabihahStatus(StrEnum):
    """The red-meat axis (beef / lamb / goat). Hand-vs-machine is a poultry
    question — essentially all red meat is hand-cut — and cut geometry is a
    research dead-end, so for red meat we don't adjudicate the slaughter
    mechanism. Instead the restaurant/supplier declares whether the product is
    zabihah and names the certifying body they attribute it to; we relay that as
    an attributed claim (we don't verify the packer).

    Poultry lines keep ``SlaughterMethod`` (hand/machine); red-meat lines use
    this. Which one is meaningful is decided by ``meat_type``.
    """

    ZABIHAH = "ZABIHAH"
    """Declared zabihah (hand-slaughtered by a Muslim), optionally with a named
    certifying body. Attributed to the restaurant/supplier, not verified by us."""

    NOT_ZABIHAH = "NOT_ZABIHAH"
    """Declared not zabihah."""

    UNSURE = "UNSURE"
    """No clear answer. The default, and not a demerit."""

    NOT_SERVED = "NOT_SERVED"
    """This meat isn't served."""


class Stunning(StrEnum):
    """Optional companion attribute (redefinition doc §10.2). Nullable until we
    capture it; many strict users care about stun vs non-stun."""

    STUNNED = "STUNNED"
    NON_STUNNED = "NON_STUNNED"
    NOT_DISCLOSED = "NOT_DISCLOSED"


class SupplierTier(StrEnum):
    """How well-vetted the supplier fact is — the *company/line* confidence
    axis, parallel to (and independent of) a restaurant's ValidationTier.
    Ordered least → most rigorous.
    """

    LISTED = "LISTED"
    """Added from public info; no document on file. Research floor."""

    CERTIFICATE_ON_FILE = "CERTIFICATE_ON_FILE"
    """Supplier halal cert / third-party audit doc on file, unexpired."""

    TRUST_HALAL_VERIFIED = "TRUST_HALAL_VERIFIED"
    """We traced/audited the plant or its paperwork directly."""


class SourcingEvidence(StrEnum):
    """How well-evidenced a restaurant→product-line sourcing link is.
    Ordered least → most rigorous.
    """

    OWNER_STATED = "OWNER_STATED"
    """The owner's word only."""

    DOCUMENTED = "DOCUMENTED"
    """Invoice / receipt / supplier letter on file naming this restaurant."""

    VERIFIER_CONFIRMED = "VERIFIER_CONFIRMED"
    """A verifier saw the sourcing evidence in person on a visit."""


class MethodConfidence(StrEnum):
    """The shared 3-rung ladder onto which SupplierTier and SourcingEvidence
    both map, so the composition rule can take the **minimum** across the whole
    chain (supplier vetting × line vetting × sourcing evidence). This is what a
    consumer surface renders; never above VERIFIED unless every link is.
    """

    SELF_STATED = "SELF_STATED"
    DOCUMENTED = "DOCUMENTED"
    VERIFIED = "VERIFIED"


class LinkSource(StrEnum):
    """How a place↔product sourcing link came to exist."""

    OWNER_CLAIM = "OWNER_CLAIM"
    VERIFIER_VISIT = "VERIFIER_VISIT"
    ADMIN = "ADMIN"


class SupplierEventType(StrEnum):
    """Append-only audit log on a supplier — provenance + a visible correction
    trail (the trust mechanism for claims about named third parties)."""

    LISTED = "LISTED"
    VERIFIED = "VERIFIED"
    CERT_UPDATED = "CERT_UPDATED"
    LINE_ADDED = "LINE_ADDED"
    REVOKED = "REVOKED"
    CORRECTED = "CORRECTED"


class SupplierAttachmentType(StrEnum):
    """Evidence attached to a supplier or one of its product lines."""

    HALAL_CERTIFICATE = "HALAL_CERTIFICATE"
    AUDIT_REPORT = "AUDIT_REPORT"
    SUPPLIER_LETTER = "SUPPLIER_LETTER"
    INVOICE = "INVOICE"
    PHOTO = "PHOTO"
    OTHER = "OTHER"
