"""Backend tests for the org-polish pass:

  * address fields round-trip on create + patch (owner + admin paths).
  * MyOrganizationRead surfaces ``decision_note`` after admin reject.
  * Admin OrganizationDetailRead embeds member display_name + email.
"""
from __future__ import annotations

from sqlalchemy import select

from app.modules.organizations.models import Organization


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
        json={
            "name": "Khan Halal LLC",
            "address": "123 Main St",
            "city": "Detroit",
            "country_code": "US",
        },
    )
    org_id = create.json()["id"]

    # null clears, omission leaves alone — same contract as
    # contact_email.
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


def test_owner_create_org_collapses_empty_strings_to_null(
    api, factories, db_session
):
    """Empty strings (e.g. unfilled inputs sent verbatim) collapse
    to NULL so the column doesn't end up holding a blank value."""
    owner = factories.owner()
    db_session.commit()

    resp = api.as_user(owner).post(
        "/me/organizations",
        json={
            "name": "Khan Halal LLC",
            "address": "   ",  # whitespace only
            "city": "",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["address"] is None
    assert body["city"] is None


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
        json={"name": "Test Halal LLC"},
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
        json={"name": "Karimi Halal Co."},
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
