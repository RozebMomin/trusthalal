"""Blocking another diner — App Store Review Guideline 1.2.

An app with user-generated content needs four things: filtering, reporting,
**blocking**, and published contact info. We had three the moment reviews
shipped.

The tests that matter here are the ones proving a block does something. A
stored row that doesn't change what the blocker sees would satisfy a
checklist and nothing else.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.modules.users.blocks import UserBlock

BODY = "Ordered the mixed grill and asked about the chicken; they showed me the certificate."
BODY_TWO = "Came back a second time with family. Same answer, same certificate on the counter."


def _verified(factories, db_session, email):
    u = factories.user(email=email)
    u.email_verified_at = datetime.now(timezone.utc)
    db_session.add(u)
    db_session.commit()
    return u


@pytest.fixture
def two_reviewers(factories, db_session):
    a = _verified(factories, db_session, f"blocker-{uuid4().hex[:8]}@example.com")
    b = _verified(factories, db_session, f"blocked-{uuid4().hex[:8]}@example.com")
    return a, b


def test_blocking_hides_that_persons_reviews(
    api, db_session, factories, two_reviewers, moderator
):
    """The whole point. If the list still shows them, the button is a lie."""
    blocker, blocked = two_reviewers
    place = factories.place(name="Block Test Grill")
    db_session.commit()

    api.as_user(blocked.id).post(
        f"/places/{place.id}/reviews", json={"rating": 1, "body": BODY}
    )
    api.as_user(blocker.id).post(
        f"/places/{place.id}/reviews", json={"rating": 5, "body": BODY_TWO}
    )

    seen_before = api.as_user(blocker.id).get(f"/places/{place.id}/reviews").json()
    assert len(seen_before["items"]) == 2

    assert (
        api.as_user(blocker.id).put(f"/me/blocks/{blocked.id}").status_code == 204
    )

    seen_after = api.as_user(blocker.id).get(f"/places/{place.id}/reviews").json()
    authors = [r["author"]["id"] for r in seen_after["items"]]
    assert str(blocked.id) not in authors
    assert len(seen_after["items"]) == 1


def test_total_reflects_what_the_viewer_can_see(
    api, db_session, factories, two_reviewers, moderator
):
    """Filtering after paging would leave `total` counting hidden rows, so the
    UI would say "showing 1 of 2" — a discrepancy reported only to the person
    who asked not to see the missing one."""
    blocker, blocked = two_reviewers
    place = factories.place(name="Total Test Grill")
    db_session.commit()

    api.as_user(blocked.id).post(
        f"/places/{place.id}/reviews", json={"rating": 1, "body": BODY}
    )
    api.as_user(blocker.id).post(
        f"/places/{place.id}/reviews", json={"rating": 5, "body": BODY_TWO}
    )
    api.as_user(blocker.id).put(f"/me/blocks/{blocked.id}")

    body = api.as_user(blocker.id).get(f"/places/{place.id}/reviews").json()
    assert body["total"] == 1


def test_blocking_is_one_directional(
    api, db_session, factories, two_reviewers, moderator
):
    """A block protects the blocker, it doesn't silence them. The blocked
    person still sees everything — they're not told, and nothing of theirs
    disappears from their own view."""
    blocker, blocked = two_reviewers
    place = factories.place(name="Direction Test Grill")
    db_session.commit()

    api.as_user(blocked.id).post(
        f"/places/{place.id}/reviews", json={"rating": 1, "body": BODY}
    )
    api.as_user(blocker.id).post(
        f"/places/{place.id}/reviews", json={"rating": 5, "body": BODY_TWO}
    )
    api.as_user(blocker.id).put(f"/me/blocks/{blocked.id}")

    theirs = api.as_user(blocked.id).get(f"/places/{place.id}/reviews").json()
    assert len(theirs["items"]) == 2


def test_anonymous_readers_are_unaffected(
    api, db_session, factories, two_reviewers, moderator
):
    """Blocking is a personal filter, not moderation. It must not remove
    content for anyone else — that's what reporting is for."""
    blocker, blocked = two_reviewers
    place = factories.place(name="Anon Test Grill")
    db_session.commit()

    api.as_user(blocked.id).post(
        f"/places/{place.id}/reviews", json={"rating": 1, "body": BODY}
    )
    api.as_user(blocker.id).put(f"/me/blocks/{blocked.id}")

    assert len(api.get(f"/places/{place.id}/reviews").json()["items"]) == 1


def test_blocking_twice_is_not_an_error(api, two_reviewers):
    """The desired state is already true. A 409 for "make this person go
    away" when they're already gone would be a baffling answer."""
    blocker, blocked = two_reviewers
    assert api.as_user(blocker.id).put(f"/me/blocks/{blocked.id}").status_code == 204
    assert api.as_user(blocker.id).put(f"/me/blocks/{blocked.id}").status_code == 204


def test_unblock_restores_visibility(
    api, db_session, factories, two_reviewers, moderator
):
    blocker, blocked = two_reviewers
    place = factories.place(name="Unblock Test Grill")
    db_session.commit()

    api.as_user(blocked.id).post(
        f"/places/{place.id}/reviews", json={"rating": 1, "body": BODY}
    )
    api.as_user(blocker.id).put(f"/me/blocks/{blocked.id}")
    assert api.as_user(blocker.id).get(f"/places/{place.id}/reviews").json()["items"] == []

    assert api.as_user(blocker.id).delete(f"/me/blocks/{blocked.id}").status_code == 204
    assert len(api.as_user(blocker.id).get(f"/places/{place.id}/reviews").json()["items"]) == 1


def test_cannot_block_yourself(api, two_reviewers):
    """Otherwise your own review vanishes from your own feed, which reads as
    a bug rather than a choice."""
    blocker, _ = two_reviewers
    resp = api.as_user(blocker.id).put(f"/me/blocks/{blocker.id}")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "CANNOT_BLOCK_SELF"


def test_blocking_a_stranger_404s(api, two_reviewers):
    blocker, _ = two_reviewers
    assert api.as_user(blocker.id).put(f"/me/blocks/{uuid4()}").status_code == 404


def test_blocks_are_listed_with_names(api, two_reviewers):
    """A column of UUIDs would make unblocking guesswork."""
    blocker, blocked = two_reviewers
    api.as_user(blocker.id).put(f"/me/blocks/{blocked.id}")

    listed = api.as_user(blocker.id).get("/me/blocks").json()
    assert [b["user_id"] for b in listed] == [str(blocked.id)]
    assert listed[0]["display_name"] == blocked.display_name


def test_anonymous_cannot_block(api, two_reviewers):
    _, blocked = two_reviewers
    assert api.put(f"/me/blocks/{blocked.id}").status_code == 401


def test_deleting_your_account_removes_your_blocks(
    api, db_session, factories, two_reviewers
):
    """Both sides cascade — the rows are personal data on both ends and
    shouldn't outlive either account."""
    blocker, blocked = two_reviewers
    api.as_user(blocker.id).put(f"/me/blocks/{blocked.id}")

    from app.modules.users.deletion import delete_account

    delete_account(db_session, user_id=blocker.id)
    db_session.commit()

    db_session.expire_all()
    assert db_session.execute(select(UserBlock)).scalars().all() == []
