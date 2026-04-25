"""Integration tests for ``GET /admin/claims/{claim_id}/events``.

This endpoint powers the event timeline on the admin ClaimDetailDialog.
Beyond the raw event columns it returns ``actor_email`` and
``actor_display_name`` joined from the users table so the UI can answer
"who did this?" inline without a per-row user lookup.

Contract pinned here:
  * 404 for an unknown claim id.
  * Rows are newest-first (matches the timeline display).
  * Actor fields populate when ``actor_user_id`` resolves to a user.
  * Actor fields are null for events with no actor (batch jobs, null FK).
  * Actor fields are null when the user was deleted (SET NULL on FK) —
    simulated here by setting ``actor_user_id=None`` since the FK cascade
    rules already cover the real path.
  * Admin role required.
"""
from __future__ import annotations

from app.modules.claims.enums import ClaimEventType
from app.modules.claims.repo import log_claim_event


# ---------------------------------------------------------------------------
# 404 + role gating
# ---------------------------------------------------------------------------
def test_list_claim_events_404_for_unknown_claim(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).get(
        "/admin/claims/00000000-0000-4000-8000-000000000000/events"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "CLAIM_NOT_FOUND"


def test_owner_and_consumer_cannot_list_claim_events(api, factories):
    """Owner/consumer bounce; verifier is allowed (see separate test).

    VERIFIER has read access to the queue + events so the admin panel
    /claims page works for them too. Moderation actions (verify,
    reject, expire) remain ADMIN-only.
    """
    place = factories.place()
    claim = factories.claim(place=place)
    for role_builder in (factories.owner, factories.consumer):
        user = role_builder()
        resp = api.as_user(user).get(f"/admin/claims/{claim.id}/events")
        assert resp.status_code == 403, (role_builder.__name__, resp.text)


def test_verifier_can_list_claim_events(api, factories):
    """VERIFIER reads the same event timeline ADMIN does."""
    verifier = factories.verifier()
    place = factories.place()
    claim = factories.claim(place=place)

    resp = api.as_user(verifier).get(f"/admin/claims/{claim.id}/events")
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# Actor enrichment
# ---------------------------------------------------------------------------
def test_events_include_actor_email_and_display_name(api, factories, db_session):
    """After an admin action, the timeline row carries the admin's
    email + display_name so the dialog can render "by <name>".
    """
    admin = factories.admin(
        email="ops@trusthalal.example",
        display_name="Ops Admin",
    )
    place = factories.place()
    claim = factories.claim(place=place)

    # Exercise the real admin-verify path instead of hand-rolling an
    # event — guarantees the endpoint works on the event shape our
    # repos actually write.
    verify = api.as_user(admin).post(
        f"/admin/claims/{claim.id}/verify",
        json={"reason": "Certificate looks good"},
    )
    assert verify.status_code == 200, verify.text

    resp = api.as_user(admin).get(f"/admin/claims/{claim.id}/events")
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) >= 1

    # Newest-first ordering: the ADMIN_VERIFIED row is index 0.
    verified = rows[0]
    assert verified["event_type"] == ClaimEventType.ADMIN_VERIFIED.value
    assert verified["actor_user_id"] == str(admin.id)
    assert verified["actor_email"] == "ops@trusthalal.example"
    assert verified["actor_display_name"] == "Ops Admin"
    # Message should carry the reason admin typed in.
    assert "Certificate looks good" in verified["message"]


def test_events_actor_fields_are_null_when_no_actor(api, factories, db_session):
    """Batch-job events (``EXPIRED``) and SET-NULL'd rows carry no actor.

    The LEFT JOIN on users must leave actor_email / actor_display_name
    null rather than skipping the row — the timeline still needs to
    show the event.
    """
    admin = factories.admin()
    place = factories.place()
    claim = factories.claim(place=place)

    # Log an event with no actor (mimics scripts/expire_claims.py +
    # any row whose actor was later deleted).
    log_claim_event(
        db_session,
        claim_id=claim.id,
        event_type=ClaimEventType.EXPIRED,
        actor_user_id=None,
        message="Auto-expired by batch job",
    )
    db_session.commit()

    resp = api.as_user(admin).get(f"/admin/claims/{claim.id}/events")
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    # Find the EXPIRED row specifically — a claim might have other
    # events too in more elaborate setups.
    expired_rows = [r for r in rows if r["event_type"] == ClaimEventType.EXPIRED.value]
    assert len(expired_rows) == 1
    row = expired_rows[0]
    assert row["actor_user_id"] is None
    assert row["actor_email"] is None
    assert row["actor_display_name"] is None
    assert row["message"] == "Auto-expired by batch job"


# ---------------------------------------------------------------------------
# Ordering
# ---------------------------------------------------------------------------
def test_events_are_ordered_newest_first(api, factories, db_session):
    """Timeline renders top-to-bottom as "most recent first", so the
    server has to return events in ``created_at DESC`` order — relying
    on insert order is fragile across DB engines.
    """
    admin = factories.admin()
    place = factories.place()
    claim = factories.claim(place=place)

    # Log three events in a known order. Created_at comes from
    # server_default=now() so each call has a monotonic timestamp.
    log_claim_event(
        db_session,
        claim_id=claim.id,
        event_type=ClaimEventType.SUBMITTED,
        actor_user_id=None,
        message="first",
    )
    log_claim_event(
        db_session,
        claim_id=claim.id,
        event_type=ClaimEventType.EVIDENCE_ADDED,
        actor_user_id=None,
        message="second",
    )
    log_claim_event(
        db_session,
        claim_id=claim.id,
        event_type=ClaimEventType.DISPUTED,
        actor_user_id=None,
        message="third",
    )
    db_session.commit()

    resp = api.as_user(admin).get(f"/admin/claims/{claim.id}/events")
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    messages = [r["message"] for r in rows]
    # Newest first, so "third" is index 0.
    assert messages.index("third") < messages.index("second")
    assert messages.index("second") < messages.index("first")
