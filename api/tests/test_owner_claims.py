"""Integration tests for the owner-portal claim flow.

Three surfaces under test:

1. ``GET /places`` extended to support text search via ``q`` (in
   addition to its existing geo-search via lat/lng/radius).
2. ``POST /me/ownership-requests`` and ``GET /me/ownership-requests`` —
   the owner-portal-facing variants of the public claim endpoint that
   auto-fill contact info from the signed-in user.
3. The Google fallback path: ``GET /places/google/autocomplete`` (a
   server-side proxy that keeps the Maps API key off the owner
   origin) and the ``google_place_id`` shortcut on POST that ingests
   first and then creates the claim atomically from the user's
   perspective.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, update

from app.modules.ownership_requests.enums import OwnershipRequestStatus
from app.modules.ownership_requests.models import PlaceOwnershipRequest


_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "google_places"


def _google_fixture(name: str) -> dict:
    """Load a captured Google Place Details payload for ingest tests."""
    return json.loads((_FIXTURE_DIR / name).read_text())


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
    org = factories.org_for_user(user=owner)
    place = factories.place(name="Claimable Eats")
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(org.id),
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
    )
    # The factory always sets a non-null display_name (its own
    # 'Test User <suffix>' default kicks in if you pass None). Clear
    # it explicitly to simulate the legacy-row case this test cares
    # about.
    owner.display_name = None
    db_session.add(owner)
    org = factories.org_for_user(user=owner)
    place = factories.place(name="Lone Diner")
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={"organization_id": str(org.id), "place_id": str(place.id)},
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
    org = factories.org_for_user(user=owner)

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(org.id),
            "place_id": "00000000-0000-0000-0000-000000000000",
        },
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
    org = factories.org_for_user(user=owner)
    place = factories.place(name="Duplicate Diner")
    db_session.commit()

    first = api.as_user(owner).post(
        "/me/ownership-requests",
        json={"organization_id": str(org.id), "place_id": str(place.id)},
    )
    assert first.status_code == 201, first.text

    second = api.as_user(owner).post(
        "/me/ownership-requests",
        json={"organization_id": str(org.id), "place_id": str(place.id)},
    )
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "OWNERSHIP_REQUEST_ALREADY_EXISTS"


def test_my_ownership_request_extra_fields_rejected(api, factories):
    """``extra="forbid"`` on the schema blocks a curious caller from
    sneaking in ``contact_email``, ``status``, etc. Server controls
    those server-side."""
    owner = factories.user(role="OWNER")
    org = factories.org_for_user(user=owner)
    place = factories.place(name="Strict Diner")

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(org.id),
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

    my_org = factories.org_for_user(user=me)
    their_org = factories.org_for_user(user=other)

    my_place = factories.place(name="Mine")
    their_place = factories.place(name="Theirs")
    db_session.commit()

    # I submit a claim for my place.
    api.as_user(me).post(
        "/me/ownership-requests",
        json={"organization_id": str(my_org.id), "place_id": str(my_place.id)},
    )
    # Someone else submits a claim for theirs.
    api.as_user(other).post(
        "/me/ownership-requests",
        json={"organization_id": str(their_org.id), "place_id": str(their_place.id)},
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
    top slot. Matters for the home page's 'Recent claims' preview.

    Postgres ``now()`` returns the transaction-start timestamp, and
    the test harness wraps each test in a single outer transaction
    (with savepoint commits inside) — so two consecutive INSERTs both
    pick up identical ``created_at`` values, making natural sort
    order undefined. We force a 1-second gap on the second claim
    explicitly to make the assertion deterministic.
    """
    owner = factories.user(role="OWNER")
    org = factories.org_for_user(user=owner)
    place_a = factories.place(name="Place A")
    place_b = factories.place(name="Place B")
    db_session.commit()

    api.as_user(owner).post(
        "/me/ownership-requests",
        json={"organization_id": str(org.id), "place_id": str(place_a.id)},
    )
    api.as_user(owner).post(
        "/me/ownership-requests",
        json={"organization_id": str(org.id), "place_id": str(place_b.id)},
    )

    # Bump Place B's claim to be the newer of the two.
    db_session.execute(
        update(PlaceOwnershipRequest)
        .where(PlaceOwnershipRequest.place_id == place_b.id)
        .values(created_at=datetime.now(timezone.utc) + timedelta(seconds=1))
    )
    db_session.commit()

    resp = api.as_user(owner).get("/me/ownership-requests")
    assert resp.status_code == 200, resp.text
    names = [r["place"]["name"] for r in resp.json()]
    assert names == ["Place B", "Place A"]


def test_my_ownership_requests_list_requires_authentication(api):
    """Unauthenticated → 401. Mirrors the POST guard."""
    resp = api.get("/me/ownership-requests")
    assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# GET /places/google/autocomplete — server-side proxy
