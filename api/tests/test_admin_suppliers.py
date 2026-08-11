"""Integration tests for the admin supplier registry endpoints."""
from __future__ import annotations

from datetime import datetime, timezone

from app.modules.suppliers.models import PlaceSupplierLink


SUPPLIER = {
    "name": "Crescent Foods",
    "slug": "crescent-foods",
    "aliases": ["Crescent", "Crescent Hand-Cut"],
    "city": "Chicago",
    "region": "IL",
    "country_code": "US",
    "verification_tier": "LISTED",
    "certifying_body_name": "HMS",
    "products": [
        {
            "meat_type": "CHICKEN",
            "product_name": "chicken",
            "slaughter_method": "HAND_CUT",
            "line_tier": "LISTED",
            "stunning": "NON_STUNNED",
            "source_url": "https://crescentfoods.com/our-process/",
        }
    ],
}


def _create(api, admin, **overrides):
    body = {**SUPPLIER, **overrides}
    return api.as_user(admin).post("/admin/suppliers", json=body)


# ---------------------------------------------------------------------------
# Create / read
# ---------------------------------------------------------------------------
def test_create_and_get_supplier(api, factories):
    admin = factories.admin()
    resp = _create(api, admin)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["slug"] == "crescent-foods"
    assert body["product_count"] == 1
    assert body["products"][0]["slaughter_method"] == "HAND_CUT"
    supplier_id = body["id"]

    got = api.as_user(admin).get(f"/admin/suppliers/{supplier_id}")
    assert got.status_code == 200, got.text
    assert got.json()["products"][0]["meat_type"] == "CHICKEN"


def test_create_slug_conflict(api, factories):
    admin = factories.admin()
    assert _create(api, admin).status_code == 201
    dup = _create(api, admin, name="Crescent Two")
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "SUPPLIER_SLUG_TAKEN"


# ---------------------------------------------------------------------------
# List: search + method filter + revoked exclusion
# ---------------------------------------------------------------------------
def test_list_search_and_method_filter(api, factories):
    admin = factories.admin()
    _create(api, admin)
    _create(
        api,
        admin,
        name="Farmer Focus",
        slug="farmer-focus",
        aliases=[],
        products=[
            {
                "meat_type": "CHICKEN",
                "product_name": "chicken",
                "slaughter_method": "MACHINE_CUT",
            }
        ],
    )

    # alias search finds Crescent
    r = api.as_user(admin).get("/admin/suppliers", params={"q": "hand-cut"})
    assert r.status_code == 200
    assert [s["slug"] for s in r.json()] == ["crescent-foods"]

    # method filter returns only the machine-cut supplier
    r = api.as_user(admin).get("/admin/suppliers", params={"method": "MACHINE_CUT"})
    assert [s["slug"] for s in r.json()] == ["farmer-focus"]


# ---------------------------------------------------------------------------
# Patch tier logs an event
# ---------------------------------------------------------------------------
def test_patch_tier_logs_event(api, factories):
    admin = factories.admin()
    sid = _create(api, admin).json()["id"]

    r = api.as_user(admin).patch(
        f"/admin/suppliers/{sid}", json={"verification_tier": "CERTIFICATE_ON_FILE"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["verification_tier"] == "CERTIFICATE_ON_FILE"

    events = api.as_user(admin).get(f"/admin/suppliers/{sid}/events").json()
    assert any(e["event_type"] == "VERIFIED" for e in events)
    assert any(e["event_type"] == "LISTED" for e in events)  # the create event


# ---------------------------------------------------------------------------
# Revoke / restore
# ---------------------------------------------------------------------------
def test_revoke_and_restore(api, factories):
    admin = factories.admin()
    sid = _create(api, admin).json()["id"]

    rev = api.as_user(admin).post(
        f"/admin/suppliers/{sid}/revoke", json={"reason": "Plant closed."}
    )
    assert rev.status_code == 200
    assert rev.json()["revoked_at"] is not None

    # Excluded from the default list, present with include_revoked.
    default = api.as_user(admin).get("/admin/suppliers").json()
    assert sid not in [s["id"] for s in default]
    withrev = api.as_user(admin).get(
        "/admin/suppliers", params={"include_revoked": "true"}
    ).json()
    assert sid in [s["id"] for s in withrev]

    back = api.as_user(admin).post(f"/admin/suppliers/{sid}/restore")
    assert back.status_code == 200
    assert back.json()["revoked_at"] is None


# ---------------------------------------------------------------------------
# Product lines: add / patch / delete
# ---------------------------------------------------------------------------
def test_add_patch_delete_product(api, factories):
    admin = factories.admin()
    sid = _create(api, admin).json()["id"]

    add = api.as_user(admin).post(
        f"/admin/suppliers/{sid}/products",
        json={"meat_type": "BEEF", "product_name": "ground beef", "slaughter_method": "HAND_CUT"},
    )
    assert add.status_code == 201, add.text
    pid = add.json()["id"]

    patched = api.as_user(admin).patch(
        f"/admin/suppliers/{sid}/products/{pid}",
        json={"slaughter_method": "MACHINE_CUT"},
    )
    assert patched.status_code == 200
    assert patched.json()["slaughter_method"] == "MACHINE_CUT"

    deleted = api.as_user(admin).delete(f"/admin/suppliers/{sid}/products/{pid}")
    assert deleted.status_code == 204

    detail = api.as_user(admin).get(f"/admin/suppliers/{sid}").json()
    assert all(p["id"] != pid for p in detail["products"])


def test_delete_product_in_use_is_blocked(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()
    detail = _create(api, admin).json()
    product_id = detail["products"][0]["id"]

    # A restaurant sources this line — deletion must be refused.
    db_session.add(
        PlaceSupplierLink(
            place_id=place.id,
            supplier_product_id=product_id,
            meat_type="CHICKEN",
            evidence_tier="OWNER_STATED",
            source="ADMIN",
        )
    )
    db_session.commit()

    resp = api.as_user(admin).delete(
        f"/admin/suppliers/{detail['id']}/products/{product_id}"
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "SUPPLIER_PRODUCT_IN_USE"


# ---------------------------------------------------------------------------
# AuthZ + validation
# ---------------------------------------------------------------------------
def test_admin_only(api, factories):
    consumer = factories.consumer()
    resp = api.as_user(consumer).get("/admin/suppliers")
    assert resp.status_code in (401, 403)


def test_validation(api, factories):
    admin = factories.admin()
    # bad slug (uppercase/space) → 422
    bad_slug = api.as_user(admin).post(
        "/admin/suppliers", json={"name": "X", "slug": "Not A Slug"}
    )
    assert bad_slug.status_code == 422
    # unknown field → 422 (extra="forbid")
    extra = api.as_user(admin).post(
        "/admin/suppliers", json={"name": "X", "slug": "x", "nope": 1}
    )
    assert extra.status_code == 422
