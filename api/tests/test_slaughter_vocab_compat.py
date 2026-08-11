"""Backward-compat shim for the slaughter-vocabulary rename.

The stored vocabulary is HAND_CUT / MACHINE_CUT / NOT_SERVED. Clients that
shipped before the rename only understand ZABIHAH / MACHINE and send no header
to identify themselves, so the public place-read embeds default to the legacy
words and only emit the new ones when the caller opts in with
``X-TH-Slaughter-Vocab: v2``.

The ``api`` fixture opts in by default (see conftest), so "modern" here is the
plain client and "legacy" is ``api.as_legacy_slaughter_client()``.
"""
from __future__ import annotations


def _chicken_and_beef():
    # Chicken all hand-cut -> column HAND_CUT; beef machine -> column MACHINE_CUT.
    # Gives us one of each canonical value to check both translations.
    return [
        {
            "meat_type": "CHICKEN",
            "product_name": "Chicken tikka",
            "slaughter_method": "HAND_CUT",
            "supplier_name": "Crescent Foods",
            "supplier_city": "Chicago",
            "supplier_state": "IL",
            "certifying_authority": "IFANCA",
            "certificate_number": "IF-1",
        },
        {
            "meat_type": "BEEF",
            "product_name": "Seekh kebab",
            "slaughter_method": "MACHINE_CUT",
            "supplier_name": "Midamar",
            "supplier_city": "Cedar Rapids",
            "supplier_state": "IA",
            "certifying_authority": "HMS",
            "certificate_number": "HM-2",
        },
    ]


# ---------------------------------------------------------------------------
# Place detail
# ---------------------------------------------------------------------------


def test_detail_modern_client_gets_canonical_vocab(
    api, db_session, approved_claim_profile
):
    profile, _ = approved_claim_profile(_chicken_and_beef())
    db_session.commit()

    body = api.get(f"/places/{profile.place_id}").json()["halal_profile"]
    assert body["chicken_slaughter"] == "HAND_CUT"
    assert body["beef_slaughter"] == "MACHINE_CUT"
    methods = {p["product_name"]: p["slaughter_method"] for p in body["meat_products"]}
    assert methods == {"Chicken tikka": "HAND_CUT", "Seekh kebab": "MACHINE_CUT"}


def test_detail_legacy_client_gets_old_vocab(
    api, db_session, approved_claim_profile
):
    profile, _ = approved_claim_profile(_chicken_and_beef())
    db_session.commit()

    legacy = api.as_legacy_slaughter_client()
    body = legacy.get(f"/places/{profile.place_id}").json()["halal_profile"]

    # Rolled-up columns translated back to the words the old client renders.
    assert body["chicken_slaughter"] == "ZABIHAH"
    assert body["beef_slaughter"] == "MACHINE"

    # Per-product methods translated too.
    methods = {p["product_name"]: p["slaughter_method"] for p in body["meat_products"]}
    assert methods == {"Chicken tikka": "ZABIHAH", "Seekh kebab": "MACHINE"}


def test_legacy_client_provenance_stays_canonical(
    api, db_session, approved_claim_profile
):
    """supplier_provenance always spoke HAND_CUT / MACHINE_CUT — old clients
    already render it — so the shim must NOT rewrite it."""
    profile, _ = approved_claim_profile(_chicken_and_beef())
    db_session.commit()

    legacy = api.as_legacy_slaughter_client()
    body = legacy.get(f"/places/{profile.place_id}").json()["halal_profile"]

    prov = {p["meat_type"]: p["method"] for p in body["supplier_provenance"]}
    assert prov["CHICKEN"] == "HAND_CUT"
    assert prov["BEEF"] == "MACHINE_CUT"


def test_not_served_is_unchanged_for_legacy_clients(
    api, db_session, approved_claim_profile
):
    """NOT_SERVED didn't change across the rename; it must pass through both
    vocabularies untouched."""
    profile, _ = approved_claim_profile([
        {
            "meat_type": "CHICKEN",
            "product_name": "Chicken tikka",
            "slaughter_method": "HAND_CUT",
            "supplier_name": "Crescent Foods",
            "supplier_city": "Chicago",
            "supplier_state": "IL",
            "certifying_authority": "IFANCA",
            "certificate_number": "IF-1",
        },
    ])
    db_session.commit()

    legacy = api.as_legacy_slaughter_client()
    body = legacy.get(f"/places/{profile.place_id}").json()["halal_profile"]
    # No lamb/goat/beef products -> those columns stay NOT_SERVED regardless.
    assert body["beef_slaughter"] == "NOT_SERVED"
    assert body["lamb_slaughter"] == "NOT_SERVED"


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


def _search(client, place):
    r = client.get(
        "/places",
        params={"lat": 40.7128, "lng": -74.006, "radius": 5000, "limit": 200},
    )
    assert r.status_code == 200, r.text
    rows = [row for row in r.json() if row["id"] == str(place.place_id)]
    assert rows, "seeded place should be within 5km of the search origin"
    return rows[0]["halal_profile"]


def test_search_modern_client_gets_canonical_vocab(
    api, db_session, approved_claim_profile
):
    profile, _ = approved_claim_profile(_chicken_and_beef())
    db_session.commit()
    embed = _search(api, profile)
    assert embed["chicken_slaughter"] == "HAND_CUT"
    assert embed["beef_slaughter"] == "MACHINE_CUT"


def test_search_legacy_client_gets_old_vocab(
    api, db_session, approved_claim_profile
):
    profile, _ = approved_claim_profile(_chicken_and_beef())
    db_session.commit()
    embed = _search(api.as_legacy_slaughter_client(), profile)
    assert embed["chicken_slaughter"] == "ZABIHAH"
    assert embed["beef_slaughter"] == "MACHINE"