# ---------------------------------------------------------------------------
_FAKE_GOOGLE_PREDICTIONS = [
    {
        "place_id": "ChIJSeed_AutocompleteOne",
        "description": "Khan Halal Grill, Atlantic Ave, Brooklyn, NY, USA",
        "structured_formatting": {
            "main_text": "Khan Halal Grill",
            "secondary_text": "Atlantic Ave, Brooklyn, NY, USA",
        },
    },
    {
        "place_id": "ChIJSeed_AutocompleteTwo",
        "description": "Khan Halal Cafe, Manhattan, NY, USA",
        "structured_formatting": {
            "main_text": "Khan Halal Cafe",
            "secondary_text": "Manhattan, NY, USA",
        },
    },
    # Defensive: a prediction without a place_id should be filtered
    # out by the proxy so the client never tries to claim it.
    {
        "place_id": "",
        "description": "should be filtered",
    },
]


def test_google_autocomplete_returns_predictions(api, monkeypatch):
    """The proxy maps Google's verbose response down to a stable wire
    shape — google_place_id + description + primary/secondary text.
    Predictions without a place_id are dropped (they can't be acted on
    by the downstream claim endpoint)."""
    from app.modules.places import router as places_router

    monkeypatch.setattr(
        places_router,
        "fetch_place_autocomplete_google",
        lambda _q: _FAKE_GOOGLE_PREDICTIONS,
    )

    resp = api.get("/places/google/autocomplete?q=khan%20halal")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 2  # the empty-place_id row was filtered out
    assert body[0]["google_place_id"] == "ChIJSeed_AutocompleteOne"
    assert body[0]["primary_text"] == "Khan Halal Grill"
    assert body[0]["secondary_text"] == "Atlantic Ave, Brooklyn, NY, USA"


def test_google_autocomplete_requires_q(api):
    """No ``q`` → 422 from the Pydantic min_length=1 guard. Saves a
    billed Google call for a no-op input."""
    resp = api.get("/places/google/autocomplete")
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_google_autocomplete_surfaces_clean_error_on_google_failure(
    api, monkeypatch
):
    """Underlying Google failure → 400 GOOGLE_AUTOCOMPLETE_UNAVAILABLE
    rather than leaking the raw provider error. The client can branch
    on the code to render a generic 'try again' message."""
    from app.modules.places import router as places_router
    from app.modules.places.integrations.google_client import GoogleAPIError

    def boom(_q):
        raise GoogleAPIError("simulated provider outage")

    monkeypatch.setattr(places_router, "fetch_place_autocomplete_google", boom)

    resp = api.get("/places/google/autocomplete?q=anything")
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "GOOGLE_AUTOCOMPLETE_UNAVAILABLE"


# ---------------------------------------------------------------------------
# POST /me/ownership-requests — google_place_id ingest path
# ---------------------------------------------------------------------------
def test_my_ownership_request_ingests_google_then_creates_claim(
    api, factories, db_session, monkeypatch
):
    """When the body carries ``google_place_id``, the endpoint ingests
    the Google place server-side first (creating a real Place row)
    and then creates the claim against the resulting place_id. The
    owner sees a single round trip — admin sees a fresh place + an
    attached claim."""
    from app.modules.places import ingest as ingest_mod

    monkeypatch.setattr(
        ingest_mod,
        "fetch_place_details_google",
        lambda _pid: _google_fixture("us_brooklyn.json"),
    )

    owner = factories.user(
        role="OWNER",
        email="ingestclaim@example.com",
        display_name="Indra Ingest",
    )
    org = factories.org_for_user(user=owner)
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(org.id),
            "google_place_id": "ChIJSeed_OwnerClaim",
        },
    )
    assert resp.status_code == 201, resp.text

    body = resp.json()
    assert body["status"] == OwnershipRequestStatus.SUBMITTED
    # The us_brooklyn.json fixture's address is actually a Woodside
    # location (its sublocality_level_1 is "Queens" — there's no
    # explicit `locality` component). The extractor uses sublocality
    # as the city fallback, so the ingested row's city is "Queens".
    # Pinned here so a future fixture rename doesn't silently shift
    # what we're asserting.
    assert body["place"]["country_code"] == "US"
    assert body["place"]["city"] == "Queens"

    # DB state: the claim is linked to this owner and to the
    # newly-ingested place.
    row = db_session.execute(
        select(PlaceOwnershipRequest).where(
            PlaceOwnershipRequest.requester_user_id == owner.id
        )
    ).scalar_one()
    assert str(row.place_id) == body["place"]["id"]


