"""Tests for the notification dispatch core + unsubscribe flow."""
from __future__ import annotations

from uuid import uuid4

from fastapi import BackgroundTasks

from app.core.notifications import (
    NotificationCategory,
    build_unsubscribe_url,
    is_unsubscribed,
    make_unsubscribe_token,
    notify,
    unsubscribe,
    verify_unsubscribe_token,
)


# ---------------------------------------------------------------------------
# Unsubscribe token (stateless HMAC)
# ---------------------------------------------------------------------------
def test_unsubscribe_token_roundtrips():
    uid = uuid4()
    token = make_unsubscribe_token(uid, "PLACE_VERIFIED")
    parsed = verify_unsubscribe_token(token)
    assert parsed == (uid, "PLACE_VERIFIED")


def test_unsubscribe_token_rejects_tampering():
    uid = uuid4()
    token = make_unsubscribe_token(uid, "PLACE_VERIFIED")
    # Flip a character in the signature half.
    body, sig = token.split(".", 1)
    tampered = f"{body}.{'A' if sig[0] != 'A' else 'B'}{sig[1:]}"
    assert verify_unsubscribe_token(tampered) is None
    assert verify_unsubscribe_token("garbage") is None


def test_build_unsubscribe_url_contains_endpoint_and_token():
    url = build_unsubscribe_url(uuid4(), "PLACE_VERIFIED")
    assert "/notifications/unsubscribe?token=" in url


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------
def test_is_unsubscribed_and_unsubscribe(db_session, factories):
    user = factories.user(email="optout@example.com", is_active=True)
    db_session.commit()

    assert is_unsubscribed(db_session, user_id=user.id, category="PLACE_VERIFIED") is False
    unsubscribe(db_session, user_id=user.id, category="PLACE_VERIFIED")
    assert is_unsubscribed(db_session, user_id=user.id, category="PLACE_VERIFIED") is True
    # Idempotent — second call is a no-op, not an IntegrityError.
    unsubscribe(db_session, user_id=user.id, category="PLACE_VERIFIED")


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
def test_notify_optout_suppresses_nonmandatory(db_session, factories):
    user = factories.user(email="suppress@example.com", is_active=True)
    unsubscribe(db_session, user_id=user.id, category="PLACE_VERIFIED")

    bg = BackgroundTasks()
    scheduled = notify(
        bg,
        db=db_session,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        category=NotificationCategory.PLACE_VERIFIED,
        subject="A place you saved is verified",
        template="place_verified_saver",
        context={"preheader": "x", "place_name": "Somewhere"},
    )
    assert scheduled is False
    assert len(bg.tasks) == 0


def test_notify_mandatory_ignores_optout(db_session, factories):
    user = factories.user(email="mandatory@example.com", is_active=True)
    # Even if a row somehow exists, mandatory categories always send.
    unsubscribe(db_session, user_id=user.id, category="CLAIM_DECISION")

    bg = BackgroundTasks()
    scheduled = notify(
        bg,
        db=db_session,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        category=NotificationCategory.CLAIM_DECISION,
        subject="Approved",
        template="claim_approved",
        context={
            "preheader": "x",
            "place_name": "Somewhere",
            "tier_label": "Trust Halal Verified",
            "portal_url": "https://owner.example/x",
        },
    )
    assert scheduled is True
    assert len(bg.tasks) == 1


# ---------------------------------------------------------------------------
# Unsubscribe endpoints (two-step: GET landing does not mutate)
# ---------------------------------------------------------------------------
def test_unsubscribe_get_landing_does_not_mutate(api, db_session, factories):
    user = factories.user(email="landing@example.com", is_active=True)
    db_session.commit()
    token = make_unsubscribe_token(user.id, "PLACE_VERIFIED")

    resp = api.get("/notifications/unsubscribe", params={"token": token})
    assert resp.status_code == 200
    assert "unsubscribe" in resp.text.lower()
    # GET must not opt the user out — prefetch protection.
    assert is_unsubscribed(db_session, user_id=user.id, category="PLACE_VERIFIED") is False


def test_unsubscribe_post_opts_out(api, db_session, factories):
    user = factories.user(email="postout@example.com", is_active=True)
    db_session.commit()
    token = make_unsubscribe_token(user.id, "PLACE_VERIFIED")

    resp = api.post("/notifications/unsubscribe", data={"token": token})
    assert resp.status_code == 200
    db_session.expire_all()
    assert is_unsubscribed(db_session, user_id=user.id, category="PLACE_VERIFIED") is True


def test_unsubscribe_invalid_token_400(api):
    resp = api.get("/notifications/unsubscribe", params={"token": "nope.nope"})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Recipient resolution + fan-out (events.py)
# ---------------------------------------------------------------------------
def test_owner_users_for_place_returns_active_owner(db_session, factories):
    from app.modules.notifications.events import owner_users_for_place

    owner = factories.owner()
    place, _org = factories.managed_place(owner=owner)
    db_session.commit()

    owners = owner_users_for_place(db_session, place.id)
    assert owner.id in {u.id for u in owners}


def test_place_verified_fanout_notifies_savers(db_session, factories):
    from app.modules.favorites.models import ConsumerFavorite
    from app.modules.notifications.events import notify_place_verified_savers

    place = factories.place()
    saver = factories.consumer(email="saver@example.com")
    db_session.add(ConsumerFavorite(user_id=saver.id, place_id=place.id))
    db_session.commit()

    bg = BackgroundTasks()
    sent = notify_place_verified_savers(bg, db_session, place_id=place.id)
    assert sent == 1
    assert len(bg.tasks) == 1


def test_place_verified_fanout_respects_optout(db_session, factories):
    from app.modules.favorites.models import ConsumerFavorite
    from app.modules.notifications.events import notify_place_verified_savers

    place = factories.place()
    saver = factories.consumer(email="optout-saver@example.com")
    db_session.add(ConsumerFavorite(user_id=saver.id, place_id=place.id))
    unsubscribe(db_session, user_id=saver.id, category="PLACE_VERIFIED")
    db_session.commit()

    bg = BackgroundTasks()
    sent = notify_place_verified_savers(bg, db_session, place_id=place.id)
    assert sent == 0
    assert len(bg.tasks) == 0
