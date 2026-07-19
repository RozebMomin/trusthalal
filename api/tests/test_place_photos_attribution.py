"""Photo provenance: attribution, hero eligibility, delete rights, reports.

The properties here are the ones with teeth:

  * a diner's photo can never become the cover image, by any path,
  * a restaurant can never delete a diner's photo of what it served,
  * every photo carries an unambiguous, server-derived attribution.

The third exists because four clients were each deriving it themselves and
getting it wrong in different ways.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.modules.places.enums import (
    PhotoAttribution,
    PlacePhotoSource,
    attribution_for,
)
from app.modules.places.models import PlacePhoto
from app.modules.places.photos.reports import PlacePhotoReport, PhotoReportStatus


def _photo(
    db,
    place,
    *,
    source=PlacePhotoSource.CONSUMER,
    uploader=None,
    review_id=None,
    is_hero=False,
):
    row = PlacePhoto(
        place_id=place.id,
        uploaded_by_user_id=uploader.id if uploader else None,
        source=source.value,
        storage_path=f"{place.id}/{uuid4()}.jpg",
        content_type="image/jpeg",
        size_bytes=1234,
        review_id=review_id,
        is_hero=is_hero,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def owned_place(factories, db_session):
    owner = factories.owner(email=f"powner-{uuid4().hex[:8]}@example.com")
    owner.email_verified_at = datetime.now(timezone.utc)
    db_session.add(owner)
    place, org = factories.managed_place(owner=owner, place_name="Khan Halal Grill")
    db_session.commit()
    return place, owner, org


@pytest.fixture
def diner(factories, db_session):
    u = factories.user(email=f"diner-{uuid4().hex[:8]}@example.com")
    u.email_verified_at = datetime.now(timezone.utc)
    db_session.add(u)
    db_session.commit()
    return u


# ---------------------------------------------------------------------------
# Attribution derivation (pure)
# ---------------------------------------------------------------------------


def test_attribution_derivation():
    rid = uuid4()
    # Review beats source: a review photo is uploaded by a CONSUMER, and the
    # review context is the more specific and more useful fact.
    assert (
        attribution_for(source=PlacePhotoSource.CONSUMER, review_id=rid)
        == PhotoAttribution.REVIEW
    )
    assert (
        attribution_for(source=PlacePhotoSource.OWNER, review_id=None)
        == PhotoAttribution.OWNER
    )
    assert (
        attribution_for(source=PlacePhotoSource.GOOGLE, review_id=None)
        == PhotoAttribution.GOOGLE
    )
    assert (
        attribution_for(source=PlacePhotoSource.CONSUMER, review_id=None)
        == PhotoAttribution.DINER
    )


def test_list_exposes_attribution_including_google(
    api, db_session, owned_place, diner
):
    """GOOGLE previously had no client-side representation at all — every
    frontend typed source as OWNER|CONSUMER, so backfilled photos rendered a
    blank chip in production."""
    place, owner, _org = owned_place
    _photo(db_session, place, source=PlacePhotoSource.OWNER, uploader=owner)
    _photo(db_session, place, source=PlacePhotoSource.GOOGLE)
    _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)

    body = api.get(f"/places/{place.id}/photos").json()
    assert {p["attribution"] for p in body} == {"OWNER", "GOOGLE", "DINER"}


def test_list_response_is_still_an_array(api, owned_place):
    """Deliberately not wrapped in an object — three deployed clients read a
    bare list and the API has to ship ahead of them."""
    place, _owner, _org = owned_place
    assert isinstance(api.get(f"/places/{place.id}/photos").json(), list)


def test_attribution_filter(api, db_session, owned_place, diner):
    place, owner, _org = owned_place
    _photo(db_session, place, source=PlacePhotoSource.OWNER, uploader=owner)
    _photo(db_session, place, source=PlacePhotoSource.GOOGLE)
    _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)

    base = f"/places/{place.id}/photos"
    assert len(api.get(base).json()) == 3
    # Google counts as owner-side: it represents the business, and on an
    # unclaimed place it's the only photo there is.
    assert len(api.get(base, params={"attribution": "owner"}).json()) == 2
    assert len(api.get(base, params={"attribution": "diner"}).json()) == 1


# ---------------------------------------------------------------------------
# Hero eligibility
# ---------------------------------------------------------------------------


def test_owner_cannot_promote_a_diner_photo_to_hero(
    api, db_session, owned_place, diner
):
    """The hole this closes: previously the manual PATCH path was
    source-blind, so a two-star review's plate photo could become the image
    every search result shows."""
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)

    resp = api.as_user(owner.id).patch(
        f"/places/{place.id}/photos/{photo.id}", json={"is_hero": True}
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "PHOTO_NOT_HERO_ELIGIBLE"

    db_session.expire_all()
    assert db_session.get(PlacePhoto, photo.id).is_hero is False


def test_owner_can_promote_their_own_photo(api, db_session, owned_place):
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.OWNER, uploader=owner)

    resp = api.as_user(owner.id).patch(
        f"/places/{place.id}/photos/{photo.id}", json={"is_hero": True}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_hero"] is True


def test_admin_cannot_promote_a_diner_photo_either(
    api, db_session, factories, owned_place, diner
):
    """Eligibility is a property of the photo, not a permission level —
    otherwise the rule is one admin click away from being bypassed."""
    place, _owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)
    admin = factories.admin(email="photoadmin@example.com")
    db_session.commit()

    resp = api.as_user(admin.id).patch(
        f"/places/{place.id}/photos/{photo.id}", json={"is_hero": True}
    )
    assert resp.status_code == 409


def test_google_photo_is_hero_eligible(api, db_session, owned_place):
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.GOOGLE)

    resp = api.as_user(owner.id).patch(
        f"/places/{place.id}/photos/{photo.id}", json={"is_hero": True}
    )
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# Delete permissions
# ---------------------------------------------------------------------------


def test_owner_cannot_delete_a_diner_photo(api, db_session, owned_place, diner):
    """The most important permission in the photo system, and it was
    previously wrong: place owners had blanket delete rights. A photo of what
    a diner was served is evidence; the party it implicates can't remove it."""
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)

    resp = api.as_user(owner.id).delete(f"/places/{place.id}/photos/{photo.id}")
    assert resp.status_code == 403
    assert (
        resp.json()["error"]["code"]
        == "PLACE_PHOTO_OWNER_CANNOT_DELETE_DINER_PHOTO"
    )

    db_session.expire_all()
    assert db_session.get(PlacePhoto, photo.id).deleted_at is None


