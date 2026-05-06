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


def test_duplicate_active_request_blocks_anyone(api, factories):
    """Per-place duplicate guard: while ANY active claim is pending
    review on a place, a new claim from anyone (different email,
    different requester) must 409. Keeps the admin queue free of
    competing duplicates — staff finishes the open one first."""
    place = factories.place()

    first = api.as_anonymous().post(
        f"/places/{place.id}/ownership-requests",
        json={
            "contact_name": "First Claimant",
            "contact_email": "first@example.com",
            "message": "first submission",
        },
    )
    assert first.status_code == 201, first.text

    # Different email + name — same place. Pre-polish-pass-v4 this
    # would have been allowed; now it's blocked.
    second = api.as_anonymous().post(
        f"/places/{place.id}/ownership-requests",
        json={
            "contact_name": "Second Claimant",
            "contact_email": "second@example.com",
            "message": "second submission, different person",
        },
    )

    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "OWNERSHIP_REQUEST_ALREADY_EXISTS"


def test_admin_create_bypasses_per_place_duplicate_guard(
    api, factories, db_session
):
    """The admin "create on behalf of someone" path skips the
    per-place duplicate guard so staff can record an inbound
    phone-in / in-person intake even while another claim is in
    flight. Audit trail prefers two parallel rows over a
    phantom one that never got recorded."""
    admin = factories.admin()
    place = factories.place()

    first = api.as_anonymous().post(
        f"/places/{place.id}/ownership-requests",
        json={
            "contact_name": "Public Form Claimant",
            "contact_email": "public@example.com",
            "message": "submitted via the public form",
        },
    )
    assert first.status_code == 201, first.text

    # Admin records a phone-in intake against the same place — should
    # succeed, not 409.
    second = api.as_user(admin).post(
        "/admin/ownership-requests",
        json={
            "place_id": str(place.id),
            "contact_name": "Phone Intake Claimant",
            "contact_email": "intake@example.com",
            "message": "called in to claim, admin recorded",
        },
    )
    assert second.status_code == 201, second.text


# ---------------------------------------------------------------------------
# Admin approve — existing org path
# ---------------------------------------------------------------------------
def test_admin_approve_with_existing_org_promotes_requester_and_wires_owner(
    api, factories, db_session
):
    """Approving a claim filed under a VERIFIED org (the slice-5b
    canonical path) must:
      1. Flip request status to APPROVED.
      2. Create/activate a PlaceOwner row linking the org to the place.
      3. Create an OrganizationMember for the requester (ACTIVE).
      4. Promote requester role from CONSUMER to OWNER.
      5. Log an OWNERSHIP_GRANTED PlaceEvent.
    All in one atomic transaction. Body's organization_id is ignored
    (the claim already says which org sponsors it).
    """
    admin = factories.admin()
    consumer = factories.consumer()  # will become the requester
    place = factories.place()
    org = factories.organization(name="The Real Owner LLC")  # default VERIFIED
    req = factories.ownership_request(
        place=place, requester=consumer, organization=org
    )

    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/approve",
        json={
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
# Admin approve — slice 5d guards
# ---------------------------------------------------------------------------
def test_admin_approve_uses_claim_organization_id_when_set(
    api, factories, db_session
):
    """When the claim was filed via the owner portal (slice 5b), it
    carries organization_id directly. The body's organization_id is
    not required and gets ignored if supplied."""
    from app.modules.organizations.enums import OrganizationStatus

    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    claim_org = factories.organization(
        name="Claim Org",
        status=OrganizationStatus.VERIFIED,
    )
    other_org = factories.organization(
        name="Other Org",
        status=OrganizationStatus.VERIFIED,
    )
    req = factories.ownership_request(
        place=place, requester=consumer, organization=claim_org
    )

    # Pass a different org in the body — server should ignore it
    # and use the claim's.
    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/approve",
        json={
            "organization_id": str(other_org.id),
            "member_role": "OWNER_ADMIN",
            "place_owner_role": "PRIMARY",
        },
    )
    assert resp.status_code == 200, resp.text

    link = db_session.execute(
        select(PlaceOwner).where(PlaceOwner.place_id == place.id)
    ).scalar_one()
    # Linked to the claim's org, not the body's.
    assert link.organization_id == claim_org.id


