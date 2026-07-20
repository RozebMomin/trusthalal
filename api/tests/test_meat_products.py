"""Per-product sourcing on the public halal profile.

The rolled-up ``<meat>_slaughter`` columns are least-conservative-wins, so a
kitchen with zabihah chicken breast and machine-slaughtered nuggets reports
MACHINE for all chicken. Safe to round that way, but it leaves a diner unable
to tell the products apart — and a bare "Chicken · Zabihah" asks to be taken
on faith, which is the thing this platform exists not to do.

These tests pin the two properties that make surfacing it safe: the products
have to agree with the rollup they were derived from, and the payload must not
be able to imply we verified a supplier we never checked.
"""
from __future__ import annotations

from app.modules.halal_profiles.repo import public_meat_products


def _products(**over):
    base = {
        "meat_type": "CHICKEN",
        "product_name": "Chicken tikka",
        "slaughter_method": "ZABIHAH",
        "supplier_name": "Crescent Foods",
        "supplier_city": "Chicago",
        "supplier_state": "IL",
        "certifying_authority": "IFANCA",
        "certificate_number": "IF-99127",
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# Projection
# ---------------------------------------------------------------------------


def test_products_are_read_from_the_source_claim(db_session, approved_claim_profile):
    profile, _ = approved_claim_profile([_products()])
    out = public_meat_products(db_session, profile=profile)
    assert [p.product_name for p in out] == ["Chicken tikka"]
    assert out[0].supplier_name == "Crescent Foods"
    assert out[0].supplier_city == "Chicago"
    assert out[0].certifying_authority == "IFANCA"


def test_certificate_number_is_never_published(db_session, approved_claim_profile):
    """Traceability detail for staff resolving a dispute, not something a
    diner needs — and publishing it hands anyone the string required to
    impersonate the restaurant's paperwork to its certifier."""
    profile, _ = approved_claim_profile([_products()])
    out = public_meat_products(db_session, profile=profile)
    assert not hasattr(out[0], "certificate_number")
    assert "IF-99127" not in out[0].model_dump_json()


def test_not_served_entries_are_dropped(db_session, approved_claim_profile):
    """The questionnaire allows NOT_SERVED for symmetry, but an entry exists
    because the product is served. "Lamb chops: not served" is noise; the
    absent-meats line already covers it."""
    profile, _ = approved_claim_profile([
        _products(),
        _products(meat_type="LAMB", product_name="Lamb chops",
                  slaughter_method="NOT_SERVED"),
    ])
    out = public_meat_products(db_session, profile=profile)
    assert [p.product_name for p in out] == ["Chicken tikka"]


# ---------------------------------------------------------------------------
# The products must never contradict the rollup they produced
# ---------------------------------------------------------------------------


def test_mixed_products_roll_up_to_the_least_conservative(
    db_session, approved_claim_profile
):
    """The case the whole feature exists for. Two chicken products, one
    zabihah and one machine: the column rounds to MACHINE, and the products
    are what let a diner see why."""
    profile, _ = approved_claim_profile([
        _products(product_name="Chicken tikka", slaughter_method="ZABIHAH"),
        _products(product_name="Chicken nuggets", slaughter_method="MACHINE"),
    ])
    assert profile.chicken_slaughter == "MACHINE"

    out = public_meat_products(db_session, profile=profile)
    methods = {p.product_name: p.slaughter_method.value for p in out}
    assert methods == {"Chicken tikka": "ZABIHAH", "Chicken nuggets": "MACHINE"}


# ---------------------------------------------------------------------------
# Degradation — this is supplementary context on a page that must still render
# ---------------------------------------------------------------------------


def test_no_source_claim_returns_empty(db_session, approved_claim_profile):
    """source_claim_id is ON DELETE SET NULL. A claim tidied up in support
    must not 500 the place it belonged to."""
    profile, _ = approved_claim_profile([_products()])
    profile.source_claim_id = None
    db_session.flush()
    assert public_meat_products(db_session, profile=profile) == []


def test_malformed_entry_is_skipped_not_fatal(db_session, approved_claim_profile):
    """Owner-authored JSON that has been through several schema revisions.
    One bad row losing the other five would be the wrong trade."""
    profile, claim = approved_claim_profile([_products()])
    claim.structured_response = {
        "meat_products": [
            {"meat_type": "CHICKEN"},          # missing required fields
            "not-even-a-dict",
            _products(product_name="Seekh kebab", meat_type="BEEF"),
        ]
    }
    db_session.flush()
    out = public_meat_products(db_session, profile=profile)
    assert [p.product_name for p in out] == ["Seekh kebab"]


def test_questionnaire_without_meat_products_returns_empty(
    db_session, approved_claim_profile
):
    profile, claim = approved_claim_profile([_products()])
    claim.structured_response = {"menu_posture": "FULLY_HALAL"}
    db_session.flush()
    assert public_meat_products(db_session, profile=profile) == []


# ---------------------------------------------------------------------------
# Surfaces
# ---------------------------------------------------------------------------


def test_place_detail_includes_products(api, db_session, approved_claim_profile):
    profile, _ = approved_claim_profile([_products()])
    db_session.commit()
    r = api.get(f"/places/{profile.place_id}")
    assert r.status_code == 200, r.text
    products = r.json()["halal_profile"]["meat_products"]
    assert [p["product_name"] for p in products] == ["Chicken tikka"]
    assert products[0]["supplier_name"] == "Crescent Foods"
    assert "certificate_number" not in products[0]


def test_search_omits_products_rather_than_sending_an_empty_list(
    api, db_session, approved_claim_profile
):
    """None, not []. Resolving products is a join per place and a result card
    only renders the rollup, so search doesn't load them — but the two states
    have to stay distinguishable, or every card would claim the restaurant
    listed no products."""
    profile, _ = approved_claim_profile([_products()])
    db_session.commit()

    # The listing is GET /places, not /places/search — there is no such
    # route, so that path falls through to /places/{place_id} and 422s trying
    # to parse "search" as a UUID. Geo search needs lat+lng+radius; the place
    # factory defaults to 40.7128/-74.006.
    r = api.get(
        "/places",
        params={"lat": 40.7128, "lng": -74.006, "radius": 5000, "limit": 200},
    )
    assert r.status_code == 200, r.text

    rows = [row for row in r.json() if row["id"] == str(profile.place_id)]
    assert rows, "seeded place should be within 5km of the search origin"
    assert rows[0]["halal_profile"] is not None
    assert rows[0]["halal_profile"]["meat_products"] is None