def test_owner_can_delete_their_own_photo(api, db_session, owned_place):
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.OWNER, uploader=owner)

    resp = api.as_user(owner.id).delete(f"/places/{place.id}/photos/{photo.id}")
    assert resp.status_code == 204


def test_diner_can_delete_their_own_photo(api, db_session, owned_place, diner):
    """Uploaders keep control of their own work."""
    place, _owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)

    resp = api.as_user(diner.id).delete(f"/places/{place.id}/photos/{photo.id}")
    assert resp.status_code == 204


def test_admin_can_delete_anything(api, db_session, factories, owned_place, diner):
    """Someone has to be able to act on a report."""
    place, _owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)
    admin = factories.admin(email="deladmin@example.com")
    db_session.commit()

    resp = api.as_user(admin.id).delete(f"/places/{place.id}/photos/{photo.id}")
    assert resp.status_code == 204


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def test_owner_reports_a_diner_photo(api, db_session, owned_place, diner):
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)

    resp = api.as_user(owner.id).post(
        f"/places/{place.id}/photos/{photo.id}/report",
        json={"reason": "NOT_THIS_PLACE"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "OPEN"


def test_report_once_only(api, db_session, owned_place, diner):
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)
    owner_api = api.as_user(owner.id)

    first = owner_api.post(
        f"/places/{place.id}/photos/{photo.id}/report",
        json={"reason": "MISLEADING"},
    )
    assert first.status_code == 201
    second = owner_api.post(
        f"/places/{place.id}/photos/{photo.id}/report",
        json={"reason": "INAPPROPRIATE"},
    )
    assert second.status_code == 409


def test_report_reason_other_requires_detail(api, db_session, owned_place, diner):
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)

    resp = api.as_user(owner.id).post(
        f"/places/{place.id}/photos/{photo.id}/report", json={"reason": "OTHER"}
    )
    assert resp.status_code == 422


