"""Integration tests for the owner-portal claim flow.

Two surfaces under test:

1. ``GET /places`` extended to support text search via ``q`` (in
   addition to its existing geo-search via lat/lng/radius).
2. ``POST /me/ownership-requests`` and ``GET /me/ownership-requests`` —
   the owner-portal-facing variants of the public claim endpoint that
   auto-fill contact info from the signed-in user.
"""
from __future__ import annotations

from sqlalchemy import select

from app.modules.ownership_requests.enums import OwnershipRequestStatus
from app.modules.ownership_requests.models import PlaceOwnershipRequest


# ---------------------------------------------------------------------------
# GET /places — text search
# ---------------------------------------------------------------------------
def test_places_text_search_matches_name(api, factories):
    """``q`` does a case-insensitive ILIKE on name + address + city.
    A query for 'khan' matches 'Khan Halal Grill' regardless of case."""
    factories.place(name="Khan Halal Grill", address="123 Main St")
    factories.place(name="Other Place", address="456 Elsewhere Ave")

    resp = api.get("/places?q=khan")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    names = [p["name"] for p in body]
    assert "Khan Halal Grill" in names
    assert "Other Place" not in names


def test_places_text_search_matches_address(api, factories):
    """Address substring search lets owners find their place by street."""
    factories.place(name="Alpha", address="789 Atlantic Ave")
    factories.place(name="Beta", address="123 Main St")

    resp = api.get("/places?q=atlantic")
    assert resp.status_code == 200, resp.text
    names = [p["name"] for p in resp.json()]
    assert names == ["Alpha"]


def test_places_search_excludes_deleted(api, factories, db_session):
    """Soft-deleted places are invisible to the public search — owners
    shouldn't see (or be able to claim) a place that admin staff has
    explicitly removed from the catalog."""
    place = factories.place(name="Removed Restaurant")
    place.is_deleted = True
    db_session.add(place)
    db_session.commit()

    resp = api.get("/places?q=removed")
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


def test_places_search_requires_q_or_geo(api):
    """No ``q`` and no lat/lng/radius → 400. Public catalog is too big
    to dump out the door without at least a hint."""
    resp = api.get("/places")
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "PLACES_SEARCH_PARAMS_REQUIRED"


def test_places_geo_search_still_works(api, factories):
    """Backwards-compat: existing geo-search clients keep working
    untouched after the q-param refactor."""
    factories.place(name="In Range", lat=40.7128, lng=-74.006)

    resp = api.get(
        "/places",
        params={"lat": 40.7128, "lng": -74.006, "radius": 1000},
    )
    assert resp.status_code == 200, resp.text
    names = [p["name"] for p in resp.json()]
    assert "In Range" in names


# ---------------------------------------------------------------------------
# POST /me/ownership-requests
# ---------------------------------------------------------------------------
def test_my_ownership_request_create_autofills_contact_from_user(
    api, factories, db_session
):
    """The owner-portal-facing claim endpoint pulls contact_name +
    contact_email from the signed-in user — owners shouldn't retype
    info we already have."""
    owner = factories.user(
        role="OWNER",
        email="claimer@example.com",
        display_name="Claire Claimer",
    )
    place = factories.place(name="Claimable Eats")
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "place_id": str(place.id),
            "message": "I'm the operator at this location.",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()

    # Response shape: nested place + claim metadata, no contact fields
    # (the user already knows their own contact info).
    assert body["place"]["id"] == str(place.id)
    assert body["place"]["name"] == "Claimable Eats"
    assert body["status"] == OwnershipRequestStatus.SUBMITTED
    assert body["message"] == "I'm the operator at this location."

    # DB state: requester linked, contact fields auto-filled from user.
    row = db_session.execute(
        select(PlaceOwnershipRequest).where(
            PlaceOwnershipRequest.id == body["id"]
        )
    ).scalar_one()
    assert row.requester_user_id == owner.id
    assert row.contact_email == "claimer@example.com"
    assert row.contact_name == "Claire Claimer"


