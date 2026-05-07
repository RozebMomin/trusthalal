"""Integration tests for the public halal-profile read API + search filters.

Phase 4 of the halal-trust v2 rebuild. Covers:

  * GET /places/{id}/halal-profile (404 vs profile-not-found split)
  * GET /places/{id} embeds halal_profile (or null when absent)
  * GET /places search filters by validation_tier, menu_posture,
    per-meat slaughter, certification, no-pork, no-alcohol

Profile fixtures are built by running the full owner submit + admin
approve flow — the same path production exercises — so any drift
between schema and derivation is caught here.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select


# Same complete-questionnaire fixture as the other halal test files.
COMPLETE_FULLY_HALAL: dict = {
    "questionnaire_version": 1,
    "menu_posture": "FULLY_HALAL",
    "has_pork": False,
    "alcohol_policy": "NONE",
    "alcohol_in_cooking": False,
    "meat_products": [
        {
            "meat_type": "CHICKEN",
            "product_name": "Chicken",
            "slaughter_method": "ZABIHAH",
        },
        {
            "meat_type": "BEEF",
            "product_name": "Beef",
            "slaughter_method": "ZABIHAH",
        },
    ],
    "seafood_only": False,
    "has_certification": True,
    "certifying_body_name": "IFANCA",
    "caveats": None,
}


def _seed_approved_place(
    api,
    factories,
    db_session,
    *,
    questionnaire: dict | None = None,
    validation_tier: str = "CERTIFICATE_ON_FILE",
    place_kwargs: dict | None = None,
):
    """End-to-end: create owner+org+place, owner submits, admin approves.

    Returns (place, org, claim_id, admin) for further assertions.
    """
    admin = factories.admin()
    owner = factories.owner()
    place_kwargs = place_kwargs or {}
    place = factories.place(**place_kwargs)
    org = factories.org_for_user(user=owner)
    factories.place_owner_link(place=place, organization=org)
    db_session.commit()

    create_resp = api.as_user(owner).post(
        "/me/halal-claims",
        json={
            "place_id": str(place.id),
            "organization_id": str(org.id),
            "structured_response": questionnaire or COMPLETE_FULLY_HALAL,
        },
    )
    claim_id = create_resp.json()["id"]
    api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")
    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/approve",
        json={"validation_tier": validation_tier},
    )
    return place, org, claim_id, admin


# ---------------------------------------------------------------------------
# GET /places/{id}/halal-profile
# ---------------------------------------------------------------------------
def test_public_halal_profile_returned_after_approval(
    api, factories, db_session
):
    place, _, _, _ = _seed_approved_place(api, factories, db_session)

    resp = api.get(f"/places/{place.id}/halal-profile")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["place_id"] == str(place.id)
    assert body["validation_tier"] == "CERTIFICATE_ON_FILE"
    assert body["menu_posture"] == "FULLY_HALAL"
    assert body["chicken_slaughter"] == "ZABIHAH"
    assert body["dispute_state"] == "NONE"
    assert body["revoked_at"] is None


def test_public_halal_profile_404_when_no_profile(api, factories, db_session):
    """A place that exists but has no approved claim returns
    HALAL_PROFILE_NOT_FOUND, distinct from PLACE_NOT_FOUND so the
    consumer UI can render 'no halal info' vs 'restaurant not found'
    differently."""
    place = factories.place()
    db_session.commit()

    resp = api.get(f"/places/{place.id}/halal-profile")
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "HALAL_PROFILE_NOT_FOUND"


def test_public_halal_profile_404_when_place_missing(api, factories, db_session):
    import uuid

    resp = api.get(f"/places/{uuid.uuid4()}/halal-profile")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


def test_public_halal_profile_404_when_revoked(
    api, factories, db_session
):
    """Revoked profiles are hidden from consumer reads."""
    place, _, claim_id, admin = _seed_approved_place(
        api, factories, db_session
    )
    revoke_resp = api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/revoke",
        json={"decision_note": "Restaurant closed."},
    )
    assert revoke_resp.status_code == 200, revoke_resp.text

    resp = api.get(f"/places/{place.id}/halal-profile")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "HALAL_PROFILE_NOT_FOUND"


# ---------------------------------------------------------------------------
# GET /places/{id} embeds the profile
# ---------------------------------------------------------------------------
def test_place_detail_embeds_halal_profile(api, factories, db_session):
    place, _, _, _ = _seed_approved_place(api, factories, db_session)

    resp = api.get(f"/places/{place.id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["halal_profile"] is not None
    assert body["halal_profile"]["validation_tier"] == "CERTIFICATE_ON_FILE"
    assert body["halal_profile"]["menu_posture"] == "FULLY_HALAL"


# ---------------------------------------------------------------------------
# Search results embed the profile (Phase 9b)
# ---------------------------------------------------------------------------
# Consumer-site search renders halal badges per result without an N+1
# fetch, so PlaceSearchResult carries the embedded HalalProfile too.
# These tests pin: profile present when approved, null when absent,
# null when revoked.


def test_search_result_embeds_halal_profile(api, factories, db_session):
    place, _, _, _ = _seed_approved_place(api, factories, db_session)

    resp = api.get("/places", params={"q": place.name})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) >= 1
    match = next((row for row in body if row["id"] == str(place.id)), None)
    assert match is not None
    assert match["halal_profile"] is not None
    assert match["halal_profile"]["validation_tier"] == "CERTIFICATE_ON_FILE"
    assert match["halal_profile"]["menu_posture"] == "FULLY_HALAL"


def test_search_result_halal_profile_null_for_unprofiled_place(
    api, factories, db_session
):
    """Unfiltered search includes places without a halal profile —
    they show up with halal_profile=null. Filtered search still
    excludes them (covered by test_search_excludes_unprofiled_when_filtering)."""
    place = factories.place(name="QQQ Plain Diner")
    db_session.commit()

    resp = api.get("/places", params={"q": "QQQ"})
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    match = next((row for row in rows if row["id"] == str(place.id)), None)
    assert match is not None
    assert match["halal_profile"] is None


def test_search_result_halal_profile_null_when_revoked(
    api, factories, db_session
):
    """Revoked profiles look the same as no-profile from the search
    surface — they don't show up in the search result's embedded
    field. Mirrors the behavior of the place detail endpoint."""
    place, _, claim_id, admin = _seed_approved_place(api, factories, db_session)
    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/revoke",
        json={"decision_note": "Revoked for the search test."},
    )

    resp = api.get("/places", params={"q": place.name})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    match = next((row for row in body if row["id"] == str(place.id)), None)
    assert match is not None
    assert match["halal_profile"] is None


def test_place_detail_halal_profile_null_when_absent(
    api, factories, db_session
):
    place = factories.place()
    db_session.commit()

    resp = api.get(f"/places/{place.id}")
    assert resp.status_code == 200
    assert resp.json()["halal_profile"] is None


def test_place_detail_halal_profile_null_when_revoked(
    api, factories, db_session
):
    place, _, claim_id, admin = _seed_approved_place(
        api, factories, db_session
    )
    api.as_user(admin).post(
        f"/admin/halal-claims/{claim_id}/revoke",
        json={"decision_note": "Closed."},
    )

    resp = api.get(f"/places/{place.id}")
    assert resp.status_code == 200
    assert resp.json()["halal_profile"] is None


# ---------------------------------------------------------------------------
# Search filters
# ---------------------------------------------------------------------------
def _seed_three_distinct_places(api, factories, db_session):
    """Three places with different halal profiles for filter assertions:

      * place_strict — TRUST_HALAL_VERIFIED, FULLY_HALAL, no pork,
                       no alcohol, zabihah chicken+beef.
      * place_loose  — SELF_ATTESTED, MIXED_SHARED_KITCHEN, has pork,
                       full bar, machine-slaughter chicken.
      * place_mid    — CERTIFICATE_ON_FILE, HALAL_OPTIONS_ADVERTISED,
                       no pork, beer/wine only, zabihah chicken,
                       machine beef.

    Place names are predictable so the search by-name still finds them.
    """
    p_strict, _, _, _ = _seed_approved_place(
        api,
        factories,
        db_session,
        validation_tier="TRUST_HALAL_VERIFIED",
        place_kwargs={"name": "AAAStrict Halal"},
    )

    loose_questionnaire = {
        **COMPLETE_FULLY_HALAL,
        "menu_posture": "MIXED_SHARED_KITCHEN",
        "has_pork": True,
        "alcohol_policy": "FULL_BAR",
        "chicken": {"slaughter_method": "MACHINE"},
        "beef": {"slaughter_method": "MACHINE"},
        "has_certification": False,
        "certifying_body_name": None,
    }
    p_loose, _, _, _ = _seed_approved_place(
        api,
        factories,
        db_session,
        questionnaire=loose_questionnaire,
        validation_tier="SELF_ATTESTED",
        place_kwargs={"name": "AAALoose Mixed"},
    )

    mid_questionnaire = {
        **COMPLETE_FULLY_HALAL,
        "menu_posture": "HALAL_OPTIONS_ADVERTISED",
        "alcohol_policy": "BEER_AND_WINE_ONLY",
        "chicken": {"slaughter_method": "ZABIHAH"},
        "beef": {"slaughter_method": "MACHINE"},
    }
    p_mid, _, _, _ = _seed_approved_place(
        api,
        factories,
        db_session,
        questionnaire=mid_questionnaire,
        validation_tier="CERTIFICATE_ON_FILE",
        place_kwargs={"name": "AAAMid Halal"},
    )

    return p_strict, p_loose, p_mid


def test_search_min_validation_tier(api, factories, db_session):
    p_strict, p_loose, p_mid = _seed_three_distinct_places(
        api, factories, db_session
    )

    resp = api.get(
        "/places",
        params={
            "q": "AAA",
            "min_validation_tier": "CERTIFICATE_ON_FILE",
        },
    )
    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(p_strict.id) in ids
    assert str(p_mid.id) in ids
    assert str(p_loose.id) not in ids


def test_search_min_menu_posture(api, factories, db_session):
    p_strict, p_loose, p_mid = _seed_three_distinct_places(
        api, factories, db_session
    )

    # MIXED_SEPARATE_KITCHENS includes FULLY_HALAL and
    # MIXED_SEPARATE_KITCHENS, but NOT HALAL_OPTIONS_ADVERTISED or
    # below.
    resp = api.get(
        "/places",
        params={"q": "AAA", "min_menu_posture": "MIXED_SEPARATE_KITCHENS"},
    )
    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(p_strict.id) in ids  # FULLY_HALAL
    assert str(p_mid.id) not in ids  # HALAL_OPTIONS_ADVERTISED
    assert str(p_loose.id) not in ids


def test_search_chicken_slaughter_multi_value(api, factories, db_session):
    p_strict, p_loose, p_mid = _seed_three_distinct_places(
        api, factories, db_session
    )

    # Pass chicken_slaughter twice — strict consumer who accepts
    # ZABIHAH or NOT_SERVED (no chicken at all).
    resp = api.get(
        "/places",
        params=[
            ("q", "AAA"),
            ("chicken_slaughter", "ZABIHAH"),
            ("chicken_slaughter", "NOT_SERVED"),
        ],
    )
    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(p_strict.id) in ids
    assert str(p_mid.id) in ids
    assert str(p_loose.id) not in ids  # MACHINE


def test_search_no_pork_filter(api, factories, db_session):
    p_strict, p_loose, p_mid = _seed_three_distinct_places(
        api, factories, db_session
    )

    resp = api.get(
        "/places", params={"q": "AAA", "no_pork": "true"}
    )
    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(p_loose.id) not in ids
    assert str(p_strict.id) in ids
    assert str(p_mid.id) in ids


def test_search_no_alcohol_served_filter(api, factories, db_session):
    p_strict, p_loose, p_mid = _seed_three_distinct_places(
        api, factories, db_session
    )

    resp = api.get(
        "/places",
        params={"q": "AAA", "no_alcohol_served": "true"},
    )
    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    # Only the strict place has alcohol_policy=NONE.
    assert ids == {str(p_strict.id)}


def test_search_has_certification_filter(api, factories, db_session):
    p_strict, p_loose, p_mid = _seed_three_distinct_places(
        api, factories, db_session
    )

    resp = api.get(
        "/places",
        params={"q": "AAA", "has_certification": "true"},
    )
    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(p_loose.id) not in ids
    assert str(p_strict.id) in ids
    assert str(p_mid.id) in ids


def test_search_excludes_unprofiled_when_filtering(
    api, factories, db_session
):
    """A place without a halal profile must NOT appear in search
    results when any halal filter is active. Consumer asking for
    'halal-verified places' shouldn't get random unverified places."""
    p_strict, _, _ = _seed_three_distinct_places(api, factories, db_session)
    no_profile_place = factories.place(name="AAANoProfile")
    db_session.commit()

    resp = api.get(
        "/places",
        params={"q": "AAA", "min_validation_tier": "SELF_ATTESTED"},
    )
    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(no_profile_place.id) not in ids


def test_search_without_filters_includes_unprofiled(
    api, factories, db_session
):
    """The plain catalog browse (no halal filters) returns all
    matching places, profiled or not. Important regression check:
    the JOIN should only happen when halal filters are present."""
    p_strict, _, _ = _seed_three_distinct_places(api, factories, db_session)
    no_profile_place = factories.place(name="AAANoProfile")
    db_session.commit()

    resp = api.get("/places", params={"q": "AAA"})
    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(no_profile_place.id) in ids
    assert str(p_strict.id) in ids
