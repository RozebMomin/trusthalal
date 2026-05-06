"""Backend tests for the org-polish pass:

  * address fields round-trip on create + patch (owner + admin paths).
  * MyOrganizationRead surfaces ``decision_note`` after admin reject.
  * Admin OrganizationDetailRead embeds member display_name + email.
"""
from __future__ import annotations

from sqlalchemy import select

from app.modules.organizations.models import Organization

# Required fields on POST /me/organizations: address fields plus
# contact_email (polish-pass-v3). Spread this constant on tests that
# don't care about the values — it covers everything the schema
# expects so a green test body stays focused on its intent.
_VALID_ORG_FIELDS = {
    "contact_email": "owner@example.com",
    "address": "123 Main St",
    "city": "Detroit",
    "region": "MI",
    "country_code": "US",
    "postal_code": "48201",
}
_VALID_ADDRESS = _VALID_ORG_FIELDS  # back-compat alias


# ---------------------------------------------------------------------------
# Address fields
# ---------------------------------------------------------------------------


def test_owner_create_org_round_trips_address_fields(
    api, factories, db_session
):
    owner = factories.owner()
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/organizations",
        json={
            "name": "Khan Halal LLC",
            "contact_email": "khan@example.com",
            "address": "123 Main St",
            "city": "Detroit",
            "region": "MI",
            "country_code": "us",  # lowercased on the way in
            "postal_code": "48201",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["address"] == "123 Main St"
    assert body["city"] == "Detroit"
    assert body["region"] == "MI"
    # Repo upper-cases for ISO-3166-1 norm.
    assert body["country_code"] == "US"
    assert body["postal_code"] == "48201"

    # Confirm the row was actually persisted with normalized values.
    row = db_session.execute(
        select(Organization).where(Organization.id == body["id"])
    ).scalar_one()
    assert row.country_code == "US"


def test_owner_patch_org_clears_address_with_explicit_null(
    api, factories, db_session
):
    owner = factories.owner()
    db_session.commit()

    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Khan Halal LLC", **_VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    # null clears, omission leaves alone — same contract as
    # contact_email. PATCH stays permissive even though POST is
    # strict, so an owner can still wipe a field after creation
    # while staff are reviewing.
    resp = api.as_user(owner).patch(
        f"/me/organizations/{org_id}",
        json={"address": None},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["address"] is None
    # City + country untouched.
    assert body["city"] == "Detroit"
    assert body["country_code"] == "US"


def test_owner_create_org_rejects_missing_address(
    api, factories, db_session
):
    """Address is required now — a payload with just a name should
    fail validation rather than silently land an org with NULL
    address fields."""
    owner = factories.owner()
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Khan Halal LLC"},
    )
    assert resp.status_code == 422, resp.text


def test_owner_create_org_rejects_blank_address(
    api, factories, db_session
):
    """Whitespace-only address (e.g. an unfilled but space-pressed
    input) collapses to nothing once trimmed, so the schema rejects
    it with the same 422 as a literal empty string."""
    owner = factories.owner()
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/organizations",
        json={
            "name": "Khan Halal LLC",
            **_VALID_ADDRESS,
            "address": "   ",  # whitespace only
        },
    )
    assert resp.status_code == 422, resp.text


def test_owner_create_org_rejects_missing_contact_email(
    api, factories, db_session
):
    """contact_email is required on create — staff need a way to
    reach the owner about this specific org. Patch stays permissive
    so an owner can still clear it later if they want admin to use
    their account email instead."""
    owner = factories.owner()
    db_session.commit()

    payload = {"name": "No Email Co", **_VALID_ORG_FIELDS}
    payload.pop("contact_email")

    resp = api.as_user(owner).post("/me/organizations", json=payload)
    assert resp.status_code == 422, resp.text


def test_owner_create_org_rejects_invalid_contact_email(
    api, factories, db_session
):
    """Pydantic's EmailStr validator catches malformed addresses
    upfront — sanity test that the schema is wired right."""
    owner = factories.owner()
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/organizations",
        json={
            "name": "Bad Email Co",
            **_VALID_ORG_FIELDS,
            "contact_email": "not-an-email",
        },
    )
    assert resp.status_code == 422, resp.text


def test_owner_create_org_defaults_country_code_to_us(
    api, factories, db_session
):
    """Country code is optional client-side now (the UI locks it to
    'US') — server fills in the default when the field's omitted."""
    owner = factories.owner()
    db_session.commit()

    payload = {"name": "Khan Halal LLC", **_VALID_ADDRESS}
    payload.pop("country_code")

    resp = api.as_user(owner).post("/me/organizations", json=payload)
    assert resp.status_code == 201, resp.text
    assert resp.json()["country_code"] == "US"


# ---------------------------------------------------------------------------
# decision_note exposure for owner after admin reject
# ---------------------------------------------------------------------------


def test_owner_sees_decision_note_after_admin_reject(
    api, factories, db_session
):
    owner = factories.owner()
    admin = factories.admin()
    db_session.commit()

    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Test Halal LLC", **_VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    # Owner needs an attachment + submit before admin can reject.
    files = {"file": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")}
    api.as_user(owner).post(
        f"/me/organizations/{org_id}/attachments",
        files=files,
    )
    api.as_user(owner).post(f"/me/organizations/{org_id}/submit")

    api.as_user(admin).post(
        f"/admin/organizations/{org_id}/reject",
        json={"reason": "Filing doesn't match the entity name on the LLC search."},
    )

    resp = api.as_user(owner).get(f"/me/organizations/{org_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "REJECTED"
    assert body["decision_note"] == (
        "Filing doesn't match the entity name on the LLC search."
    )
    assert body["decided_at"] is not None


# ---------------------------------------------------------------------------
# Admin org detail surfaces member display_name + email
# ---------------------------------------------------------------------------


def test_admin_org_detail_embeds_member_user_fields(
    api, factories, db_session
):
    owner = factories.owner(
        display_name="Aisha Karimi",
        email="aisha@example.com",
    )
    admin = factories.admin()
    db_session.commit()

    create = api.as_user(owner).post(
        "/me/organizations",
        json={"name": "Karimi Halal Co.", **_VALID_ADDRESS},
    )
    org_id = create.json()["id"]

    resp = api.as_user(admin).get(f"/admin/organizations/{org_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    members = body["members"]
    assert len(members) == 1
    member = members[0]
    assert member["user_id"] == str(owner.id)
    # The new fields land on the admin shape so the panel can render
    # a name instead of a UUID.
    assert member["user_display_name"] == "Aisha Karimi"
    assert member["user_email"] == "aisha@example.com"