def test_admin_approve_blocks_unverified_org(api, factories, db_session):
    """The sponsoring org must be VERIFIED. UNDER_REVIEW / DRAFT /
    REJECTED → 409 OWNERSHIP_APPROVE_ORG_NOT_VERIFIED so admin
    knows to verify the org first."""
    from app.modules.organizations.enums import OrganizationStatus

    admin = factories.admin()
    place = factories.place()
    org = factories.organization(
        name="Pending Co", status=OrganizationStatus.UNDER_REVIEW
    )
    req = factories.ownership_request(place=place, organization=org)

    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/approve",
        json={"member_role": "OWNER_ADMIN", "place_owner_role": "PRIMARY"},
    )
    assert resp.status_code == 409, resp.text
    assert (
        resp.json()["error"]["code"] == "OWNERSHIP_APPROVE_ORG_NOT_VERIFIED"
    )


def test_admin_approve_blocks_when_claim_has_no_org(api, factories):
    """Legacy claim filed via the public anonymous endpoint has no
    organization_id. Without a body organization_id, approval fails
    with OWNERSHIP_APPROVE_NO_ORG (400) so admin knows to either ask
    the requester to re-file via owner portal or supply an existing
    VERIFIED org."""
    admin = factories.admin()
    place = factories.place()
    req = factories.ownership_request(place=place)  # no organization

    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/approve",
        json={"member_role": "OWNER_ADMIN", "place_owner_role": "PRIMARY"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "OWNERSHIP_APPROVE_NO_ORG"


def test_admin_approve_legacy_claim_with_body_org_works(
    api, factories, db_session
):
    """Legacy anonymous claim → admin supplies organization_id in
    body → approval works as long as that org is VERIFIED."""
    from app.modules.organizations.enums import OrganizationStatus

    admin = factories.admin()
    place = factories.place()
    org = factories.organization(
        name="Picked By Admin", status=OrganizationStatus.VERIFIED
    )
    req = factories.ownership_request(place=place)  # no organization on claim

    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/approve",
        json={
            "organization_id": str(org.id),
            "member_role": "OWNER_ADMIN",
            "place_owner_role": "PRIMARY",
        },
    )
    assert resp.status_code == 200, resp.text

    link = db_session.execute(
        select(PlaceOwner).where(
            PlaceOwner.place_id == place.id,
            PlaceOwner.organization_id == org.id,
        )
    ).scalar_one()
    assert link.status == "ACTIVE"


# Slice 5d retired test_admin_approve_with_new_organization_name_creates_org
# and test_admin_approve_rejects_both_or_neither_org. The
# new_organization_name path is gone — admin no longer creates orgs
# during approval. The replacement contract (claim's org takes
# precedence; body fallback for legacy NULL claims; non-VERIFIED
# rejects) is exercised by the four tests immediately above this
# comment.


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


def test_admin_request_evidence_requires_note(api, factories):
    """note is required now (mirrors reject + verify) so the owner
    has actionable guidance on what to upload next. Empty body →
    422; the audit trail and the NEEDS_EVIDENCE state are
    pointless without it."""
    admin = factories.admin()
    place = factories.place()
    req = factories.ownership_request(place=place)

    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/request-evidence",
        json={},
    )
    assert resp.status_code == 422, resp.text


def test_admin_request_evidence_rejects_short_note(api, factories):
    """min_length=3 keeps a 1-char fat-finger from clearing the bar."""
    admin = factories.admin()
    place = factories.place()
    req = factories.ownership_request(place=place)

    resp = api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/request-evidence",
        json={"note": "x"},
    )
    assert resp.status_code == 422, resp.text