def test_admin_removes_a_reported_photo(
    api, db_session, factories, owned_place, diner
):
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)
    api.as_user(owner.id).post(
        f"/places/{place.id}/photos/{photo.id}/report",
        json={"reason": "PERSONAL_INFO", "detail": "Shows a staff member's badge."},
    )

    admin = factories.admin(email="modadmin@example.com")
    db_session.commit()
    resp = api.as_user(admin.id).post(
        f"/admin/photo-reports/{photo.id}/resolve",
        json={
            "decision": "UPHELD",
            "remove": True,
            "resolution_note": "Shows an identifiable staff member's badge number.",
        },
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    assert db_session.get(PlacePhoto, photo.id).deleted_at is not None
    # Gone from the public list.
    assert api.get(f"/places/{place.id}/photos").json() == []


def test_removal_requires_a_note(api, db_session, factories, owned_place, diner):
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)
    api.as_user(owner.id).post(
        f"/places/{place.id}/photos/{photo.id}/report", json={"reason": "MISLEADING"}
    )
    admin = factories.admin(email="notelessadmin@example.com")
    db_session.commit()

    resp = api.as_user(admin.id).post(
        f"/admin/photo-reports/{photo.id}/resolve",
        json={"decision": "UPHELD", "remove": True},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "MODERATION_NOTE_REQUIRED"


def test_dismissing_leaves_the_photo_up(
    api, db_session, factories, owned_place, diner
):
    """An owner reporting an accurate but unflattering photo is the expected
    abuse case; dismissal has to be a first-class outcome."""
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)
    api.as_user(owner.id).post(
        f"/places/{place.id}/photos/{photo.id}/report", json={"reason": "MISLEADING"}
    )
    admin = factories.admin(email="dismissadmin@example.com")
    db_session.commit()

    resp = api.as_user(admin.id).post(
        f"/admin/photo-reports/{photo.id}/resolve",
        json={"decision": "DISMISSED", "remove": False},
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    assert db_session.get(PlacePhoto, photo.id).deleted_at is None
    reports = db_session.execute(
        select(PlacePhotoReport).where(PlacePhotoReport.photo_id == photo.id)
    ).scalars().all()
    assert all(r.status == PhotoReportStatus.DISMISSED.value for r in reports)


def test_admin_queue_groups_by_photo(
    api, db_session, factories, owned_place, diner
):
    place, owner, _org = owned_place
    photo = _photo(db_session, place, source=PlacePhotoSource.CONSUMER, uploader=diner)

    api.as_user(owner.id).post(
        f"/places/{place.id}/photos/{photo.id}/report", json={"reason": "MISLEADING"}
    )
    other = factories.user(email="otherreporter@example.com")
    db_session.commit()
    api.as_user(other.id).post(
        f"/places/{place.id}/photos/{photo.id}/report",
        json={"reason": "NOT_THIS_PLACE"},
    )

    admin = factories.admin(email="queueadmin@example.com")
    db_session.commit()
    body = api.as_user(admin.id).get("/admin/photo-reports").json()

    assert body["total"] == 1  # one row, two reports
    row = body["items"][0]
    assert row["report_count"] == 2
    # The owner is among the reporters, and a moderator should see that.
    assert row["reported_by_owner"] is True


def test_non_admin_cannot_reach_the_photo_queue(api, diner):
    assert api.as_user(diner.id).get("/admin/photo-reports").status_code == 403
