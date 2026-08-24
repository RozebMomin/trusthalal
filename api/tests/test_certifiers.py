"""Admin certifier-registry tests.

The test DB runs ``alembic upgrade head``, so the 9 seeded certifiers + their
aliases + the ISA adverse event from the registry migration are present.
"""
from __future__ import annotations


def _slugs(body: list[dict]) -> set[str]:
    return {c["slug"] for c in body}


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------


def test_list_returns_seeded_certifiers(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).get("/admin/certifiers")
    assert resp.status_code == 200, resp.text
    slugs = _slugs(resp.json())
    # All nine seeded bodies present.
    assert {"hto", "ifanca", "ifancc", "isa", "hfsaa", "hms", "sbny", "cdial", "fambras"} <= slugs


def test_resolve_matches_alias_case_insensitively(api, factories):
    admin = factories.admin()
    # Exact recorded free-text string from the audit should resolve.
    r = api.as_user(admin).get("/admin/certifiers/resolve", params={"name": "ISA / ISNA"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["matched"] is True
    assert body["certifier"]["slug"] == "isa"

    # Case-insensitive.
    r2 = api.as_user(admin).get("/admin/certifiers/resolve", params={"name": "ifanca"})
    assert r2.json()["certifier"]["slug"] == "ifanca"


def test_resolve_unknown_body_returns_unmatched(api, factories):
    admin = factories.admin()
    r = api.as_user(admin).get("/admin/certifiers/resolve", params={"name": "Totally Made Up Board"})
    assert r.status_code == 200
    body = r.json()
    assert body["matched"] is False
    assert body["certifier"] is None


def test_isa_carries_the_conviction_adverse_event(api, factories):
    admin = factories.admin()
    listing = api.as_user(admin).get("/admin/certifiers").json()
    isa = next(c for c in listing if c["slug"] == "isa")
    assert isa["adverse_event_count"] >= 1

    detail = api.as_user(admin).get(f"/admin/certifiers/{isa['id']}").json()
    events = detail["adverse_events"]
    assert len(events) >= 1
    assert events[0]["event_type"] == "CONVICTION"
    assert "Midamar" in events[0]["summary"]


def test_crescent_bodies_share_one_legal_entity(api, factories):
    # HMS and "Shariah Board of America" are program names of one legal entity.
    admin = factories.admin()
    hms = api.as_user(admin).get(
        "/admin/certifiers/resolve", params={"name": "Shariah Board of America"}
    ).json()
    assert hms["matched"] is True
    assert hms["certifier"]["slug"] == "hms"
    assert hms["certifier"]["legal_entity"] == "Rahmat-e-Alam Foundation"


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def test_create_certifier_with_aliases_and_adverse_event(api, factories):
    admin = factories.admin()
    created = api.as_user(admin).post(
        "/admin/certifiers",
        json={
            "slug": "test-board",
            "name": "Test Halal Board",
            "legal_entity": "Test Foundation",
            "country_code": "US",
            "aliases": ["THB", "Test Halal Board", "THB "],  # dupe/whitespace collapse
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    cid = body["id"]
    # "THB" and "THB " dedupe to one.
    assert {a["alias"] for a in body["aliases"]} == {"THB", "Test Halal Board"}

    # New alias resolves.
    api.as_user(admin).post(f"/admin/certifiers/{cid}/aliases", json={"alias": "Test Board"})
    r = api.as_user(admin).get("/admin/certifiers/resolve", params={"name": "Test Board"})
    assert r.json()["certifier"]["slug"] == "test-board"

    # Adverse event.
    ev = api.as_user(admin).post(
        f"/admin/certifiers/{cid}/adverse-events",
        json={"event_type": "DISPUTE", "summary": "A documented dispute.",
              "source_url": "https://example.org/x"},
    )
    assert ev.status_code == 201, ev.text
    assert ev.json()["adverse_event_count"] == 1


def test_patch_certifier(api, factories):
    admin = factories.admin()
    listing = api.as_user(admin).get("/admin/certifiers").json()
    ifancc = next(c for c in listing if c["slug"] == "ifancc")
    r = api.as_user(admin).patch(
        f"/admin/certifiers/{ifancc['id']}", json={"notes": "JS-gated site; unverifiable."}
    )
    assert r.status_code == 200, r.text
    assert r.json()["notes"] == "JS-gated site; unverifiable."


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def test_certifiers_admin_only(api, factories):
    consumer = factories.consumer()
    assert api.as_user(consumer).get("/admin/certifiers").status_code == 403
    assert api.get("/admin/certifiers").status_code == 401
