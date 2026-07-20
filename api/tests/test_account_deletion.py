"""Deleting an account, and everything Apple says has to go with it.

App Store Review Guideline 5.1.1(v) requires in-app account deletion, and
Apple's guidance is explicit that it covers user-generated content — "photos,
video, text posts, and reviews". These pin the parts that would otherwise
silently not happen: a review left standing, a place rating still counting a
deleted person's stars, or bucket bytes with nothing pointing at them.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.password_hashing import hash_password
from app.modules.places.models import Place, PlacePhoto
from app.modules.places.photos.storage_cleanup import StorageOrphan
from app.modules.reviews.models import PlaceReview
from app.modules.users.models import User

PASSWORD = "S3cure-passphrase"
BODY = "Ordered the mixed grill and asked about the chicken; they showed me the certificate."


@pytest.fixture
def deletable_user(factories, db_session):
    """A user who can actually authenticate — the factory doesn't set a
    password hash, and deletion requires re-entering the password."""
    user = factories.user(email=f"deleteme-{uuid4().hex[:8]}@example.com")
    user.password_hash = hash_password(PASSWORD)
    user.email_verified_at = datetime.now(timezone.utc)
    db_session.add(user)
    db_session.commit()
    return user


def _delete(api, user_id, password=PASSWORD, confirmation="DELETE"):
    # The client routes DELETE-with-body through httpx's generic request().
    return api.as_user(user_id).delete(
        "/me", json={"password": password, "confirmation": confirmation}
    )


def test_deleting_an_account_removes_the_user_and_their_reviews(
    api, db_session, factories, deletable_user, moderator
):
    """The headline requirement. A review is the clearest case of "content
    provided by a user" in this product."""
    place = factories.place(name="Deletion Test Grill")
    db_session.commit()

    api_user = api.as_user(deletable_user.id)
    resp = api_user.post(
        f"/places/{place.id}/reviews", json={"rating": 5, "body": BODY}
    )
    assert resp.status_code == 201, resp.text

    assert _delete(api, deletable_user.id).status_code == 204

    db_session.expire_all()
    assert db_session.get(User, deletable_user.id) is None
    assert db_session.execute(select(PlaceReview)).scalars().all() == []


def test_deletion_rolls_back_the_place_rating(
    api, db_session, factories, deletable_user, moderator
):
    """The aggregate is denormalized onto places and nothing recomputes it
    unless we say so. Leaving it would have the product asserting an average
    over reviews that no longer exist."""
    from decimal import Decimal

    place = factories.place(name="Aggregate Test Grill")
    db_session.commit()

    api.as_user(deletable_user.id).post(
        f"/places/{place.id}/reviews", json={"rating": 5, "body": BODY}
    )
    db_session.expire_all()
    assert db_session.get(Place, place.id).review_count == 1

    _delete(api, deletable_user.id)

    db_session.expire_all()
    refreshed = db_session.get(Place, place.id)
    assert refreshed.review_count == 0
    assert refreshed.review_rating_avg is None


def test_deletion_queues_review_photos_for_bucket_removal(
    api, db_session, factories, deletable_user, moderator
):
    """Review photos vanish through a DB-level cascade, so no application
    code sees them and the bytes would be stranded. The paths have to be
    read before the delete, exactly as in delete_review."""
    place = factories.place(name="Photo Deletion Grill")
    db_session.commit()

    review_id = (
        api.as_user(deletable_user.id)
        .post(f"/places/{place.id}/reviews", json={"rating": 4, "body": BODY})
        .json()["id"]
    )

    path = f"{place.id}/{uuid4()}.jpg"
    db_session.add(
        PlacePhoto(
            place_id=place.id,
            review_id=review_id,
            uploaded_by_user_id=deletable_user.id,
            source="CONSUMER",
            storage_path=path,
            content_type="image/jpeg",
            size_bytes=2048,
        )
    )
    db_session.commit()

    _delete(api, deletable_user.id)

    db_session.expire_all()
    assert db_session.execute(select(PlacePhoto)).scalars().all() == []
    queued = db_session.execute(select(StorageOrphan)).scalars().all()
    assert path in [o.storage_path for o in queued]
    assert queued[0].reason == "account_deleted"


def test_deletion_keeps_owner_side_photos(
    api, db_session, factories, deletable_user, moderator
):
    """A photo published on behalf of a restaurant is business content and the
    business still exists. Stripping a restaurant's gallery because a manager
    closed their personal account would harm diners who had no part in it —
    so OWNER-source photos survive, unattributed."""
    place = factories.place(name="Owner Photo Grill")
    db_session.commit()

    owner_path = f"{place.id}/{uuid4()}.jpg"
    db_session.add(
        PlacePhoto(
            place_id=place.id,
            uploaded_by_user_id=deletable_user.id,
            source="OWNER",
            storage_path=owner_path,
            content_type="image/jpeg",
            size_bytes=2048,
        )
    )
    db_session.commit()

    _delete(api, deletable_user.id)

    db_session.expire_all()
    surviving = db_session.execute(select(PlacePhoto)).scalars().all()
    assert [p.storage_path for p in surviving] == [owner_path]
    # And it's no longer attributable to anyone.
    assert surviving[0].uploaded_by_user_id is None


def test_wrong_password_deletes_nothing(api, db_session, deletable_user):
    resp = _delete(api, deletable_user.id, password="not-the-password")
    assert resp.status_code == 401
    db_session.expire_all()
    assert db_session.get(User, deletable_user.id) is not None


