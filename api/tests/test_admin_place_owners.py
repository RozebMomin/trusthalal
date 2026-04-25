"""Integration tests for ``GET /admin/places/{place_id}/owners``.

The endpoint powers the "Ownership" section on the admin place detail
page. Its contract:

  * 404 with PLACE_NOT_FOUND for an unknown place id.
  * Works on soft-deleted places — admins need ownership context when
    triaging a restore decision.
  * Returns a ``PlaceOwnerAdminRead`` per ``place_owners`` row, with the
    nested organization summary carrying an active-member count.
  * Ordered ACTIVE-first (the "who's running this today" rows), then
    newest-first within a status group.
  * Admin role required; consumer/owner/verifier roles bounce.

These tests lock in that contract so a future repo tweak (e.g. switching
to LEFT JOIN, re-keying the subquery, changing the sort expression)
doesn't silently regress the detail page.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone


# ---------------------------------------------------------------------------
# 404 + empty list
# ---------------------------------------------------------------------------
def test_list_place_owners_404_for_unknown_place(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).get(
        "/admin/places/00000000-0000-4000-8000-000000000000/owners"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


def test_list_place_owners_empty_list_when_no_links(api, factories):
    admin = factories.admin()
    place = factories.place()  # no owner links created

    resp = api.as_user(admin).get(f"/admin/places/{place.id}/owners")
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


# ---------------------------------------------------------------------------
# Shape: one link → one response row with the expected org fields
# ---------------------------------------------------------------------------
def test_list_place_owners_returns_nested_organization_summary(
    api, factories
):
    admin = factories.admin()
    place = factories.place()
    org = factories.organization(
        name="Halal Guys LLC",
        contact_email="ops@halalguys.example",
    )
    link = factories.place_owner_link(
        place=place, organization=org  # defaults: role=PRIMARY, status=ACTIVE
    )

    resp = api.as_user(admin).get(f"/admin/places/{place.id}/owners")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1

    row = body[0]
    assert row["id"] == str(link.id)  # join-row id, not the org id
    assert row["role"] == "PRIMARY"
    assert row["status"] == "ACTIVE"
    assert row["organization"]["id"] == str(org.id)
    assert row["organization"]["name"] == "Halal Guys LLC"
    assert row["organization"]["contact_email"] == "ops@halalguys.example"
    # No members wired yet → count is 0, not null.
    assert row["organization"]["member_count"] == 0


# ---------------------------------------------------------------------------
# member_count: only active members contribute
# ---------------------------------------------------------------------------
def test_member_count_only_counts_active_members(api, factories):
    admin = factories.admin()
    place = factories.place()
    org = factories.organization()
    factories.place_owner_link(place=place, organization=org)

    # Two ACTIVE members + one INVITED. ``organization_members.status``
    # has a CHECK constraint allowing ('ACTIVE','INVITED','REMOVED') — we
    # use INVITED here (the "not yet accepted" state) since it's the
    # natural "non-counting" status. The subquery must exclude it.
    alice = factories.user()
    bob = factories.user()
    carol = factories.user()
    factories.org_member(organization=org, user=alice, status="ACTIVE")
    factories.org_member(organization=org, user=bob, status="ACTIVE")
    factories.org_member(organization=org, user=carol, status="INVITED")

    resp = api.as_user(admin).get(f"/admin/places/{place.id}/owners")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["organization"]["member_count"] == 2


def test_member_count_zero_when_all_members_inactive(api, factories):
    """OUTER JOIN on the member-count subquery means zero-active-member
    orgs still come back — the count is 0, not the row vanishing."""
    admin = factories.admin()
    place = factories.place()
    org = factories.organization()
    factories.place_owner_link(place=place, organization=org)

    # Member exists but isn't ACTIVE — the subquery filters this out.
    # INVITED is one of the allowed CHECK-constraint values; see the
    # d1f9a9091e2f migration.
    user = factories.user()
    factories.org_member(organization=org, user=user, status="INVITED")

    resp = api.as_user(admin).get(f"/admin/places/{place.id}/owners")
    body = resp.json()
    assert len(body) == 1
    assert body[0]["organization"]["member_count"] == 0


# ---------------------------------------------------------------------------
# Ordering
# ---------------------------------------------------------------------------
def test_list_place_owners_puts_active_before_other_statuses(api, factories):
    """A place can have at most one *live* owner — the ``uq_place_owners_
    one_active_owner`` partial unique index covers PENDING/ACTIVE/VERIFIED.
    REVOKED is excluded from that index, so a place can simultaneously
    have one live owner and any number of REVOKED historical owners.

    That's the shape we use here: one ACTIVE + one REVOKED (an old
    relationship that ended). The REVOKED row would sort first by
    insertion order (it's inserted first), so the ACTIVE-first sort key
    has to win for the assertion to pass.
    """
    admin = factories.admin()
    place = factories.place()
    revoked_org = factories.organization(name="Zeta Corp")  # alphabetical last
    active_org = factories.organization(name="Alpha Inc")  # alphabetical first

    factories.place_owner_link(
        place=place, organization=revoked_org, status="REVOKED"
    )
    factories.place_owner_link(
        place=place, organization=active_org, status="ACTIVE"
    )

    resp = api.as_user(admin).get(f"/admin/places/{place.id}/owners")
    body = resp.json()
    assert len(body) == 2
    # "Who's running this today" first, regardless of alphabetical/time order.
    assert body[0]["status"] == "ACTIVE"
    assert body[0]["organization"]["name"] == "Alpha Inc"
    assert body[1]["status"] == "REVOKED"
    assert body[1]["organization"]["name"] == "Zeta Corp"


def test_list_place_owners_tiebreaks_by_newest_within_status(
    api, factories, db_session
):
    """Within the same status bucket, rows are ordered by ``created_at``
    DESC — newest-added first.

    Only REVOKED permits multiple rows per place (the partial unique
    index excludes it), so the test uses two REVOKED historical owners.
    Timestamps are pinned manually because the test harness's savepoint
    mode keeps func.now() constant within an outer transaction, so
    fixture-creation order doesn't give us a deterministic delta.
    """
    admin = factories.admin()
    place = factories.place()
    org_old = factories.organization(name="Older Org")
    org_new = factories.organization(name="Newer Org")

    old_link = factories.place_owner_link(
        place=place, organization=org_old, status="REVOKED"
    )
    new_link = factories.place_owner_link(
        place=place, organization=org_new, status="REVOKED"
    )

    # Pin creation times 2 days apart — both REVOKED, so the sort falls
    # through to the created_at DESC tiebreaker.
    old_link.created_at = datetime.now(timezone.utc) - timedelta(days=2)
    new_link.created_at = datetime.now(timezone.utc)
    db_session.add_all([old_link, new_link])
    db_session.flush()

    resp = api.as_user(admin).get(f"/admin/places/{place.id}/owners")
    body = resp.json()
    names = [row["organization"]["name"] for row in body]
    # Newer REVOKED link comes first within the REVOKED group.
    assert names == ["Newer Org", "Older Org"]


# ---------------------------------------------------------------------------
# Soft-deleted place still resolves
# ---------------------------------------------------------------------------
def test_list_place_owners_works_for_soft_deleted_place(
    api, factories, db_session
):
    """Admin triaging a restore decision needs the ownership context on
    soft-deleted places. ``get_place(include_deleted=True)`` in the repo
    is what makes that possible."""
    admin = factories.admin()
    place = factories.place()
    org = factories.organization()
    factories.place_owner_link(place=place, organization=org)

    place.is_deleted = True
    db_session.add(place)
    db_session.flush()

    resp = api.as_user(admin).get(f"/admin/places/{place.id}/owners")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["organization"]["id"] == str(org.id)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def test_list_place_owners_requires_admin_role(api, factories):
    consumer = factories.consumer()
    place = factories.place()

    resp = api.as_user(consumer).get(f"/admin/places/{place.id}/owners")
    # 401/403 both count as "rejected" — the require_roles dep returns
    # 403 for a non-admin, 401 for no header. We accept either rather
    # than coupling the test to the specific status code.
    assert resp.status_code in (401, 403), resp.text


def test_list_place_owners_requires_authentication(api, factories):
    place = factories.place()
    resp = api.as_anonymous().get(f"/admin/places/{place.id}/owners")
    assert resp.status_code in (401, 403), resp.text


# ===========================================================================
# DELETE /admin/places/{place_id}/owners/{owner_id}  — revoke ownership
# ===========================================================================
def test_revoke_owner_flips_status_to_revoked_and_logs_event(
    api, factories, db_session
):
    from sqlalchemy import select
    from app.modules.places.enums import PlaceEventType
    from app.modules.places.models import PlaceEvent
    from app.modules.organizations.models import PlaceOwner

    admin = factories.admin()
    place = factories.place()
    org = factories.organization(name="Acme Catering")
    link = factories.place_owner_link(place=place, organization=org)

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/owners/{link.id}",
        json={"reason": "Organization closed operations"},
    )
    assert resp.status_code == 204, resp.text

    # Row still exists — this is a SOFT unlink. The partial unique index
    # (WHERE status IN PENDING/ACTIVE/VERIFIED) excludes REVOKED, so the
    # place is also now eligible for a fresh live owner.
    db_session.expire_all()
    refreshed = db_session.execute(
        select(PlaceOwner).where(PlaceOwner.id == link.id)
    ).scalar_one()
    assert refreshed.status == "REVOKED"

    # Audit event names the org + prior status + reason. Filter by
    # message substring rather than ordering (see test_place_link_external
    # for the savepoint/timestamp collision rationale).
    events = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.EDITED.value)
    ).scalars().all()
    revoke_events = [
        e for e in events if "Revoked Acme Catering" in (e.message or "")
    ]
    assert len(revoke_events) == 1
    msg = revoke_events[0].message or ""
    assert "role=PRIMARY" in msg
    assert "was ACTIVE" in msg
    assert "Organization closed operations" in msg


def test_revoke_owner_without_reason_still_works(api, factories, db_session):
    """Backward-compat: callers without a body get a base message with
    no Reason suffix."""
    from sqlalchemy import select
    from app.modules.places.enums import PlaceEventType
    from app.modules.places.models import PlaceEvent

    admin = factories.admin()
    place = factories.place()
    org = factories.organization(name="Reasonless LLC")
    link = factories.place_owner_link(place=place, organization=org)

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/owners/{link.id}"
    )
    assert resp.status_code == 204, resp.text

    events = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.EDITED.value)
    ).scalars().all()
    revoke_events = [
        e for e in events if "Revoked Reasonless LLC" in (e.message or "")
    ]
    assert len(revoke_events) == 1
    assert "Reason:" not in (revoke_events[0].message or "")


def test_revoke_owner_is_idempotent_on_already_revoked(
    api, factories, db_session
):
    """Second revoke call on an already-REVOKED owner is a silent 204
    no-op — no new EDITED event. Guards against a double-click on the
    Revoke button stacking audit noise."""
    from sqlalchemy import select
    from app.modules.places.enums import PlaceEventType
    from app.modules.places.models import PlaceEvent

    admin = factories.admin()
    place = factories.place()
    org = factories.organization()
    link = factories.place_owner_link(
        place=place, organization=org, status="REVOKED"
    )

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/owners/{link.id}",
        json={"reason": "Should not be logged"},
    )
    assert resp.status_code == 204, resp.text

    # No new event from this call — the row was already REVOKED, so the
    # repo short-circuits without writing to place_events.
    events = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.EDITED.value)
    ).scalars().all()
    assert events == []


def test_revoke_owner_404_for_unknown_place(api, factories):
    admin = factories.admin()
    org = factories.organization()
    # Make a real PlaceOwner on a DIFFERENT place so we have a valid
    # owner_id lying around — this lets us prove that the 404 comes
    # from the place check, not just from "no such PlaceOwner."
    other_place = factories.place()
    link = factories.place_owner_link(place=other_place, organization=org)

    resp = api.as_user(admin).delete(
        f"/admin/places/00000000-0000-4000-8000-000000000000/owners/{link.id}"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


def test_revoke_owner_404_for_unknown_owner_id(api, factories):
    admin = factories.admin()
    place = factories.place()

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/owners/00000000-0000-4000-8000-000000000000"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "OWNERSHIP_NOT_FOUND"


def test_revoke_owner_404_when_owner_belongs_to_different_place(
    api, factories
):
    """Requiring (place_id, owner_id) to match protects against typoing
    the place_id in the URL and silently revoking an unrelated
    relationship."""
    admin = factories.admin()
    place_a = factories.place()
    place_b = factories.place()
    org = factories.organization()
    # Link belongs to place_b…
    link = factories.place_owner_link(place=place_b, organization=org)

    # …but we target place_a. Should 404 rather than succeed.
    resp = api.as_user(admin).delete(
        f"/admin/places/{place_a.id}/owners/{link.id}"
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "OWNERSHIP_NOT_FOUND"


def test_revoke_owner_rejects_too_short_reason(api, factories):
    admin = factories.admin()
    place = factories.place()
    org = factories.organization()
    link = factories.place_owner_link(place=place, organization=org)

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/owners/{link.id}",
        json={"reason": "x"},  # below min_length=3
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_revoke_owner_rejects_unknown_fields(api, factories):
    """``PlaceOwnerRevokeRequest`` uses extra='forbid'; a typoed field
    rejects with 422 instead of being silently dropped."""
    admin = factories.admin()
    place = factories.place()
    org = factories.organization()
    link = factories.place_owner_link(place=place, organization=org)

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/owners/{link.id}",
        json={"reason": "valid reason", "raeson": "typo"},
    )
    assert resp.status_code == 422, resp.text


def test_revoke_owner_requires_admin_role(api, factories):
    consumer = factories.consumer()
    place = factories.place()
    org = factories.organization()
    link = factories.place_owner_link(place=place, organization=org)

    resp = api.as_user(consumer).delete(
        f"/admin/places/{place.id}/owners/{link.id}"
    )
    assert resp.status_code in (401, 403), resp.text


def test_revoke_owner_frees_the_slot_for_a_new_live_owner(
    api, factories, db_session
):
    """After a revoke, the partial unique index should now permit
    another ACTIVE/PENDING/VERIFIED owner on the same place. Proves the
    "soft unlink" shape is actually usable, not just a status change
    that leaves the slot blocked."""
    admin = factories.admin()
    place = factories.place()
    first_org = factories.organization(name="First Owner")
    second_org = factories.organization(name="Second Owner")

    first_link = factories.place_owner_link(
        place=place, organization=first_org
    )  # ACTIVE by default

    # Revoke the first owner.
    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}/owners/{first_link.id}",
    )
    assert resp.status_code == 204

    # Now link a second live owner. If the partial unique index still
    # saw the REVOKED row as "live," this would 23505.
    factories.place_owner_link(place=place, organization=second_org)

    # Listing should surface the new ACTIVE one first, the REVOKED one
    # second (per the existing ACTIVE-first ordering contract).
    listing = api.as_user(admin).get(f"/admin/places/{place.id}/owners")
    assert listing.status_code == 200, listing.text
    rows = listing.json()
    assert [r["status"] for r in rows] == ["ACTIVE", "REVOKED"]
    assert rows[0]["organization"]["name"] == "Second Owner"
    assert rows[1]["organization"]["name"] == "First Owner"
