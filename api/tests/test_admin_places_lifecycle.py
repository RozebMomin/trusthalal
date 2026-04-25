"""Admin soft-delete + restore lifecycle tests for places.

These pin the "reason flows through to event history" contract so a
future refactor of the event-message composition can't silently strip
audit context. The place detail page surfaces ``PlaceEvent.message``
verbatim, so if the reason stops landing there, the admin UI goes back
to showing vague rows — exactly what we introduced the reason to fix.

Also covers the validation envelope (too-short / too-long reasons) and
the idempotent no-op behavior (double-delete, double-restore) to make
sure the repo guard clauses don't drift.
"""
from __future__ import annotations

from sqlalchemy import select

from app.modules.places.enums import PlaceEventType
from app.modules.places.models import PlaceEvent


# ---------------------------------------------------------------------------
# Soft-delete: reason round-trips into PlaceEvent.message
# ---------------------------------------------------------------------------
def test_soft_delete_with_reason_is_embedded_in_event_message(
    api, factories, db_session
):
    admin = factories.admin()
    place = factories.place()

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}",
        json={"reason": "Permanently closed per owner email on 2026-04-12"},
    )
    assert resp.status_code == 204, resp.text

    event = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.DELETED.value)
    ).scalar_one()

    # Full composition: base phrase + Reason: marker + supplied text.
    # Asserting the full shape — not just substring — guards against
    # both the reason disappearing AND the format drifting so badly that
    # "Admin soft-deleted place" disappears.
    assert event.message == (
        "Admin soft-deleted place. Reason: Permanently closed per owner"
        " email on 2026-04-12"
    )


def test_soft_delete_without_reason_falls_back_to_base_message(
    api, factories, db_session
):
    admin = factories.admin()
    place = factories.place()

    # Backward-compat: DELETE with no body still works.
    resp = api.as_user(admin).delete(f"/admin/places/{place.id}")
    assert resp.status_code == 204, resp.text

    event = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.DELETED.value)
    ).scalar_one()

    # No "Reason:" appended when none was supplied — matters because
    # appending an empty reason would make the history UI misleading.
    assert event.message == "Admin soft-deleted place"
    assert "Reason:" not in (event.message or "")


def test_soft_delete_strips_whitespace_around_reason(
    api, factories, db_session
):
    admin = factories.admin()
    place = factories.place()

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}",
        json={"reason": "   duplicate listing   "},
    )
    assert resp.status_code == 204, resp.text

    event = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.DELETED.value)
    ).scalar_one()

    # Leading/trailing whitespace gets trimmed by the repo before
    # composition. Keeps the audit row tidy even if the admin hit
    # return-then-space in the textarea.
    assert event.message == "Admin soft-deleted place. Reason: duplicate listing"


# ---------------------------------------------------------------------------
# Validation envelope (matches Pydantic min_length=3, max_length=500)
# ---------------------------------------------------------------------------
def test_soft_delete_rejects_too_short_reason(api, factories, db_session):
    admin = factories.admin()
    place = factories.place()

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}",
        json={"reason": "ab"},  # below the 3-char floor
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    # No event should be logged on a rejected request — the audit trail
    # must only reflect actual state changes.
    events = db_session.execute(
        select(PlaceEvent).where(PlaceEvent.place_id == place.id)
    ).scalars().all()
    assert all(
        e.event_type != PlaceEventType.DELETED.value for e in events
    )


def test_soft_delete_rejects_too_long_reason(api, factories):
    admin = factories.admin()
    place = factories.place()

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}",
        json={"reason": "x" * 501},  # one above the 500-char ceiling
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_soft_delete_rejects_unknown_fields(api, factories):
    """PlaceDeleteRequest uses extra='forbid'; typos in the client payload
    should reject instead of being silently dropped on the floor."""
    admin = factories.admin()
    place = factories.place()

    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}",
        json={"reason": "valid reason", "raeson": "typo"},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# Idempotency: repeat deletes don't stack audit rows
# ---------------------------------------------------------------------------
def test_soft_delete_is_idempotent_and_doesnt_double_log(
    api, factories, db_session
):
    admin = factories.admin()
    place = factories.place()

    api.as_user(admin).delete(
        f"/admin/places/{place.id}",
        json={"reason": "first delete"},
    )
    # Second delete: still 204, but no new event row and reason from the
    # second call is NOT applied (we don't rewrite history).
    resp = api.as_user(admin).delete(
        f"/admin/places/{place.id}",
        json={"reason": "second delete with different reason"},
    )
    assert resp.status_code == 204, resp.text

    events = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.DELETED.value)
    ).scalars().all()
    assert len(events) == 1
    assert events[0].message == "Admin soft-deleted place. Reason: first delete"


# ---------------------------------------------------------------------------
# Restore: reason round-trips into PlaceEvent.message
# ---------------------------------------------------------------------------
def test_restore_with_reason_is_embedded_in_event_message(
    api, factories, db_session
):
    admin = factories.admin()
    place = factories.place()

    # Delete first so there's something to restore.
    api.as_user(admin).delete(
        f"/admin/places/{place.id}",
        json={"reason": "setting up restore test"},
    )

    resp = api.as_user(admin).post(
        f"/admin/places/{place.id}/restore",
        json={"reason": "Reinstated after appeals review"},
    )
    assert resp.status_code == 204, resp.text

    event = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.RESTORED.value)
    ).scalar_one()
    assert event.message == (
        "Admin restored place. Reason: Reinstated after appeals review"
    )


def test_restore_without_reason_falls_back_to_base_message(
    api, factories, db_session
):
    admin = factories.admin()
    place = factories.place()

    api.as_user(admin).delete(f"/admin/places/{place.id}")
    resp = api.as_user(admin).post(f"/admin/places/{place.id}/restore")
    assert resp.status_code == 204, resp.text

    event = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.RESTORED.value)
    ).scalar_one()
    assert event.message == "Admin restored place"


def test_restore_of_live_place_is_idempotent_no_event_logged(
    api, factories, db_session
):
    """Restoring a place that's already active is a silent no-op — no event
    row, no error. Protects against a double-click on the Restore button."""
    admin = factories.admin()
    place = factories.place()  # starts live (not deleted)

    resp = api.as_user(admin).post(
        f"/admin/places/{place.id}/restore",
        json={"reason": "should not be logged"},
    )
    assert resp.status_code == 204, resp.text

    events = db_session.execute(
        select(PlaceEvent)
        .where(PlaceEvent.place_id == place.id)
        .where(PlaceEvent.event_type == PlaceEventType.RESTORED.value)
    ).scalars().all()
    assert events == []


def test_restore_rejects_too_short_reason(api, factories):
    admin = factories.admin()
    place = factories.place()
    api.as_user(admin).delete(f"/admin/places/{place.id}")

    resp = api.as_user(admin).post(
        f"/admin/places/{place.id}/restore",
        json={"reason": "hi"},  # below 3
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# Delete/restore still 404 cleanly on unknown ids
# ---------------------------------------------------------------------------
def test_soft_delete_unknown_place_returns_404(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).delete(
        # Valid-looking UUID that doesn't exist. 404 flows through the
        # AppError handler, so the error shape is the unified envelope.
        "/admin/places/00000000-0000-4000-8000-000000000000",
        json={"reason": "doesnt matter"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"


def test_restore_unknown_place_returns_404(api, factories):
    admin = factories.admin()
    resp = api.as_user(admin).post(
        "/admin/places/00000000-0000-4000-8000-000000000000/restore",
        json={"reason": "doesnt matter"},
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] == "PLACE_NOT_FOUND"