def test_my_ownership_request_falls_back_to_email_local_part_when_no_display_name(
    api, factories, db_session
):
    """Legacy users without a display_name shouldn't be blocked from
    claiming. The repo trims the email's local-part as a fallback so
    admin staff still see something human-readable, not an empty cell.
    """
    owner = factories.user(
        role="OWNER",
        email="solo@example.com",
        display_name=None,
    )
    place = factories.place(name="Lone Diner")
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={"place_id": str(place.id)},
    )
    assert resp.status_code == 201, resp.text

    row = db_session.execute(
        select(PlaceOwnershipRequest).where(
            PlaceOwnershipRequest.requester_user_id == owner.id
        )
    ).scalar_one()
    assert row.contact_name == "solo"


def test_my_ownership_request_requires_authentication(api, factories):
    """No session cookie → 401. /me/* endpoints aren't a public
    surface."""
    place = factories.place(name="Whatever")

    resp = api.post(
        "/me/ownership-requests",
        json={"place_id": str(place.id)},
    )
    assert resp.status_code == 401, resp.text


def test_my_ownership_request_404_on_unknown_place(api, factories):
    """An owner submitting a claim against a UUID that doesn't exist
    gets a 404 with a stable code so the frontend can show 'we
    couldn't find that place'."""
    owner = factories.user(role="OWNER")

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={"place_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


def test_my_ownership_request_blocks_duplicate_active_claim(
    api, factories, db_session
):
    """Repo's existing active-claim guard fires for /me too: an owner
    can't have two SUBMITTED claims for the same place at the same
    email."""
    owner = factories.user(role="OWNER", email="dup@example.com")
    place = factories.place(name="Duplicate Diner")
    db_session.commit()

    first = api.as_user(owner).post(
        "/me/ownership-requests",
        json={"place_id": str(place.id)},
    )
    assert first.status_code == 201, first.text

    second = api.as_user(owner).post(
        "/me/ownership-requests",
        json={"place_id": str(place.id)},
    )
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "OWNERSHIP_REQUEST_ALREADY_EXISTS"


def test_my_ownership_request_extra_fields_rejected(api, factories):
    """``extra="forbid"`` on the schema blocks a curious caller from
    sneaking in ``contact_email``, ``status``, etc. Server controls
    those server-side."""
    owner = factories.user(role="OWNER")
    place = factories.place(name="Strict Diner")

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "place_id": str(place.id),
            "contact_email": "attacker@example.com",
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# GET /me/ownership-requests
# ---------------------------------------------------------------------------
def test_my_ownership_requests_list_scoped_to_caller(
    api, factories, db_session
):
    """The list endpoint only returns claims where requester_user_id
    matches the caller. A different owner's claims are invisible —
    URL guessing or stale cache can't leak another user's queue."""
    me = factories.user(role="OWNER", email="me@example.com")
    other = factories.user(role="OWNER", email="other@example.com")

    my_place = factories.place(name="Mine")
    their_place = factories.place(name="Theirs")
    db_session.commit()

    # I submit a claim for my place.
    api.as_user(me).post(
        "/me/ownership-requests",
        json={"place_id": str(my_place.id)},
    )
    # Someone else submits a claim for theirs.
    api.as_user(other).post(
        "/me/ownership-requests",
        json={"place_id": str(their_place.id)},
    )

    resp = api.as_user(me).get("/me/ownership-requests")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["place"]["name"] == "Mine"


def test_my_ownership_requests_list_sorted_newest_first(
    api, factories, db_session
):
    """Two claims by the same owner: most-recent submission wins the
    top slot. Matters for the home page's 'Recent claims' preview."""
    owner = factories.user(role="OWNER")
    place_a = factories.place(name="Place A")
    place_b = factories.place(name="Place B")
    db_session.commit()

    api.as_user(owner).post(
        "/me/ownership-requests",
        json={"place_id": str(place_a.id)},
    )
    api.as_user(owner).post(
        "/me/ownership-requests",
        json={"place_id": str(place_b.id)},
    )

    resp = api.as_user(owner).get("/me/ownership-requests")
    assert resp.status_code == 200, resp.text
    names = [r["place"]["name"] for r in resp.json()]
    assert names == ["Place B", "Place A"]


def test_my_ownership_requests_list_requires_authentication(api):
    """Unauthenticated → 401. Mirrors the POST guard."""
    resp = api.get("/me/ownership-requests")
    assert resp.status_code == 401, resp.text
