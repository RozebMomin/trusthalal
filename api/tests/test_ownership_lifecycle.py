"""Integration tests for the place-ownership request lifecycle.

Covers:
  - Public (unauthenticated) submission
  - Authenticated submission attaching requester_user_id
  - Duplicate-request conflict on same (place, email, active status)
  - Admin approve with an existing organization (PlaceOwner + OrganizationMember
    are wired, requester role is promoted, place event is logged)
  - Admin approve with a new organization (org is created on the fly)
  - XOR validation on approve (neither / both org fields)
  - Admin reject (status flips, place event logged)
  - Admin request-evidence is idempotent
  - Terminal-status lock: already-approved request can't be re-approved
"""
from __future__ import annotations

from sqlalchemy import select

from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.ownership_requests.enums import OwnershipRequestStatus
from app.modules.ownership_requests.models import PlaceOwnershipRequest
from app.modules.places.enums import PlaceEventType
from app.modules.places.models import PlaceEvent
from app.modules.users.enums import UserRole
from app.modules.users.models import User


# ---------------------------------------------------------------------------
# Submission
# ---------------------------------------------------------------------------
def test_anonymous_can_submit_ownership_request(api, factories, db_session):
    """An unauthenticated visitor can submit an ownership request. The
    resulting row should have requester_user_id=None and status=SUBMITTED."""
    place = factories.place()

    resp = api.as_anonymous().post(
        f"/places/{place.id}/ownership-requests",
        json={
            "contact_name": "Anon Claimant",
            "contact_email": "anon@example.com",
            "contact_phone": "+1-555-0188",
            "message": "I just opened this spot last week",
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["place_id"] == str(place.id)
    assert body["requester_user_id"] is None
    assert body["status"] == OwnershipRequestStatus.SUBMITTED.value

    row = db_session.execute(
        select(PlaceOwnershipRequest).where(
            PlaceOwnershipRequest.id == body["id"]
        )
    ).scalar_one()
    assert row.contact_email == "anon@example.com"


def test_authenticated_submit_attaches_requester(api, factories, db_session):
    """If a consumer is logged in while submitting, their user id should be
    stamped on the request for later approval-time role promotion."""
    consumer = factories.consumer()
    place = factories.place()

    resp = api.as_user(consumer).post(
        f"/places/{place.id}/ownership-requests",
        json={
            "contact_name": consumer.display_name or "Some Person",
            "contact_email": consumer.email,
            "message": "I own this",
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["requester_user_id"] == str(consumer.id)

    row = db_session.execute(
        select(PlaceOwnershipRequest).where(
            PlaceOwnershipRequest.id == body["id"]
        )
    ).scalar_one()
    assert row.requester_user_id == consumer.id


def test_duplicate_active_request_for_same_place_and_email_conflicts(
    api, factories
):
    """A second open request from the same email against the same place
    must 409 — we don't want duplicate queues for the same claimant."""
    place = factories.place()

    first = api.as_anonymous().post(
        f"/places/{place.id}/ownership-requests",
        json={
            "contact_name": "Dup User",
            "contact_email": "dup@example.com",
            "message": "first submission",
        },
    )
    assert first.status_code == 201, first.text

    second = api.as_anonymous().post(
        f"/places/{place.id}/ownership-requests",
        json={
            "contact_name": "Dup User",
            "contact_email": "dup@example.com",
            "message": "second submission",
        },
    )

    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "OWNERSHIP_REQUEST_ALREADY_EXISTS"


# ---------------------------------------------------------------------------
# Admin approve — existing org path
# ---------------------------------------------------------------------------
def test_admin_approve_with_existing_org_promotes_requester_and_wires_owner(
    api, factories, db_session
):
    """Approving with an existing organization_id must:
      1. Flip request status to APPROVED.
      2. Create/activate a PlaceOwner row linking the org to the place.
      3. Create an OrganizationMember for the requester (ACTIVE).
      4. Promote requester role from CONSUMER to OWNER.
      5. Log an OWNERSHIP_GRANTED PlaceEvent.
    All in one atomic transaction.
    """
    admin = factories.admin()
    consumer = factories.consumer()  # will become the requester
    place = factories.place()
    org = factories.organization(name="The Real Owner LLC")
    req = factories.ownership_request(place=place, requester=consumer)

    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/approve",
        json={
            "organization_id": str(org.id),
            "member_role": "OWNER_ADMIN",
            "place_owner_role": "PRIMARY",
            "note": "verified via email + menu photos",
        },
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == OwnershipRequestStatus.APPROVED.value

    # PlaceOwner link now exists and is active.
    po = db_session.execute(
        select(PlaceOwner).where(
            PlaceOwner.place_id == place.id,
            PlaceOwner.organization_id == org.id,
        )
    ).scalar_one()
    assert po.status == "ACTIVE"
    assert po.role == "PRIMARY"

    # OrganizationMember for the requester exists and is active.
    member = db_session.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org.id,
            OrganizationMember.user_id == consumer.id,
        )
    ).scalar_one()
    assert member.status == "ACTIVE"
    assert member.role == "OWNER_ADMIN"

    # Consumer got promoted to OWNER.
    db_session.refresh(consumer)
    assert consumer.role == UserRole.OWNER.value

    # Place event logged with the admin as actor.
    events = db_session.execute(
        select(PlaceEvent).where(
            PlaceEvent.place_id == place.id,
            PlaceEvent.event_type == PlaceEventType.OWNERSHIP_GRANTED.value,
        )
    ).scalars().all()
    assert len(events) == 1
    assert events[0].actor_user_id == admin.id


# ---------------------------------------------------------------------------
# Admin approve — new org path
# ---------------------------------------------------------------------------
def test_admin_approve_with_new_organization_name_creates_org(
    api, factories, db_session
):
    """When no organization_id is provided but new_organization_name is,
    the endpoint must create the Organization on the fly and link
    everything to it."""
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    req = factories.ownership_request(place=place, requester=consumer)

    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/approve",
        json={
            "new_organization_name": "Fresh Halal Group",
            "member_role": "OWNER_ADMIN",
            "place_owner_role": "PRIMARY",
        },
    )

    assert resp.status_code == 200, resp.text

    # A new Organization with that name must now exist.
    org = db_session.execute(
        select(Organization).where(Organization.name == "Fresh Halal Group")
    ).scalar_one()

    # And the PlaceOwner must link to it.
    link = db_session.execute(
        select(PlaceOwner).where(
            PlaceOwner.place_id == place.id,
            PlaceOwner.organization_id == org.id,
        )
    ).scalar_one()
    assert link.status == "ACTIVE"


def test_admin_approve_rejects_both_or_neither_org(api, factories):
    """Approve must take exactly one of (organization_id, new_organization_name).
    Passing both is ambiguous; passing neither is useless. Both must 409."""
    admin = factories.admin()
    place = factories.place()
    org = factories.organization()
    req = factories.ownership_request(place=place)

    # Neither field.
    resp_neither = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/approve",
        json={"member_role": "OWNER_ADMIN", "place_owner_role": "PRIMARY"},
    )
    assert resp_neither.status_code == 409, resp_neither.text
    assert resp_neither.json()["error"]["code"] == "OWNERSHIP_APPROVE_BAD_ORG"

    # Both fields.
    resp_both = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/approve",
        json={
            "organization_id": str(org.id),
            "new_organization_name": "Some Other Org",
            "member_role": "OWNER_ADMIN",
            "place_owner_role": "PRIMARY",
        },
    )
    assert resp_both.status_code == 409, resp_both.text
    assert resp_both.json()["error"]["code"] == "OWNERSHIP_APPROVE_BAD_ORG"


