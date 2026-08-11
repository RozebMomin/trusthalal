"""Integration tests for admin place → supplier-product sourcing links."""
from __future__ import annotations

from app.modules.suppliers.models import Supplier, SupplierProduct


def _supplier_product(db, *, slug="crescent-link", meat="CHICKEN", method="HAND_CUT") -> SupplierProduct:
    sup = Supplier(name=slug, slug=slug, verification_tier="TRUST_HALAL_VERIFIED")
    db.add(sup)
    db.flush()
    prod = SupplierProduct(
        supplier_id=sup.id,
        meat_type=meat,
        product_name=meat.lower(),
        slaughter_method=method,
        line_tier="TRUST_HALAL_VERIFIED",
    )
    db.add(prod)
    db.flush()
    db.commit()
    return prod


def test_create_and_list_link(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()
    prod = _supplier_product(db_session)

    resp = api.as_user(admin).post(
        f"/admin/places/{place.id}/supplier-links",
        json={"supplier_product_id": str(prod.id), "evidence_tier": "VERIFIER_CONFIRMED"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["meat_type"] == "CHICKEN"
    assert body["source"] == "ADMIN"
    assert body["supplier_name"] == "crescent-link"
    assert body["slaughter_method"] == "HAND_CUT"

    listing = api.as_user(admin).get(f"/admin/places/{place.id}/supplier-links").json()
    assert len(listing) == 1
    assert listing[0]["evidence_tier"] == "VERIFIER_CONFIRMED"


def test_duplicate_live_link_conflict(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()
    prod = _supplier_product(db_session, slug="dup")

    first = api.as_user(admin).post(
        f"/admin/places/{place.id}/supplier-links",
        json={"supplier_product_id": str(prod.id)},
    )
    assert first.status_code == 201
    dup = api.as_user(admin).post(
        f"/admin/places/{place.id}/supplier-links",
        json={"supplier_product_id": str(prod.id)},
    )
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "PLACE_SUPPLIER_LINK_EXISTS"


def test_patch_and_end_link(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()
    prod = _supplier_product(db_session, slug="patchme")

    link = api.as_user(admin).post(
        f"/admin/places/{place.id}/supplier-links",
        json={"supplier_product_id": str(prod.id), "evidence_tier": "OWNER_STATED"},
    ).json()

    patched = api.as_user(admin).patch(
        f"/admin/places/{place.id}/supplier-links/{link['id']}",
        json={"evidence_tier": "DOCUMENTED", "note": "invoice on file"},
    )
    assert patched.status_code == 200
    assert patched.json()["evidence_tier"] == "DOCUMENTED"
    assert patched.json()["note"] == "invoice on file"

    ended = api.as_user(admin).delete(
        f"/admin/places/{place.id}/supplier-links/{link['id']}"
    )
    assert ended.status_code == 204

    # Default list excludes ended; include_ended surfaces it.
    assert api.as_user(admin).get(f"/admin/places/{place.id}/supplier-links").json() == []
    all_links = api.as_user(admin).get(
        f"/admin/places/{place.id}/supplier-links", params={"include_ended": "true"}
    ).json()
    assert len(all_links) == 1
    assert all_links[0]["ended_at"] is not None


def test_unknown_product_404(api, factories):
    admin = factories.admin()
    place = factories.place()
    resp = api.as_user(admin).post(
        f"/admin/places/{place.id}/supplier-links",
        json={"supplier_product_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "SUPPLIER_PRODUCT_NOT_FOUND"


def test_admin_only(api, factories, db_session):
    consumer = factories.consumer()
    place = factories.place()
    resp = api.as_user(consumer).get(f"/admin/places/{place.id}/supplier-links")
    assert resp.status_code in (401, 403)