def test_admin_request_evidence_writes_decision_note(
    api, factories, db_session
):
    """The note lands on the row's decision_note column so the
    owner portal can render it. A second call overwrites with the
    latest instruction (the per-event audit trail keeps the prior
    on place_events)."""
    admin = factories.admin()
    place = factories.place()
    req = factories.ownership_request(place=place)

    api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/request-evidence",
        json={"note": "Please upload a business license."},
    )
    db_session.refresh(req)
    assert req.decision_note == "Please upload a business license."

    # Second call updates the note + keeps status idempotent.
    api.as_user(admin).post(
        f"/admin/ownership-requests/{req.id}/request-evidence",
        json={"note": "Actually, a utility bill works too."},
    )
    db_session.refresh(req)
    assert req.decision_note == "Actually, a utility bill works too."
    assert req.status == OwnershipRequestStatus.NEEDS_EVIDENCE.value


# ---------------------------------------------------------------------------
# Owner resubmit (NEEDS_EVIDENCE → UNDER_REVIEW)
# ---------------------------------------------------------------------------
def test_owner_resubmit_flips_needs_evidence_to_under_review(
    api, factories, db_session
):
    """Owner finishes uploading the requested docs and clicks
    Resubmit → status flips back to UNDER_REVIEW so admin queue
    picks it up again. A PlaceEvent records the transition."""
    admin = factories.admin()
    consumer = factories.consumer()
    place = factories.place()
    req = factories.ownership_request(
        place=place,
        requester=consumer,
        status=OwnershipRequestStatus.NEEDS_EVIDENCE,
    )
    db_session.commit()

    resp = api.as_user(consumer).post(
        f"/me/ownership-requests/{req.id}/resubmit"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == OwnershipRequestStatus.UNDER_REVIEW.value

    db_session.refresh(req)
    assert req.status == OwnershipRequestStatus.UNDER_REVIEW.value

    events = db_session.execute(
        select(PlaceEvent).where(
            PlaceEvent.place_id == place.id,
            PlaceEvent.event_type
            == PlaceEventType.OWNERSHIP_REQUEST_RESUBMITTED.value,
        )
    ).scalars().all()
    assert len(events) == 1
    # Resubmit should NOT also write to admin's request-evidence
    # event slot.
    _ = admin  # silence unused fixture if linter complains


def test_owner_resubmit_rejected_when_not_needs_evidence(
    api, factories, db_session
):
    """Resubmitting a claim that's still SUBMITTED (or any non-
    NEEDS_EVIDENCE status) returns 409 — there's nothing to
    resubmit."""
    consumer = factories.consumer()
    place = factories.place()
    req = factories.ownership_request(
        place=place,
        requester=consumer,
        status=OwnershipRequestStatus.SUBMITTED,
    )
    db_session.commit()

    resp = api.as_user(consumer).post(
        f"/me/ownership-requests/{req.id}/resubmit"
    )
    assert resp.status_code == 409, resp.text
    assert (
        resp.json()["error"]["code"]
        == "OWNERSHIP_REQUEST_NOT_RESUBMITTABLE"
    )


def test_owner_cannot_resubmit_someone_elses_claim(
    api, factories, db_session
):
    """Ownership gate: another user's claim returns 403, even if
    it's in NEEDS_EVIDENCE."""
    owner = factories.consumer(email="owner@example.com")
    other = factories.consumer(email="other@example.com")
    place = factories.place()
    req = factories.ownership_request(
        place=place,
        requester=owner,
        status=OwnershipRequestStatus.NEEDS_EVIDENCE,
    )
    db_session.commit()

    resp = api.as_user(other).post(
        f"/me/ownership-requests/{req.id}/resubmit"
    )
    assert resp.status_code == 403, resp.text


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

    # Re-approve. We pass an organization_id since
    # new_organization_name is gone; what we're asserting is that
    # the terminal-state guard fires before any org logic runs.
    other_org = factories.organization()
    re_approve = api.as_user(admin).post(
        f"/admin/ownership-requests/{approved.id}/approve",
        json={
            "organization_id": str(other_org.id),
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
