"""Integration tests for the halal claim lifecycle.

Covers:
  - Submission (role gating, ownership gating)
  - Evidence upload
  - Verification (role gating, idempotency, expired-claim rejection)
  - Refresh (evidence requirement, expiry window gating, successful renewal)
  - Dispute (role gating, expired-claim rejection)
  - Claim detail endpoint (returns events + evidence)

Each test is self-contained: it builds any users / places / orgs / claims it
needs via ``factories``, then exercises one HTTP path and asserts on the
response plus the relevant DB state.
"""
from __future__ import annotations

from sqlalchemy import select

from app.modules.claims.enums import ClaimEventType, ClaimScope, ClaimStatus, ClaimType
from app.modules.claims.models import ClaimEvent, Evidence, HalalClaim


# ---------------------------------------------------------------------------
# Submission
# ---------------------------------------------------------------------------
def test_owner_can_create_claim_for_managed_place(api, factories, db_session):
    """Happy path: an OWNER who belongs to the org that owns a place can
    submit a new claim on it. Response should include the generated id and
    PENDING status."""
    owner = factories.owner()
    place, _org = factories.managed_place(owner=owner)

    resp = api.as_user(owner).post(
        "/claims",
        json={
            "place_id": str(place.id),
            "claim_type": ClaimType.ZABIHA.value,
            "scope": ClaimScope.ALL_MENU.value,
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["place_id"] == str(place.id)
    assert body["claim_type"] == ClaimType.ZABIHA.value
    assert body["status"] == ClaimStatus.PENDING.value

    # A submitted event should have been logged.
    events = db_session.execute(
        select(ClaimEvent).where(ClaimEvent.claim_id == body["id"])
    ).scalars().all()
    assert any(ev.event_type == ClaimEventType.SUBMITTED for ev in events)


def test_owner_cannot_create_claim_for_unmanaged_place(api, factories):
    """An OWNER may only submit claims on places owned by an org they belong
    to. Submitting against a place owned by someone else must 403."""
    intruder = factories.owner()
    # The place is managed by a different owner/org; intruder has no link.
    other_owner = factories.owner()
    other_place, _ = factories.managed_place(owner=other_owner)

    resp = api.as_user(intruder).post(
        "/claims",
        json={
            "place_id": str(other_place.id),
            "claim_type": ClaimType.PORK_FREE.value,
            "scope": ClaimScope.ALL_MENU.value,
        },
    )

    assert resp.status_code == 403, resp.text


def test_consumer_cannot_submit_claim(api, factories):
    """Only OWNER and ADMIN can submit claims. CONSUMER must 403 before
    any ownership check runs."""
    consumer = factories.consumer()
    place = factories.place()

    resp = api.as_user(consumer).post(
        "/claims",
        json={
            "place_id": str(place.id),
            "claim_type": ClaimType.HALAL_MEAT_AVAILABLE.value,
            "scope": ClaimScope.ALL_MENU.value,
        },
    )

    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------
def test_owner_can_add_evidence_to_managed_claim(api, factories, db_session):
    """An owner can attach evidence to a claim on a place they manage. The
    evidence row should be linked and a claim event logged."""
    owner = factories.owner()
    place, _org = factories.managed_place(owner=owner)
    claim = factories.claim(place=place, created_by=owner)

    resp = api.as_user(owner).post(
        f"/claims/{claim.id}/evidence",
        json={
            "evidence_type": "certificate",
            "uri": "https://example.test/cert-123.pdf",
            "notes": "HFSAA cert, valid through next year",
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["claim_id"] == str(claim.id)
    assert body["evidence_type"] == "certificate"

    # Evidence persisted; event logged.
    rows = db_session.execute(
        select(Evidence).where(Evidence.claim_id == claim.id)
    ).scalars().all()
    assert len(rows) == 1

    events = db_session.execute(
        select(ClaimEvent).where(ClaimEvent.claim_id == claim.id)
    ).scalars().all()
    assert any(ev.event_type == ClaimEventType.EVIDENCE_ADDED for ev in events)


# ---------------------------------------------------------------------------
# Claim detail
# ---------------------------------------------------------------------------
def test_claim_detail_returns_events_and_evidence(api, factories):
    """GET /claims/{id} must return the claim plus its evidence and events
    in a single payload, in expected order."""
    owner = factories.owner()
    place, _org = factories.managed_place(owner=owner)
    claim = factories.claim(place=place, created_by=owner)
    factories.evidence(claim=claim, uploaded_by=owner, evidence_type="menu_photo")
    factories.evidence(claim=claim, uploaded_by=owner, evidence_type="supplier_letter")

    resp = api.get(f"/claims/{claim.id}")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(claim.id)
    assert len(body["evidence"]) == 2
    # Evidence is ordered by created_at desc — both created now, so both present.
    types = {e["evidence_type"] for e in body["evidence"]}
    assert types == {"menu_photo", "supplier_letter"}
    # Events always include at least nothing pre-seeded; factory doesn't log,
    # so this claim has zero events. That is the contract: events list exists.
    assert body["events"] == []


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
def test_verifier_can_verify_pending_claim(api, factories, db_session):
    """A VERIFIER can verify a PENDING claim. Status flips to VERIFIED and
    a VERIFIED event is recorded."""
    verifier = factories.verifier()
    place = factories.place()
    claim = factories.claim(place=place)

    resp = api.as_user(verifier).post(f"/claims/{claim.id}/verify")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == ClaimStatus.VERIFIED.value

    db_session.refresh(claim)
    assert claim.status == ClaimStatus.VERIFIED

    events = db_session.execute(
        select(ClaimEvent).where(ClaimEvent.claim_id == claim.id)
    ).scalars().all()
    assert any(ev.event_type == ClaimEventType.VERIFIED for ev in events)


def test_verify_expired_claim_returns_409(api, factories):
    """Verifying a claim whose expires_at has passed must return 409
    CLAIM_EXPIRED — we don't want verified status on a dead claim."""
    verifier = factories.verifier()
    place = factories.place()
    claim = factories.claim(place=place)
    factories.make_claim_expire_in(claim, days=-1)  # expired yesterday

    resp = api.as_user(verifier).post(f"/claims/{claim.id}/verify")

    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "CLAIM_EXPIRED"


def test_verify_is_idempotent(api, factories, db_session):
    """Calling verify twice on the same claim must succeed both times and
    not write a second VERIFIED event."""
    verifier = factories.verifier()
    place = factories.place()
    claim = factories.claim(place=place)

    first = api.as_user(verifier).post(f"/claims/{claim.id}/verify")
    second = api.as_user(verifier).post(f"/claims/{claim.id}/verify")

    assert first.status_code == 200
    assert second.status_code == 200

    events = db_session.execute(
        select(ClaimEvent).where(
            ClaimEvent.claim_id == claim.id,
            ClaimEvent.event_type == ClaimEventType.VERIFIED,
        )
    ).scalars().all()
    assert len(events) == 1


# ---------------------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------------------
def test_refresh_requires_evidence(api, factories):
    """Refresh must 409 if the claim has no evidence attached — we won't
    renew a trust statement that has nothing backing it."""
    owner = factories.owner()
    place, _ = factories.managed_place(owner=owner)
    claim = factories.claim(place=place, created_by=owner)
    # No evidence, and claim expires soon so it's otherwise eligible.
    factories.make_claim_expire_in(claim, days=1)

    resp = api.as_user(owner).post(
        f"/claims/{claim.id}/refresh",
        json={"reason": "Please renew my claim"},
    )

    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "CLAIM_EVIDENCE_REQUIRED"


def test_refresh_within_window_resets_expiry(api, factories, db_session):
    """A claim expiring inside the refresh window, with evidence attached,
    can be refreshed. expires_at moves forward and status returns to
    PENDING; a REFRESH_REQUESTED event is recorded."""
    owner = factories.owner()
    place, _ = factories.managed_place(owner=owner)
    claim = factories.claim(
        place=place,
        created_by=owner,
        status=ClaimStatus.VERIFIED,
    )
    factories.evidence(claim=claim, uploaded_by=owner)
    original_expires = factories.make_claim_expire_in(claim, days=3).expires_at

    resp = api.as_user(owner).post(
        f"/claims/{claim.id}/refresh",
        json={"reason": "annual renewal"},
    )

    assert resp.status_code == 200, resp.text
    db_session.refresh(claim)
    assert claim.status == ClaimStatus.PENDING
    assert claim.expires_at > original_expires

    events = db_session.execute(
        select(ClaimEvent).where(
            ClaimEvent.claim_id == claim.id,
            ClaimEvent.event_type == ClaimEventType.REFRESH_REQUESTED,
        )
    ).scalars().all()
    assert len(events) == 1


def test_refresh_outside_window_is_rejected(api, factories):
    """A claim with plenty of time left (outside CLAIM_REFRESH_WINDOW_DAYS)
    cannot be refreshed yet — we don't want owners perpetually extending
    expiry far in advance."""
    owner = factories.owner()
    place, _ = factories.managed_place(owner=owner)
    claim = factories.claim(place=place, created_by=owner)
    factories.evidence(claim=claim, uploaded_by=owner)
    factories.make_claim_expire_in(claim, days=60)  # well outside default 14d window

    resp = api.as_user(owner).post(
        f"/claims/{claim.id}/refresh",
        json={"reason": "too early"},
    )

    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "CLAIM_NOT_EXPIRING"


# ---------------------------------------------------------------------------
# Dispute
# ---------------------------------------------------------------------------
def test_consumer_can_dispute_verified_claim(api, factories, db_session):
    """A consumer can raise a dispute against a verified claim. Status flips
    to DISPUTED and a DISPUTED event is recorded with the supplied reason."""
    consumer = factories.consumer()
    place = factories.place()
    claim = factories.claim(place=place, status=ClaimStatus.VERIFIED)

    resp = api.as_user(consumer).post(
        f"/claims/{claim.id}/dispute",
        json={"reason": "I saw pork on the shared fryer"},
    )

    assert resp.status_code == 200, resp.text
    db_session.refresh(claim)
    assert claim.status == ClaimStatus.DISPUTED

    events = db_session.execute(
        select(ClaimEvent).where(
            ClaimEvent.claim_id == claim.id,
            ClaimEvent.event_type == ClaimEventType.DISPUTED,
        )
    ).scalars().all()
    assert len(events) == 1
    assert "pork" in (events[0].message or "")


def test_dispute_expired_claim_returns_409(api, factories):
    """An expired claim can't be disputed — it's already effectively
    invalid; there's nothing to dispute."""
    consumer = factories.consumer()
    place = factories.place()
    claim = factories.claim(place=place, status=ClaimStatus.VERIFIED)
    factories.make_claim_expire_in(claim, days=-2)

    resp = api.as_user(consumer).post(
        f"/claims/{claim.id}/dispute",
        json={"reason": "menu changed"},
    )

    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "CLAIM_EXPIRED"


# ---------------------------------------------------------------------------
# Admin claim actions — reason round-trips into ClaimEvent.message
#
# The admin panel surfaces ``ClaimEvent.message`` verbatim on the claim
# detail page, so if the reason stops landing in the message, audit rows
# go vague. These tests pin the "Admin {action} claim: {reason}" contract
# that admin_verify_claim / admin_reject_claim / admin_expire_claim all
# emit today.
# ---------------------------------------------------------------------------
def test_admin_verify_claim_embeds_reason_in_event_message(
    api, factories, db_session
):
    admin = factories.admin()
    place = factories.place()
    claim = factories.claim(place=place)

    resp = api.as_user(admin).post(
        f"/admin/claims/{claim.id}/verify",
        json={"reason": "Certificate on file verified by inspector"},
    )
    assert resp.status_code == 200, resp.text

    event = db_session.execute(
        select(ClaimEvent)
        .where(ClaimEvent.claim_id == claim.id)
        .where(ClaimEvent.event_type == ClaimEventType.ADMIN_VERIFIED)
    ).scalar_one()
    assert event.message == (
        "Admin verified claim: Certificate on file verified by inspector"
    )


def test_admin_reject_claim_embeds_reason_in_event_message(
    api, factories, db_session
):
    admin = factories.admin()
    place = factories.place()
    claim = factories.claim(place=place)

    resp = api.as_user(admin).post(
        f"/admin/claims/{claim.id}/reject",
        json={"reason": "Supplied certificate had been revoked"},
    )
    assert resp.status_code == 200, resp.text

    event = db_session.execute(
        select(ClaimEvent)
        .where(ClaimEvent.claim_id == claim.id)
        .where(ClaimEvent.event_type == ClaimEventType.ADMIN_REJECTED)
    ).scalar_one()
    assert event.message == (
        "Admin rejected claim: Supplied certificate had been revoked"
    )


def test_admin_expire_claim_embeds_reason_in_event_message(
    api, factories, db_session
):
    admin = factories.admin()
    place = factories.place()
    claim = factories.claim(place=place, status=ClaimStatus.VERIFIED)

    resp = api.as_user(admin).post(
        f"/admin/claims/{claim.id}/expire",
        json={"reason": "Venue changed suppliers; prior claim no longer valid"},
    )
    assert resp.status_code == 200, resp.text

    event = db_session.execute(
        select(ClaimEvent)
        .where(ClaimEvent.claim_id == claim.id)
        .where(ClaimEvent.event_type == ClaimEventType.ADMIN_EXPIRED)
    ).scalar_one()
    assert event.message == (
        "Admin expired claim: Venue changed suppliers; prior claim no"
        " longer valid"
    )


def test_admin_claim_actions_require_reason(api, factories):
    """``AdminClaimAction`` has ``reason: Field(..., min_length=3)``. These
    are the "bad news" actions; we want callers to supply context every
    time, so a missing or too-short reason must 422 rather than silently
    letting the state transition through."""
    admin = factories.admin()
    place = factories.place()
    claim = factories.claim(place=place)

    for endpoint in ("verify", "reject", "expire"):
        # Missing reason
        missing = api.as_user(admin).post(
            f"/admin/claims/{claim.id}/{endpoint}",
            json={},
        )
        assert missing.status_code == 422, (endpoint, missing.text)
        assert missing.json()["error"]["code"] == "VALIDATION_ERROR"

        # Too short
        short = api.as_user(admin).post(
            f"/admin/claims/{claim.id}/{endpoint}",
            json={"reason": "ok"},
        )
        assert short.status_code == 422, (endpoint, short.text)
        assert short.json()["error"]["code"] == "VALIDATION_ERROR"