def test_missing_confirmation_deletes_nothing(api, db_session, deletable_user):
    """Two independent gates. The password proves who you are; the typed word
    proves you meant to do this and didn't mis-tap a destructive row."""
    resp = _delete(api, deletable_user.id, confirmation="yes")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "DELETE_CONFIRMATION_REQUIRED"
    db_session.expire_all()
    assert db_session.get(User, deletable_user.id) is not None


def test_anonymous_cannot_delete(api):
    assert (
        api.delete("/me", json={"password": "x", "confirmation": "DELETE"}).status_code
        == 401
    )


def test_deletion_preview_reports_real_counts(
    api, db_session, factories, deletable_user, moderator
):
    """The confirm screen shows these numbers. If they're wrong, someone makes
    an irreversible decision against a fiction."""
    place = factories.place(name="Preview Grill")
    db_session.commit()

    api.as_user(deletable_user.id).post(
        f"/places/{place.id}/reviews", json={"rating": 5, "body": BODY}
    )
    db_session.add(
        PlacePhoto(
            place_id=place.id,
            uploaded_by_user_id=deletable_user.id,
            source="CONSUMER",
            storage_path=f"{place.id}/{uuid4()}.jpg",
            content_type="image/jpeg",
            size_bytes=1024,
        )
    )
    db_session.commit()

    body = api.as_user(deletable_user.id).get("/me/deletion-preview").json()
    assert body["reviews_deleted"] == 1
    assert body["photos_deleted"] == 1
    assert body["keeps_owner_replies"] is True


def test_email_is_reusable_after_deletion(api, db_session, factories, deletable_user):
    """Hard delete, not a soft flag — so the address is free again. A tombstoned
    row holding the email hostage would be a strange consolation prize for
    someone who asked to be forgotten."""
    email = deletable_user.email
    _delete(api, deletable_user.id)

    db_session.expire_all()
    resp = api.post(
        "/auth/signup",
        json={"email": email, "password": PASSWORD, "display_name": "Back Again"},
    )
    assert resp.status_code in (200, 201), resp.text


def _photo(place_id, user_id, *, review_id=None):
    return PlacePhoto(
        place_id=place_id,
        review_id=review_id,
        uploaded_by_user_id=user_id,
        source="CONSUMER",
        storage_path=f"{place_id}/{uuid4()}.jpg",
        content_type="image/jpeg",
        size_bytes=1024,
    )


def test_preview_counts_review_photos_separately_from_standalone_ones(
    api, db_session, factories, deletable_user, moderator
):
    """The two numbers have to partition the user's photos, not overlap.

    ``photos_deleted`` used to be every CONSUMER photo the user uploaded,
    review-attached ones included — while the confirmation screen was already
    covering those under the review bullet. Someone with one review and one
    photo on it saw two bullets describing the same file, on the one screen
    whose entire purpose is telling them exactly what they are about to lose.
    """
    place = factories.place(name="Partition Grill")
    db_session.commit()

    review_id = (
        api.as_user(deletable_user.id)
        .post(f"/places/{place.id}/reviews", json={"rating": 4, "body": BODY})
        .json()["id"]
    )
    db_session.add(_photo(place.id, deletable_user.id, review_id=review_id))
    db_session.add(_photo(place.id, deletable_user.id))
    db_session.commit()

    body = api.as_user(deletable_user.id).get("/me/deletion-preview").json()
    assert body["reviews_deleted"] == 1
    assert body["photos_deleted"] == 1, "standalone only — not the review photo"
    assert body["review_photos_deleted"] == 1


def test_preview_matches_what_deletion_actually_reports(
    api, db_session, factories, deletable_user, moderator
):
    """The invariant behind the bug, stated directly.

    The preview and the deletion built their photo lists from two different
    queries, so they could disagree — preview said one photo, deletion
    reported none. Whatever the screen promises has to be what happens, and
    the user cannot check afterwards.
    """
    from app.modules.users.deletion import delete_account, preview_deletion

    place = factories.place(name="Agreement Grill")
    db_session.commit()

    review_id = (
        api.as_user(deletable_user.id)
        .post(f"/places/{place.id}/reviews", json={"rating": 4, "body": BODY})
        .json()["id"]
    )
    for _ in range(2):
        db_session.add(_photo(place.id, deletable_user.id, review_id=review_id))
    db_session.add(_photo(place.id, deletable_user.id))
    db_session.commit()

    promised = preview_deletion(db_session, user_id=deletable_user.id)
    actual = delete_account(db_session, user_id=deletable_user.id)
    db_session.commit()

    assert (promised.reviews_deleted, promised.photos_deleted, promised.review_photos_deleted) == (1, 1, 2)
    assert promised.reviews_deleted == actual.reviews_deleted
    assert promised.photos_deleted == actual.photos_deleted
    assert promised.review_photos_deleted == actual.review_photos_deleted


def test_owner_photos_are_in_neither_count(
    api, db_session, factories, deletable_user, moderator
):
    """OWNER-source photos survive deletion, so promising to delete them would
    be a lie in the other direction."""
    place = factories.place(name="Owner Count Grill")
    db_session.commit()
    owner_photo = _photo(place.id, deletable_user.id)
    owner_photo.source = "OWNER"
    db_session.add(owner_photo)
    db_session.commit()

    body = api.as_user(deletable_user.id).get("/me/deletion-preview").json()
    assert body["photos_deleted"] == 0
    assert body["review_photos_deleted"] == 0
