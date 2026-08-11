"""Method-confidence composition — the core honesty rule, kept PURE.

Given a served meat at a place, decide which slaughter method to show and with
what confidence. The one rule that matters (docs/2026-08-11-supplier-provenance-plan.md
§4): confidence is the **minimum** across the whole provenance chain —

    company vetting × product-line vetting × sourcing-link evidence

— so a rock-solid supplier fact reached by an owner's-word link is still only
"self-stated." A supplier link never launders a flimsy sourcing claim, and it
never touches the restaurant's ValidationTier (separate axis).

This module has **no database imports on purpose**: it operates on plain
``LinkCandidate`` records so it runs anywhere and unit-tests without Postgres.
The DB glue (fetch live links + profile fallback) lives in ``repo.py`` and
calls ``resolve_method`` here.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Sequence

from app.modules.halal_profiles.enums import SlaughterMethod as ProfileSlaughterMethod
from app.modules.suppliers.enums import (
    MethodConfidence,
    SlaughterMethod,
    SourcingEvidence,
    SupplierTier,
)

# --- the shared ladder -----------------------------------------------------
# SELF_STATED < DOCUMENTED < VERIFIED. Both the supplier tier and the sourcing
# evidence map onto it; the composed confidence is the minimum rung.
_RANK: dict[MethodConfidence, int] = {
    MethodConfidence.SELF_STATED: 1,
    MethodConfidence.DOCUMENTED: 2,
    MethodConfidence.VERIFIED: 3,
}
_BY_RANK: dict[int, MethodConfidence] = {v: k for k, v in _RANK.items()}

_SUPPLIER_TIER_CONFIDENCE: dict[SupplierTier, MethodConfidence] = {
    SupplierTier.LISTED: MethodConfidence.SELF_STATED,
    SupplierTier.CERTIFICATE_ON_FILE: MethodConfidence.DOCUMENTED,
    SupplierTier.TRUST_HALAL_VERIFIED: MethodConfidence.VERIFIED,
}
_EVIDENCE_CONFIDENCE: dict[SourcingEvidence, MethodConfidence] = {
    SourcingEvidence.OWNER_STATED: MethodConfidence.SELF_STATED,
    SourcingEvidence.DOCUMENTED: MethodConfidence.DOCUMENTED,
    SourcingEvidence.VERIFIER_CONFIRMED: MethodConfidence.VERIFIED,
}

# Map the profile's SlaughterMethod onto the suppliers' SlaughterMethod. Since
# the vocab-rename migration, the two enums share values (HAND_CUT/MACHINE_CUT),
# so this is a pass-through across the two enum classes. NOT_SERVED is
# intentionally absent — that meat isn't served, so there's nothing to resolve.
_PROFILE_TO_CANONICAL: dict[ProfileSlaughterMethod, SlaughterMethod] = {
    ProfileSlaughterMethod.HAND_CUT: SlaughterMethod.HAND_CUT,
    ProfileSlaughterMethod.MACHINE_CUT: SlaughterMethod.MACHINE_CUT,
}

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def tier_confidence(tier: str) -> MethodConfidence:
    """SupplierTier → ladder. Unknown/None degrades to the floor, never up."""
    return _SUPPLIER_TIER_CONFIDENCE.get(SupplierTier(tier), MethodConfidence.SELF_STATED) \
        if tier in SupplierTier._value2member_map_ else MethodConfidence.SELF_STATED


def evidence_confidence(evidence: str) -> MethodConfidence:
    """SourcingEvidence → ladder. Unknown/None degrades to the floor."""
    return _EVIDENCE_CONFIDENCE.get(SourcingEvidence(evidence), MethodConfidence.SELF_STATED) \
        if evidence in SourcingEvidence._value2member_map_ else MethodConfidence.SELF_STATED


def min_confidence(*confidences: MethodConfidence) -> MethodConfidence:
    """The weaker rung governs."""
    return _BY_RANK[min(_RANK[c] for c in confidences)]


def canonicalize_profile_method(raw: Optional[str]) -> Optional[str]:
    """Map a legacy per-meat profile value to the canonical vocabulary.

    Returns the new ``SlaughterMethod`` value, or ``None`` when the meat isn't
    served / the value is unknown (caller treats as not-disclosed).
    """
    if raw is None:
        return None
    if raw not in ProfileSlaughterMethod._value2member_map_:
        return None
    canonical = _PROFILE_TO_CANONICAL.get(ProfileSlaughterMethod(raw))
    return canonical.value if canonical is not None else None


@dataclass(frozen=True, slots=True)
class LinkCandidate:
    """One live sourcing link, flattened to just what composition needs.

    ``method`` is already the canonical vocabulary (supplier tables store it
    natively). Tiers/evidence are the raw enum *values* (strings) — the mappers
    coerce them.
    """

    method: str
    supplier_tier: str
    line_tier: str
    evidence_tier: str
    supplier_id: Optional[uuid.UUID] = None
    supplier_name: Optional[str] = None
    product_last_verified_at: Optional[datetime] = None
    link_last_confirmed_at: Optional[datetime] = None


@dataclass(frozen=True, slots=True)
class MethodResolution:
    """What a consumer surface renders for one served meat."""

    method: str  # SlaughterMethod value
    confidence: MethodConfidence
    as_of: Optional[datetime]
    supplier_id: Optional[uuid.UUID]
    supplier_name: Optional[str]
    source: str  # "supplier" | "self_attested"


def composed_confidence(candidate: LinkCandidate) -> MethodConfidence:
    """The confidence of a single link: min across company, line, and sourcing.

    A product line can never out-rank the company that makes it, and the
    sourcing link can only ever lower the result further.
    """
    effective_supplier = min_confidence(
        tier_confidence(candidate.supplier_tier),
        tier_confidence(candidate.line_tier),
    )
    return min_confidence(effective_supplier, evidence_confidence(candidate.evidence_tier))


def _min_dt(a: Optional[datetime], b: Optional[datetime]) -> Optional[datetime]:
    if a is None:
        return b
    if b is None:
        return a
    return min(a, b)


def resolve_method(
    candidates: Sequence[LinkCandidate],
    *,
    fallback_method: Optional[str],
    fallback_as_of: Optional[datetime] = None,
) -> MethodResolution:
    """Pick the best-evidenced live link, else fall back to self-attestation.

    * Among candidates, the highest composed confidence wins; ties break to the
      most recently confirmed link.
    * ``as_of`` is the older of the product's and the link's freshness dates —
      the claim is only as fresh as its stalest input.
    * No candidates → the owner's self-attested value (``fallback_method``), at
      ``SELF_STATED``. A missing/served-unknown meat resolves to
      ``NOT_DISCLOSED``.
    """
    if candidates:
        best = max(
            candidates,
            key=lambda c: (
                _RANK[composed_confidence(c)],
                c.link_last_confirmed_at or _EPOCH,
            ),
        )
        return MethodResolution(
            method=best.method,
            confidence=composed_confidence(best),
            as_of=_min_dt(best.product_last_verified_at, best.link_last_confirmed_at),
            supplier_id=best.supplier_id,
            supplier_name=best.supplier_name,
            source="supplier",
        )

    return MethodResolution(
        method=fallback_method or SlaughterMethod.NOT_DISCLOSED.value,
        confidence=MethodConfidence.SELF_STATED,
        as_of=fallback_as_of,
        supplier_id=None,
        supplier_name=None,
        source="self_attested",
    )