# ---------------------------------------------------------------------------
# Admin reject
# ---------------------------------------------------------------------------
def test_admin_reject_flips_status_and_logs_event(api, factories, db_session):
    """Rejecting a request flips it to REJECTED, stops future actions, and
    records an OWNERSHIP_REQUEST_REJECTED PlaceEvent with the reason."""
    admin = factories.admin()
    place = factories.place()
    req = factories.ownership_request(place=place)

    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/reject",
        json={"reason": "contact_name didn't match business records"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == OwnershipRequestStatus.REJECTED.value

    db_session.refresh(req)
    assert req.status == OwnershipRequestStatus.REJECTED.value

    events = db_session.execute(
        select(PlaceEvent).where(
            PlaceEvent.place_id == place.id,
            PlaceEvent.event_type == (
                PlaceEventType.OWNERSHIP_REQUEST_REJECTED.value
            ),
        )
    ).scalars().all()
    assert len(events) == 1
    assert "didn't match" in (events[0].message or "")


# ---------------------------------------------------------------------------
# Admin request evidence
# ---------------------------------------------------------------------------
def test_admin_request_evidence_is_idempotent(api, factories, db_session):
    """Calling request-evidence twice on the same request must succeed both
    times and not log a duplicate NEEDS_EVIDENCE place event."""
    admin = factories.admin()
    place = factories.place()
    req = factories.ownership_request(place=place)

    first = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/request-evidence",
        json={"note": "please send a business license"},
    )
    second = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/request-evidence",
        json={"note": "(second attempt)"},
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    db_session.refresh(req)
    assert req.status == OwnershipRequestStatus.NEEDS_EVIDENCE.value

    events = db_session.execute(
        select(PlaceEvent).where(
            PlaceEvent.place_id == place.id,
            PlaceEvent.event_type == (
                PlaceEventType.OWNERSHIP_REQUEST_NEEDS_EVIDENCE.value
            ),
        )
    ).scalars().all()
    # Only the first call transitioned status + logged the event; the
    # second call is a no-op.
    assert len(events) == 1


# ---------------------------------------------------------------------------
# Terminal-status lock
# ---------------------------------------------------------------------------
def test_cannot_modify_terminal_ownership_request(api, factories):
    """Once a request is APPROVED, REJECTED, or CANCELLED, no admin action
    may re-open it. Every modification endpoint must 409 with
    OWNERSHIP_REQUEST_TERMINAL."""
    admin = factories.admin()
    place = factories.place()
    approved = factories.ownership_request(
        place=place, status=OwnershipRequestStatus.APPROVED
    )

    # Re-approve.
    re_approve = api.as_user(admin).post(
        f"/admin/ownership-requests/{approved.id}/approve",
        json={
            "new_organization_name": "Trying Again LLC",
            "member_role": "OWNER_ADMIN",
            "place_owner_role": "PRIMARY",
        },
    )
    assert re_approve.status_code == 409, re_approve.text
    assert re_approve.json()["error"]["code"] == "OWNERSHIP_REQUEST_TERMINAL"

    # Re-reject.
    re_reject = api.as_user(admin).post(
        f"/admin/ownership-requests/{approved.id}/reject",
        json={"reason": "on second thought"},
    )
    assert re_reject.status_code == 409, re_reject.text
    assert re_reject.json()["error"]["code"] == "OWNERSHIP_REQUEST_TERMINAL"

    # Re-request evidence.
    re_evidence = api.as_user(admin).post(
        f"/admin/ownership-requests/{approved.id}/request-evidence",
        json={"note": "more docs please"},
    )
    assert re_evidence.status_code == 409, re_evidence.text
    assert re_evidence.json()["error"]["code"] == "OWNERSHIP_REQUEST_TERMINAL"
