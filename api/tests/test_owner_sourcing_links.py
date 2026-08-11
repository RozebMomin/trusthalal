"""Owner-attached supplier links: the approval-time sync + the public search."""
from __future__ import annotations

from sqlalchemy import func, select

from app.modules.halal_claims.models import HalalClaim
from app.modules.suppliers.models import (
    PlaceSupplierLink,
    Supplier,
    SupplierProduct,
)
from app.modules.suppliers.owner_links import sync_owner_sourcing_links


def _product(db, *, slug="crescent-owner", meat="CHICKEN", revoked=False) -> SupplierProduct:
    from datetime import datetime, timezone

    sup = Supplier(
        name=slug,
        slug=slug,
        verification_tier="TRUST_HALAL_VERIFIED",
        revoked_at=datetime.now(timezone.utc) if revoked else None,
    )
    db.add(sup)
    db.flush()
    prod = SupplierProduct(
        supplier_id=sup.id,
        meat_type=meat,
        product_name=meat.lower(),
        slaughter_method="HAND_CUT",
        line_tier="TRUST_HALAL_VERIFIED",
    )
    db.add(prod)
    db.flush()
    return prod


def _claim(db, *, place_id, meat_products) -> HalalClaim:
    claim = HalalClaim(
        place_id=place_id,
        claim_type="INITIAL",
        structured_response={"meat_products": meat_products},
    )
    db.add(claim)
    db.flush()
    return claim


def _live_links(db, place_id) -> int:
    return db.execute(
        select(func.count())
        .select_from(PlaceSupplierLink)
        .where(
            PlaceSupplierLink.place_id == place_id,
            PlaceSupplierLink.ended_at.is_(None),
        )
    ).scalar_one()


# ---------------------------------------------------------------------------
# sync_owner_sourcing_links
# ---------------------------------------------------------------------------
def test_sync_creates_owner_stated_link(db_session, factories):
    place = factories.place()
    prod = _product(db_session)
    claim = _claim(
        db_session,
        place_id=place.id,
        meat_products=[{"meat_type": "CHICKEN", "supplier_product_id": str(prod.id)}],
    )

    created = sync_owner_sourcing_links(db_session, place_id=place.id, claim=claim)
    db_session.commit()

    assert created == 1
    link = db_session.execute(
        select(PlaceSupplierLink).where(PlaceSupplierLink.place_id == place.id)
    ).scalar_one()
    assert link.supplier_product_id == prod.id
    assert link.evidence_tier == "OWNER_STATED"
    assert link.source == "OWNER_CLAIM"
    assert link.source_claim_id == claim.id


def test_sync_is_idempotent(db_session, factories):
    place = factories.place()
    prod = _product(db_session, slug="idem")
    claim = _claim(
        db_session,
        place_id=place.id,
        meat_products=[{"meat_type": "CHICKEN", "supplier_product_id": str(prod.id)}],
    )
    assert sync_owner_sourcing_links(db_session, place_id=place.id, claim=claim) == 1
    db_session.commit()
    # Second run creates nothing.
    assert sync_owner_sourcing_links(db_session, place_id=place.id, claim=claim) == 0
    db_session.commit()
    assert _live_links(db_session, place.id) == 1


def test_sync_skips_meat_mismatch(db_session, factories):
    place = factories.place()
    prod = _product(db_session, slug="mismatch", meat="CHICKEN")
    claim = _claim(
        db_session,
        place_id=place.id,
        # Entry claims BEEF but the linked line is CHICKEN.
        meat_products=[{"meat_type": "BEEF", "supplier_product_id": str(prod.id)}],
    )
    assert sync_owner_sourcing_links(db_session, place_id=place.id, claim=claim) == 0


def test_sync_skips_revoked_and_missing(db_session, factories):
    place = factories.place()
    revoked = _product(db_session, slug="revoked-owner", revoked=True)
    claim = _claim(
        db_session,
        place_id=place.id,
        meat_products=[
            {"meat_type": "CHICKEN", "supplier_product_id": str(revoked.id)},
            {"meat_type": "CHICKEN", "supplier_product_id": "00000000-0000-0000-0000-000000000000"},
            {"meat_type": "BEEF"},  # no supplier_product_id at all
        ],
    )
    assert sync_owner_sourcing_links(db_session, place_id=place.id, claim=claim) == 0


# ---------------------------------------------------------------------------
# GET /suppliers (authenticated search)
# ---------------------------------------------------------------------------
def test_search_requires_auth(api):
    assert api.get("/suppliers").status_code in (401, 403)


def test_search_returns_suppliers_with_meat_filter(api, factories, db_session):
    consumer = factories.consumer()
    _product(db_session, slug="poultry-co", meat="CHICKEN")
    beef = Supplier(name="Beef Co", slug="beef-co", verification_tier="LISTED")
    db_session.add(beef)
    db_session.flush()
    db_session.add(
        SupplierProduct(
            supplier_id=beef.id, meat_type="BEEF", product_name="beef",
            slaughter_method="HAND_CUT", line_tier="LISTED",
        )
    )
    db_session.commit()

    # Meat filter returns only suppliers carrying that meat, and only those lines.
    resp = api.as_user(consumer).get("/suppliers", params={"meat": "CHICKEN"})
    assert resp.status_code == 200, resp.text
    slugs = {s["slug"] for s in resp.json()}
    assert "poultry-co" in slugs
    assert "beef-co" not in slugs
    poultry = next(s for s in resp.json() if s["slug"] == "poultry-co")
    assert all(p["meat_type"] == "CHICKEN" for p in poultry["products"])


def test_search_excludes_revoked(api, factories, db_session):
    consumer = factories.consumer()
    _product(db_session, slug="gone-owner", revoked=True)
    db_session.commit()
    resp = api.as_user(consumer).get("/suppliers", params={"q": "gone-owner"})
    assert resp.status_code == 200
    assert resp.json() == []
