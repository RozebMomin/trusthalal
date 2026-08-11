"""Method-confidence composition.

Two layers:
  * **Pure** (no DB): the composition math in
    ``app.modules.suppliers.provenance`` — the honesty rule lives here, so most
    of the coverage is here and needs no Postgres.
  * **DB**: ``resolve_place_method`` wiring — live-link filtering + profile
    fallback — exercised with a place, a supplier, and a link.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.modules.suppliers.enums import (
    LinkSource,
    MethodConfidence,
    SlaughterMethod,
    SourcingEvidence,
    SupplierTier,
)
from app.modules.halal_profiles.models import HalalProfile
from app.modules.suppliers.models import (
    PlaceSupplierLink,
    Supplier,
    SupplierProduct,
)
from app.modules.suppliers.provenance import (
    LinkCandidate,
    canonicalize_profile_method,
    composed_confidence,
    resolve_method,
)
from app.modules.suppliers.repo import resolve_place_method


T_OLD = datetime(2026, 1, 1, tzinfo=timezone.utc)
T_NEW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def _cand(supplier_tier, line_tier, evidence, method="HAND_CUT", **kw) -> LinkCandidate:
    return LinkCandidate(
        method=method,
        supplier_tier=supplier_tier,
        line_tier=line_tier,
        evidence_tier=evidence,
        **kw,
    )


# ---------------------------------------------------------------------------
# Pure composition
# ---------------------------------------------------------------------------
def test_weaker_link_governs():
    # A fully-verified supplier reached by an owner's-word link is only self-stated.
    c = _cand("TRUST_HALAL_VERIFIED", "TRUST_HALAL_VERIFIED", "OWNER_STATED")
    assert composed_confidence(c) == MethodConfidence.SELF_STATED


def test_line_cannot_outrank_company():
    # A "verified" line under a merely-listed company can't exceed the company.
    c = _cand("LISTED", "TRUST_HALAL_VERIFIED", "VERIFIER_CONFIRMED")
    assert composed_confidence(c) == MethodConfidence.SELF_STATED


def test_all_top_is_verified():
    c = _cand("TRUST_HALAL_VERIFIED", "TRUST_HALAL_VERIFIED", "VERIFIER_CONFIRMED")
    assert composed_confidence(c) == MethodConfidence.VERIFIED


def test_documented_middle_rung():
    c = _cand("CERTIFICATE_ON_FILE", "CERTIFICATE_ON_FILE", "DOCUMENTED")
    assert composed_confidence(c) == MethodConfidence.DOCUMENTED


def test_best_evidenced_candidate_wins():
    weak = _cand("LISTED", "LISTED", "OWNER_STATED", method="MACHINE_CUT",
                 supplier_name="weak", link_last_confirmed_at=T_NEW)
    strong = _cand("TRUST_HALAL_VERIFIED", "TRUST_HALAL_VERIFIED", "VERIFIER_CONFIRMED",
                   method="HAND_CUT", supplier_name="strong",
                   product_last_verified_at=T_OLD, link_last_confirmed_at=T_NEW)
    res = resolve_method([weak, strong], fallback_method=None)
    assert res.source == "supplier"
    assert res.method == "HAND_CUT"
    assert res.confidence == MethodConfidence.VERIFIED
    assert res.supplier_name == "strong"
    # as_of is the OLDER of product/link freshness.
    assert res.as_of == T_OLD


def test_tie_break_prefers_newest_link():
    older = _cand("LISTED", "LISTED", "OWNER_STATED", method="HAND_CUT",
                  supplier_name="older", link_last_confirmed_at=T_OLD)
    newer = _cand("LISTED", "LISTED", "OWNER_STATED", method="MACHINE_CUT",
                  supplier_name="newer", link_last_confirmed_at=T_NEW)
    res = resolve_method([older, newer], fallback_method=None)
    assert res.supplier_name == "newer"


def test_fallback_to_self_attested():
    res = resolve_method([], fallback_method="HAND_CUT", fallback_as_of=T_OLD)
    assert res.source == "self_attested"
    assert res.method == "HAND_CUT"
    assert res.confidence == MethodConfidence.SELF_STATED
    assert res.as_of == T_OLD
    assert res.supplier_id is None


def test_empty_without_fallback_is_not_disclosed():
    res = resolve_method([], fallback_method=None)
    assert res.method == SlaughterMethod.NOT_DISCLOSED.value
    assert res.source == "self_attested"


def test_profile_vocab_bridge():
    assert canonicalize_profile_method("HAND_CUT") == "HAND_CUT"
    assert canonicalize_profile_method("MACHINE_CUT") == "MACHINE_CUT"
    assert canonicalize_profile_method("NOT_SERVED") is None
    assert canonicalize_profile_method(None) is None


# ---------------------------------------------------------------------------
# DB resolver wiring
# ---------------------------------------------------------------------------
def _supplier_with_line(
    db,
    *,
    slug: str,
    supplier_tier=SupplierTier.LISTED,
    line_tier=SupplierTier.LISTED,
    method=SlaughterMethod.HAND_CUT,
    meat="CHICKEN",
    revoked=False,
) -> SupplierProduct:
    sup = Supplier(
        name=slug,
        slug=slug,
        verification_tier=supplier_tier.value,
        revoked_at=datetime.now(timezone.utc) if revoked else None,
    )
    db.add(sup)
    db.flush()
    prod = SupplierProduct(
        supplier_id=sup.id,
        meat_type=meat,
        product_name=f"{meat.lower()}",
        slaughter_method=method.value,
        line_tier=line_tier.value,
    )
    db.add(prod)
    db.flush()
    return prod


def _link(db, *, place_id, product, evidence=SourcingEvidence.OWNER_STATED,
          ended=False, expires=None):
    link = PlaceSupplierLink(
        place_id=place_id,
        supplier_product_id=product.id,
        meat_type=product.meat_type,
        evidence_tier=evidence.value,
        source=LinkSource.ADMIN.value,
        ended_at=datetime.now(timezone.utc) if ended else None,
        expires_at=expires,
    )
    db.add(link)
    db.flush()
    return link


def test_resolve_uses_live_supplier_link(db_session, factories):
    place = factories.place()
    prod = _supplier_with_line(
        db_session, slug="crescent-x",
        supplier_tier=SupplierTier.TRUST_HALAL_VERIFIED,
        line_tier=SupplierTier.TRUST_HALAL_VERIFIED,
        method=SlaughterMethod.HAND_CUT,
    )
    _link(db_session, place_id=place.id, product=prod,
          evidence=SourcingEvidence.VERIFIER_CONFIRMED)
    db_session.commit()

    res = resolve_place_method(db_session, place_id=place.id, meat_type="CHICKEN")
    assert res.source == "supplier"
    assert res.method == "HAND_CUT"
    assert res.confidence == MethodConfidence.VERIFIED
    assert res.supplier_name == "crescent-x"


def test_owner_stated_link_stays_self_stated(db_session, factories):
    place = factories.place()
    prod = _supplier_with_line(
        db_session, slug="crescent-y",
        supplier_tier=SupplierTier.TRUST_HALAL_VERIFIED,
        line_tier=SupplierTier.TRUST_HALAL_VERIFIED,
    )
    _link(db_session, place_id=place.id, product=prod,
          evidence=SourcingEvidence.OWNER_STATED)
    db_session.commit()

    res = resolve_place_method(db_session, place_id=place.id, meat_type="CHICKEN")
    # Verified supplier, but only the owner's word it's sourced here.
    assert res.confidence == MethodConfidence.SELF_STATED
    assert res.method == "HAND_CUT"


def test_revoked_supplier_is_ignored(db_session, factories):
    place = factories.place()
    prod = _supplier_with_line(db_session, slug="gone", revoked=True)
    _link(db_session, place_id=place.id, product=prod)
    db_session.commit()

    res = resolve_place_method(db_session, place_id=place.id, meat_type="CHICKEN")
    # No profile either → not disclosed, self-attested.
    assert res.source == "self_attested"
    assert res.method == "NOT_DISCLOSED"


def test_ended_and_expired_links_are_ignored(db_session, factories):
    place = factories.place()
    prod = _supplier_with_line(db_session, slug="switched")
    _link(db_session, place_id=place.id, product=prod, ended=True)
    prod2 = _supplier_with_line(db_session, slug="stale")
    _link(db_session, place_id=place.id, product=prod2,
          expires=datetime.now(timezone.utc) - timedelta(days=1))
    db_session.commit()

    res = resolve_place_method(db_session, place_id=place.id, meat_type="CHICKEN")
    assert res.source == "self_attested"
    assert res.method == "NOT_DISCLOSED"


# ---------------------------------------------------------------------------
# Read-path: GET /places/{id} embeds supplier_provenance
# ---------------------------------------------------------------------------
def _profile(db, place_id, **cols):
    db.add(HalalProfile(place_id=place_id, menu_posture="FULLY_HALAL", **cols))
    db.commit()


def test_place_read_provenance_self_attested(api, factories, db_session):
    """No sourcing link → the profile's own value, canonicalised
    (ZABIHAH -> HAND_CUT) and marked self-attested."""
    place = factories.place()
    _profile(db_session, place.id, chicken_slaughter="HAND_CUT")

    body = api.get(f"/places/{place.id}").json()
    prov = {p["meat_type"]: p for p in body["halal_profile"]["supplier_provenance"]}
    assert prov["CHICKEN"]["method"] == "HAND_CUT"
    assert prov["CHICKEN"]["source"] == "self_attested"
    assert prov["CHICKEN"]["confidence"] == "SELF_STATED"
    # NOT_SERVED meats are omitted.
    assert "BEEF" not in prov


def test_place_read_provenance_supplier_backed(api, factories, db_session):
    place = factories.place()
    _profile(db_session, place.id, chicken_slaughter="HAND_CUT")
    prod = _supplier_with_line(
        db_session,
        slug="crescent-read",
        supplier_tier=SupplierTier.TRUST_HALAL_VERIFIED,
        line_tier=SupplierTier.TRUST_HALAL_VERIFIED,
        method=SlaughterMethod.HAND_CUT,
    )
    _link(db_session, place_id=place.id, product=prod,
          evidence=SourcingEvidence.VERIFIER_CONFIRMED)
    db_session.commit()

    body = api.get(f"/places/{place.id}").json()
    chicken = next(
        p for p in body["halal_profile"]["supplier_provenance"]
        if p["meat_type"] == "CHICKEN"
    )
    assert chicken["source"] == "supplier"
    assert chicken["method"] == "HAND_CUT"
    assert chicken["confidence"] == "VERIFIED"
    assert chicken["supplier_name"] == "crescent-read"


# ---------------------------------------------------------------------------
# GET /places?supplier_verified=true
# ---------------------------------------------------------------------------
def test_supplier_verified_search_filter(api, factories, db_session):
    a = factories.place(name="ZZQVERIFIED Alpha")
    b = factories.place(name="ZZQVERIFIED Beta")
    _profile(db_session, a.id, chicken_slaughter="HAND_CUT")
    _profile(db_session, b.id, chicken_slaughter="HAND_CUT")

    # A: DOCUMENTED+ on every rung → passes the filter.
    pa = _supplier_with_line(
        db_session, slug="verified-co",
        supplier_tier=SupplierTier.TRUST_HALAL_VERIFIED,
        line_tier=SupplierTier.TRUST_HALAL_VERIFIED,
    )
    _link(db_session, place_id=a.id, product=pa, evidence=SourcingEvidence.VERIFIER_CONFIRMED)
    # B: only owner-stated against a listed supplier → below threshold, excluded.
    pb = _supplier_with_line(db_session, slug="listed-co")  # LISTED/LISTED
    _link(db_session, place_id=b.id, product=pb, evidence=SourcingEvidence.OWNER_STATED)
    db_session.commit()

    filtered = api.get("/places", params={"q": "ZZQVERIFIED", "supplier_verified": "true"})
    assert filtered.status_code == 200, filtered.text
    ids = {row["id"] for row in filtered.json()}
    assert str(a.id) in ids
    assert str(b.id) not in ids

    # Unfiltered: both present.
    both = {row["id"] for row in api.get("/places", params={"q": "ZZQVERIFIED"}).json()}
    assert str(a.id) in both and str(b.id) in both