def test_my_ownership_request_rejects_both_place_id_and_google_place_id(
    api, factories
):
    """Schema validator: exactly-one-of. Both → 422 so an attacker
    can't try to ingest a Google place and then attach the claim to
    a different existing place_id in one shot."""
    owner = factories.user(role="OWNER")
    org = factories.org_for_user(user=owner)
    place = factories.place(name="Existing")

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(org.id),
            "place_id": str(place.id),
            "google_place_id": "ChIJSeed_BothAtOnce",
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_my_ownership_request_rejects_neither_place_id_nor_google_place_id(
    api, factories
):
    """Schema validator: at least one identifier required. Empty body
    → 422."""
    owner = factories.user(role="OWNER")
    org = factories.org_for_user(user=owner)

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(org.id),
            "message": "I'd like to claim something but didn't say what.",
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# POST /me/ownership-requests — organization gate (slice 5b)
# ---------------------------------------------------------------------------
def test_my_ownership_request_requires_organization_id(api, factories):
    """The schema requires organization_id; missing → 422."""
    owner = factories.user(role="OWNER")
    place = factories.place(name="Org Required Diner")

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={"place_id": str(place.id)},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_my_ownership_request_rejects_org_not_owned_by_caller(
    api, factories, db_session
):
    """Caller passes an organization_id they aren't a member of →
    403 OWNER_ORGANIZATION_FORBIDDEN. Same posture as the org
    self-service endpoints."""
    me = factories.user(role="OWNER", email="me@example.com")
    other = factories.user(role="OWNER", email="other@example.com")
    other_org = factories.org_for_user(user=other)
    place = factories.place(name="Cross-Tenant Diner")
    db_session.commit()

    resp = api.as_user(me).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(other_org.id),
            "place_id": str(place.id),
        },
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_FORBIDDEN"


def test_my_ownership_request_rejects_draft_org(api, factories, db_session):
    """DRAFT orgs can't sponsor claims. Owner has to commit by
    submitting their org for review first — otherwise junk DRAFT orgs
    become a spam vector for evidence-free claims."""
    from app.modules.organizations.enums import OrganizationStatus

    owner = factories.user(role="OWNER")
    org = factories.org_for_user(
        user=owner, status=OrganizationStatus.DRAFT
    )
    place = factories.place(name="Draft Org Diner")
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(org.id),
            "place_id": str(place.id),
        },
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "OWNER_ORGANIZATION_NOT_ELIGIBLE"


def test_my_ownership_request_accepts_under_review_org(
    api, factories, db_session
):
    """An UNDER_REVIEW org can sponsor claims — owner showed intent
    by submitting; we let them keep moving while admin reviews."""
    from app.modules.organizations.enums import OrganizationStatus

    owner = factories.user(role="OWNER", email="under-review@example.com")
    org = factories.org_for_user(
        user=owner, status=OrganizationStatus.UNDER_REVIEW
    )
    place = factories.place(name="Under-Review Diner")
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(org.id),
            "place_id": str(place.id),
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["organization"]["status"] == "UNDER_REVIEW"


def test_my_ownership_request_persists_organization_id(
    api, factories, db_session
):
    """The organization_id is recorded on the claim row and surfaces
    in the response's nested ``organization`` summary."""
    owner = factories.user(role="OWNER")
    org = factories.org_for_user(user=owner, name="Khan Halal LLC")
    place = factories.place(name="Persist Test")
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(org.id),
            "place_id": str(place.id),
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["organization"]["id"] == str(org.id)
    assert body["organization"]["name"] == "Khan Halal LLC"

    row = db_session.execute(
        select(PlaceOwnershipRequest).where(
            PlaceOwnershipRequest.id == body["id"]
        )
    ).scalar_one()
    assert row.organization_id == org.id


def test_my_ownership_request_google_ingest_is_idempotent(
    api, factories, db_session, monkeypatch
):
    """Two owners claiming the same Google place: the first call
    ingests, the second hits the existed-already branch in
    ``ingest_google_place``. We get one Place, two distinct claims."""
    from app.modules.places import ingest as ingest_mod

    monkeypatch.setattr(
        ingest_mod,
        "fetch_place_details_google",
        lambda _pid: _google_fixture("us_brooklyn.json"),
    )

    first_owner = factories.user(role="OWNER", email="first@example.com")
    second_owner = factories.user(role="OWNER", email="second@example.com")
    first_org = factories.org_for_user(user=first_owner)
    second_org = factories.org_for_user(user=second_owner)
    db_session.commit()

    first = api.as_user(first_owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(first_org.id),
            "google_place_id": "ChIJSeed_Idempotent",
        },
    )
    assert first.status_code == 201, first.text

    second = api.as_user(second_owner).post(
        "/me/ownership-requests",
        json={
            "organization_id": str(second_org.id),
            "google_place_id": "ChIJSeed_Idempotent",
        },
    )
    assert second.status_code == 201, second.text

    # Both claims point at the same place row.
    assert first.json()["place"]["id"] == second.json()["place"]["id"]
