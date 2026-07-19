"""Integration tests for diner reviews, owner replies, and moderation.

Grouped by the property being protected rather than by endpoint, because the
properties are what would actually hurt if they broke:

  * the aggregate on ``places`` always matches the visible reviews,
  * one review per person per place,
  * a confirmed email is required to post,
  * text moderation blocks, and fails *closed* on an outage,
  * owners are held to the same filter as diners,
  * only the verified owner can reply, once,
  * moderation is never silent to the author.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.text_moderation import (
    ModerationResult,
    ModerationVerdict,
    TextModerationError,
    get_text_moderation_client,
)
from app.main import app as fastapi_app
from app.modules.places.models import Place
from app.modules.reviews.enums import PlaceReviewStatus
from app.modules.reviews.models import PlaceReview, PlaceReviewReply

BODY = "Ordered the mixed grill and asked about the chicken; they showed me the certificate."
BODY_TWO = "Came back a second time with family. Same answer, same certificate on the counter."


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class _FakeModerator:
    """Scriptable stand-in for Cloud Natural Language.

    ``verdict`` drives the answer; setting ``raise_error`` simulates the
    outage path, which is the one branch that behaves differently from a
    rejection and is easy to get backwards.
    """

    def __init__(self, verdict=ModerationVerdict.ALLOW, category=None):
        self.verdict = verdict
        self.category = category
        self.raise_error = False
        self.calls: list[str] = []

    def evaluate(self, text: str) -> ModerationResult:
        self.calls.append(text)
        if self.raise_error:
            raise TextModerationError("simulated outage")
        return ModerationResult(
            verdict=self.verdict, category=self.category, confidence=0.9
        )


@pytest.fixture
def moderator():
    fake = _FakeModerator()
    fastapi_app.dependency_overrides[get_text_moderation_client] = lambda: fake
    yield fake
    fastapi_app.dependency_overrides.pop(get_text_moderation_client, None)


@pytest.fixture
def verified_user(factories, db_session):
    """A consumer who can actually post — i.e. with a confirmed email."""
    from datetime import datetime, timezone

    user = factories.user(email=f"reviewer-{uuid4().hex[:8]}@example.com")
    user.email_verified_at = datetime.now(timezone.utc)
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def place(factories, db_session):
    p = factories.place(name="Khan Halal Grill")
    db_session.commit()
    return p


def _post(api, place_id, body=BODY, rating=5, **extra):
    payload = {"rating": rating, "body": body, **extra}
    return api.post(f"/places/{place_id}/reviews", json=payload)


# ---------------------------------------------------------------------------
# Creating
# ---------------------------------------------------------------------------


def test_create_review_publishes_and_updates_aggregate(
    api, db_session, verified_user, place, moderator
):
    api = api.as_user(verified_user.id)
    resp = _post(api, place.id, rating=4)
    assert resp.status_code == 201, resp.text

    body = resp.json()
    assert body["rating"] == 4
    assert body["status"] == "PUBLISHED"
    assert body["is_mine"] is True

    db_session.expire_all()
    refreshed = db_session.get(Place, place.id)
    assert refreshed.review_count == 1
    assert Decimal(str(refreshed.review_rating_avg)) == Decimal("4.0")


def test_second_review_for_same_place_conflicts_with_existing_id(
    api, db_session, verified_user, place, moderator
):
    """The client needs the existing id so it can switch to editing rather
    than showing a dead end for something the user thinks is a new action."""
    api = api.as_user(verified_user.id)
    first = _post(api, place.id)
    assert first.status_code == 201

    second = _post(api, place.id, body=BODY_TWO)
    assert second.status_code == 409
    err = second.json()["error"]
    assert err["code"] == "REVIEW_ALREADY_EXISTS"
    assert err["detail"]["review_id"] == first.json()["id"]


def test_unverified_email_cannot_post(api, factories, db_session, place, moderator):
    user = factories.user(email="unverified@example.com")
    db_session.commit()
    assert user.email_verified_at is None

    resp = _post(api.as_user(user.id), place.id)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


def test_anonymous_cannot_post(api, place, moderator):
    assert _post(api, place.id).status_code == 401


def test_short_body_is_rejected(api, verified_user, place, moderator):
    resp = _post(api.as_user(verified_user.id), place.id, body="Great!")
    assert resp.status_code == 422


def test_whitespace_padded_body_is_rejected(api, verified_user, place, moderator):
    """20 spaces plus 'ok' clears a naive length check but says nothing."""
    resp = _post(api.as_user(verified_user.id), place.id, body=" " * 30 + "ok")
    assert resp.status_code == 422


def test_future_visit_date_rejected(api, verified_user, place, moderator):
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    resp = _post(
        api.as_user(verified_user.id), place.id, visited_on=tomorrow
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Moderation
# ---------------------------------------------------------------------------


def test_blocked_text_is_refused_and_nothing_is_written(
    api, db_session, verified_user, place, moderator
):
    moderator.verdict = ModerationVerdict.BLOCK
    moderator.category = "Profanity"

    resp = _post(api.as_user(verified_user.id), place.id)
    assert resp.status_code == 400
    err = resp.json()["error"]
    assert err["code"] == "REVIEW_TEXT_REJECTED"
    # The user is told which category tripped, in words — not a bare refusal.
    assert "profanity" in err["message"].lower()

    assert db_session.execute(select(PlaceReview)).scalars().all() == []


def test_moderation_outage_fails_closed_with_503(
    api, db_session, verified_user, place, moderator
):
    """Fail closed, matching the photo pipeline — but as a 503, not a 400.

    The distinction is the whole point: a 400 says "we judged your content",
    a 503 says "we couldn't check it". Getting this backwards during an
    outage would be the most infuriating bug in the feature.
    """
    moderator.raise_error = True

    resp = _post(api.as_user(verified_user.id), place.id)
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "MODERATION_UNAVAILABLE"
    assert db_session.execute(select(PlaceReview)).scalars().all() == []


def test_warn_verdict_still_publishes(api, verified_user, place, moderator):
    """Anger is legitimate. Only BLOCK stops a post."""
    moderator.verdict = ModerationVerdict.WARN
    assert _post(api.as_user(verified_user.id), place.id).status_code == 201


# ---------------------------------------------------------------------------
# Editing + deleting
# ---------------------------------------------------------------------------


def test_edit_marks_edited_and_recomputes_average(
    api, db_session, verified_user, place, moderator
):
    api = api.as_user(verified_user.id)
    review_id = _post(api, place.id, rating=5).json()["id"]

    resp = api.patch(f"/me/reviews/{review_id}", json={"rating": 2})
    assert resp.status_code == 200, resp.text
    assert resp.json()["edited_at"] is not None

    db_session.expire_all()
    assert Decimal(str(db_session.get(Place, place.id).review_rating_avg)) == Decimal("2.0")


def test_edited_body_is_re_moderated(api, verified_user, place, moderator):
    """Otherwise post something clean, then edit in whatever you like."""
    api = api.as_user(verified_user.id)
    review_id = _post(api, place.id).json()["id"]

    moderator.verdict = ModerationVerdict.BLOCK
    moderator.category = "Insult"
    resp = api.patch(f"/me/reviews/{review_id}", json={"body": BODY_TWO})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "REVIEW_TEXT_REJECTED"


def test_cannot_edit_another_users_review_and_gets_404(
    api, factories, db_session, verified_user, place, moderator
):
    """404, not 403 — a 403 would confirm the id is real.

    The other user has to be email-verified, or ``require_verified_email``
    short-circuits with its own 403 and we'd never reach the ownership check
    this test exists to pin.
    """
    from datetime import datetime, timezone

    review_id = _post(api.as_user(verified_user.id), place.id).json()["id"]

    other = factories.user(email="other@example.com")
    other.email_verified_at = datetime.now(timezone.utc)
    db_session.add(other)
    db_session.commit()

    resp = api.as_user(other.id).patch(
        f"/me/reviews/{review_id}", json={"rating": 1}
    )
    assert resp.status_code == 404


def test_delete_removes_review_and_resets_aggregate(
    api, db_session, verified_user, place, moderator
):
    api = api.as_user(verified_user.id)
    review_id = _post(api, place.id).json()["id"]

    assert api.delete(f"/me/reviews/{review_id}").status_code == 204

    db_session.expire_all()
    refreshed = db_session.get(Place, place.id)
    assert refreshed.review_count == 0
    assert refreshed.review_rating_avg is None


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def test_list_returns_summary_with_both_ratings_labeled_separately(
    api, db_session, factories, place, moderator
):
    """The two numbers must stay distinguishable in the payload — conflating
    them is exactly the bug this feature exists to fix."""
    from datetime import datetime, timezone

    place.google_rating = 4.5
    place.google_rating_count = 1204
    db_session.add(place)

    for i, rating in enumerate((5, 4, 2)):
        u = factories.user(email=f"lister{i}@example.com")
        u.email_verified_at = datetime.now(timezone.utc)
        db_session.add(u)
        db_session.commit()
        _post(api.as_user(u.id), place.id, rating=rating, body=BODY)

    resp = api.get(f"/places/{place.id}/reviews")
    assert resp.status_code == 200, resp.text
    summary = resp.json()["summary"]

    assert summary["count"] == 3
    assert summary["average"] == pytest.approx(3.7, abs=0.05)
    assert summary["google_rating"] == pytest.approx(4.5)
    assert summary["google_rating_count"] == 1204
    assert summary["histogram"]["5"] == 1
    assert summary["histogram"]["3"] == 0


def test_list_sorts(api, db_session, factories, place, moderator):
    from datetime import datetime, timezone

    for i, rating in enumerate((1, 5, 3)):
        u = factories.user(email=f"sorter{i}@example.com")
        u.email_verified_at = datetime.now(timezone.utc)
        db_session.add(u)
        db_session.commit()
        _post(api.as_user(u.id), place.id, rating=rating, body=BODY)

    high = api.get(f"/places/{place.id}/reviews", params={"sort": "rating_high"})
    assert [r["rating"] for r in high.json()["items"]] == [5, 3, 1]

    low = api.get(f"/places/{place.id}/reviews", params={"sort": "rating_low"})
    assert [r["rating"] for r in low.json()["items"]] == [1, 3, 5]


def test_list_is_anonymous_readable(api, verified_user, place, moderator):
    _post(api.as_user(verified_user.id), place.id)
    resp = api.get(f"/places/{place.id}/reviews")
    assert resp.status_code == 200
    assert resp.json()["can_review"] is False  # anonymous can't


def test_author_never_carries_a_role(api, verified_user, place, moderator):
    """No verifier badge, ever — the field simply isn't exposed."""
    _post(api.as_user(verified_user.id), place.id)
    item = api.get(f"/places/{place.id}/reviews").json()["items"][0]
    assert set(item["author"].keys()) == {"id", "display_name"}


# ---------------------------------------------------------------------------
# Owner replies
# ---------------------------------------------------------------------------


@pytest.fixture
def owned_place(factories, db_session):
    """A place with an owning org and an owner user who manages it.

    ``managed_place`` already builds the place → org → PlaceOwner →
    OrganizationMember chain that ``owning_organization_for_place`` walks.
    """
    from datetime import datetime, timezone

    owner = factories.owner(email=f"owner-{uuid4().hex[:8]}@example.com")
    owner.email_verified_at = datetime.now(timezone.utc)
    db_session.add(owner)
    p, org = factories.managed_place(owner=owner, place_name="Khan Halal Grill")
    db_session.commit()
    return p, owner, org


def test_owner_can_reply_once(
    api, db_session, verified_user, owned_place, moderator
):
    p, owner, _org = owned_place
    review_id = _post(api.as_user(verified_user.id), p.id).json()["id"]

    owner_api = api.as_user(owner.id)
    first = owner_api.post(
        f"/places/reviews/{review_id}/reply",
        json={"body": "Thank you — the certificate is always at the counter."},
    )
    assert first.status_code == 201, first.text

    second = owner_api.post(
        f"/places/reviews/{review_id}/reply", json={"body": "Second thoughts."}
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "REVIEW_REPLY_EXISTS"


def test_non_owner_cannot_reply(
    api, db_session, factories, verified_user, owned_place, moderator
):
    p, _owner, _org = owned_place
    review_id = _post(api.as_user(verified_user.id), p.id).json()["id"]

    stranger = factories.user(email="stranger@example.com")
    db_session.commit()
    resp = api.as_user(stranger.id).post(
        f"/places/reviews/{review_id}/reply", json={"body": "Hi there"}
    )
    assert resp.status_code in (403, 401)


def test_owner_reply_is_moderated_the_same_as_a_diner(
    api, verified_user, owned_place, moderator
):
    """Owners are not exempt. Paying to be on the platform doesn't buy a
    lower bar for conduct — and an owner swearing at a diner in public does
    more damage than the review that provoked it."""
    p, owner, _org = owned_place
    review_id = _post(api.as_user(verified_user.id), p.id).json()["id"]

    moderator.verdict = ModerationVerdict.BLOCK
    moderator.category = "Insult"
    resp = api.as_user(owner.id).post(
        f"/places/reviews/{review_id}/reply",
        json={"body": "We don't need customers like you spreading lies."},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "REVIEW_TEXT_REJECTED"


def test_reply_appears_on_the_public_review(
    api, verified_user, owned_place, moderator
):
    """The byline is the business, not the individual manager — that's why
    the reply carries organization_id rather than only an author."""
    p, owner, org = owned_place
    review_id = _post(api.as_user(verified_user.id), p.id).json()["id"]
    api.as_user(owner.id).post(
        f"/places/reviews/{review_id}/reply", json={"body": "Thanks for coming in."}
    )

    item = api.get(f"/places/{p.id}/reviews").json()["items"][0]
    assert item["reply"]["body"] == "Thanks for coming in."
    assert item["reply"]["organization_name"] == org.name
    assert item["reply"]["organization_id"] == str(org.id)


def test_owner_inbox_counts_unanswered(
    api, db_session, factories, verified_user, owned_place, moderator
):
    from datetime import datetime, timezone

    p, owner, _org = owned_place
    _post(api.as_user(verified_user.id), p.id)

    second = factories.user(email="second-diner@example.com")
    second.email_verified_at = datetime.now(timezone.utc)
    db_session.add(second)
    db_session.commit()
    _post(api.as_user(second.id), p.id, body=BODY_TWO)

    resp = api.as_user(owner.id).get("/me/place-reviews")
    assert resp.status_code == 200, resp.text
    assert resp.json()["needs_reply_count"] == 2


# ---------------------------------------------------------------------------
# Reporting + admin moderation
# ---------------------------------------------------------------------------


def test_report_once_only(api, db_session, factories, verified_user, place, moderator):
    review_id = _post(api.as_user(verified_user.id), place.id).json()["id"]

    reporter = factories.user(email="reporter@example.com")
    db_session.commit()
    reporter_api = api.as_user(reporter.id)

    first = reporter_api.post(
        f"/places/reviews/{review_id}/report", json={"reason": "FALSE_INFO"}
    )
    assert first.status_code == 201, first.text

    second = reporter_api.post(
        f"/places/reviews/{review_id}/report", json={"reason": "SPAM"}
    )
    assert second.status_code == 409


def test_report_reason_other_requires_detail(
    api, db_session, factories, verified_user, place, moderator
):
    review_id = _post(api.as_user(verified_user.id), place.id).json()["id"]
    reporter = factories.user(email="detailless@example.com")
    db_session.commit()

    resp = api.as_user(reporter.id).post(
        f"/places/reviews/{review_id}/report", json={"reason": "OTHER"}
    )
    assert resp.status_code == 422


def test_admin_remove_hides_from_public_and_drops_the_average(
    api, db_session, factories, verified_user, place, moderator
):
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, place.id, rating=1).json()["id"]

    reporter = factories.user(email="rep2@example.com")
    admin = factories.admin(email="mod@example.com")
    db_session.commit()
    api.as_user(reporter.id).post(
        f"/places/reviews/{review_id}/report", json={"reason": "FALSE_INFO"}
    )

    resp = api.as_user(admin.id).post(
        f"/admin/review-reports/{review_id}/resolve",
        json={
            "decision": "UPHELD",
            "action": "REMOVE",
            "resolution_note": "States as fact that the restaurant sells haram "
            "meat, with no evidence offered.",
        },
    )
    assert resp.status_code == 200, resp.text

    # Gone from the public list, and no longer dragging the rating down.
    assert api.get(f"/places/{place.id}/reviews").json()["items"] == []
    db_session.expire_all()
    refreshed = db_session.get(Place, place.id)
    assert refreshed.review_count == 0
    assert refreshed.review_rating_avg is None


def test_removal_is_never_silent_to_the_author(
    api, db_session, factories, verified_user, place, moderator
):
    """The author must be able to see that it happened, and why."""
    review_id = _post(api.as_user(verified_user.id), place.id).json()["id"]
    admin = factories.admin(email="mod2@example.com")
    db_session.commit()

    note = "Removed because it names a member of staff."
    api.as_user(admin.id).post(
        f"/admin/reviews/{review_id}/status",
        json={"status": "REMOVED", "moderation_note": note},
    )

    mine = api.as_user(verified_user.id).get("/me/reviews").json()
    assert len(mine) == 1
    assert mine[0]["status"] == "REMOVED"
    assert mine[0]["moderation_note"] == note


def test_hiding_requires_a_note(
    api, db_session, factories, verified_user, place, moderator
):
    review_id = _post(api.as_user(verified_user.id), place.id).json()["id"]
    admin = factories.admin(email="mod3@example.com")
    db_session.commit()

    resp = api.as_user(admin.id).post(
        f"/admin/reviews/{review_id}/status", json={"status": "HIDDEN"}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "MODERATION_NOTE_REQUIRED"


def test_removed_review_cannot_be_edited_back_into_visibility(
    api, db_session, factories, verified_user, place, moderator
):
    review_id = _post(api.as_user(verified_user.id), place.id).json()["id"]
    admin = factories.admin(email="mod4@example.com")
    db_session.commit()
    api.as_user(admin.id).post(
        f"/admin/reviews/{review_id}/status",
        json={"status": "REMOVED", "moderation_note": "Not acceptable."},
    )

    resp = api.as_user(verified_user.id).patch(
        f"/me/reviews/{review_id}", json={"body": BODY_TWO}
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "REVIEW_REMOVED"


def test_admin_queue_groups_reports_by_review(
    api, db_session, factories, verified_user, place, moderator
):
    review_id = _post(api.as_user(verified_user.id), place.id).json()["id"]

    for i in range(2):
        r = factories.user(email=f"queue-rep{i}@example.com")
        db_session.commit()
        api.as_user(r.id).post(
            f"/places/reviews/{review_id}/report", json={"reason": "SPAM"}
        )

    admin = factories.admin(email="mod5@example.com")
    db_session.commit()
    body = api.as_user(admin.id).get("/admin/review-reports").json()

    assert body["total"] == 1  # one row, not two
    assert body["items"][0]["report_count"] == 2
    assert body["items"][0]["open_report_count"] == 2


def test_dismissing_leaves_the_review_up(
    api, db_session, factories, verified_user, place, moderator
):
    """A report can be valid-looking and still not warrant a takedown —
    verdict and action are separate for exactly this case."""
    review_id = _post(api.as_user(verified_user.id), place.id).json()["id"]
    reporter = factories.user(email="rep3@example.com")
    admin = factories.admin(email="mod6@example.com")
    db_session.commit()
    api.as_user(reporter.id).post(
        f"/places/reviews/{review_id}/report", json={"reason": "OFF_TOPIC"}
    )

    resp = api.as_user(admin.id).post(
        f"/admin/review-reports/{review_id}/resolve",
        json={"decision": "DISMISSED", "action": "NONE"},
    )
    assert resp.status_code == 200, resp.text

    assert len(api.get(f"/places/{place.id}/reviews").json()["items"]) == 1
    db_session.expire_all()
    reports = db_session.execute(
        select(PlaceReview).where(PlaceReview.id == review_id)
    ).scalar_one()
    assert reports.status == PlaceReviewStatus.PUBLISHED.value


def test_non_admin_cannot_reach_the_queue(api, verified_user):
    assert api.as_user(verified_user.id).get("/admin/review-reports").status_code == 403


# ---------------------------------------------------------------------------
# Deleting a review: what goes with it
# ---------------------------------------------------------------------------
# Three FKs point at place_reviews with ON DELETE CASCADE (the reply, the
# reports, and any attached photos) and delete_review recomputes the place
# aggregate. Both behaviours are load-bearing and invisible from the calling
# code, so they're pinned here rather than trusted.


def test_deleting_a_review_takes_the_owners_reply_with_it(
    api, db_session, verified_user, owned_place, moderator
):
    """A reply is a response to something. With the review gone there's
    nothing for it to be a response to, and leaving it would strand a public
    statement with no context — the same call Google and Yelp make."""
    p, owner, _org = owned_place
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, p.id).json()["id"]

    api.as_user(owner.id).post(
        f"/places/reviews/{review_id}/reply",
        json={"body": "Thanks for coming in, see you next time."},
    )
    db_session.expire_all()
    assert db_session.execute(select(PlaceReviewReply)).scalars().all() != []

    assert api_author.delete(f"/me/reviews/{review_id}").status_code == 204

    db_session.expire_all()
    assert db_session.execute(select(PlaceReviewReply)).scalars().all() == []


def test_deleting_a_review_takes_its_reports_with_it(
    api, db_session, factories, verified_user, place, moderator
):
    from app.modules.reviews.models import PlaceReviewReport

    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, place.id).json()["id"]

    reporter = factories.user(email="cascade-reporter@example.com")
    db_session.commit()
    api.as_user(reporter.id).post(
        f"/places/reviews/{review_id}/report", json={"reason": "SPAM"}
    )
    db_session.expire_all()
    assert db_session.execute(select(PlaceReviewReport)).scalars().all() != []

    api_author.delete(f"/me/reviews/{review_id}")

    db_session.expire_all()
    assert db_session.execute(select(PlaceReviewReport)).scalars().all() == []


def test_deleting_a_review_rolls_back_the_place_rating_and_count(
    api, db_session, factories, place, moderator
):
    """The aggregate is denormalized onto places, so nothing recomputes it
    unless delete_review says so. A stale average is worse than a slow one:
    it's a number the product asserts and can't back up."""
    from datetime import datetime, timezone
    from decimal import Decimal

    users = []
    for i, rating in enumerate((5, 3)):
        u = factories.user(email=f"cascade{i}@example.com")
        u.email_verified_at = datetime.now(timezone.utc)
        db_session.add(u)
        db_session.commit()
        users.append((u, _post(api.as_user(u.id), place.id, rating=rating).json()["id"]))

    db_session.expire_all()
    refreshed = db_session.get(Place, place.id)
    assert refreshed.review_count == 2
    assert Decimal(str(refreshed.review_rating_avg)) == Decimal("4.0")

    # Drop the 5 — the average must fall to the remaining 3, not stay at 4.
    top_user, top_review = users[0]
    api.as_user(top_user.id).delete(f"/me/reviews/{top_review}")

    db_session.expire_all()
    refreshed = db_session.get(Place, place.id)
    assert refreshed.review_count == 1
    assert Decimal(str(refreshed.review_rating_avg)) == Decimal("3.0")


def test_deleting_the_last_review_clears_the_rating_entirely(
    api, db_session, verified_user, place, moderator
):
    """Not 0.0 — null. A place with no reviews has no rating, and rendering
    a zero would read as the worst possible score."""
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, place.id, rating=5).json()["id"]
    api_author.delete(f"/me/reviews/{review_id}")

    db_session.expire_all()
    refreshed = db_session.get(Place, place.id)
    assert refreshed.review_count == 0
    assert refreshed.review_rating_avg is None


def test_deleting_a_review_queues_its_photos_for_bucket_deletion(
    api, db_session, verified_user, place, moderator
):
    """The photo rows cascade away at the *database* level, which means no
    application code runs and the storage paths are unrecoverable the instant
    the delete lands. Unless they're read first, the bytes stay in the bucket
    forever with nothing left pointing at them.

    This is the ordinary case, not an error path: it happens every time a
    diner withdraws a review that had photos.
    """
    from app.modules.places.models import PlacePhoto
    from app.modules.places.photos.storage_cleanup import StorageOrphan

    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, place.id).json()["id"]

    path = f"{place.id}/{uuid4()}.jpg"
    db_session.add(
        PlacePhoto(
            place_id=place.id,
            review_id=review_id,
            uploaded_by_user_id=verified_user.id,
            source="CONSUMER",
            storage_path=path,
            content_type="image/jpeg",
            size_bytes=1234,
        )
    )
    db_session.commit()

    assert api_author.delete(f"/me/reviews/{review_id}").status_code == 204

    db_session.expire_all()
    # The row is gone (cascade) ...
    assert db_session.execute(select(PlacePhoto)).scalars().all() == []
    # ... and the object it pointed at is queued for the sweeper.
    orphans = db_session.execute(select(StorageOrphan)).scalars().all()
    assert [o.storage_path for o in orphans] == [path]
    assert orphans[0].reason == "review_deleted"
    assert orphans[0].purged_at is None


def test_deleting_a_review_without_photos_queues_nothing(
    api, db_session, verified_user, place, moderator
):
    """The outbox is a work queue an operator reads. Filling it with empty
    rows on every delete would make a real leak harder to spot."""
    from app.modules.places.photos.storage_cleanup import StorageOrphan

    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, place.id).json()["id"]
    api_author.delete(f"/me/reviews/{review_id}")

    db_session.expire_all()
    assert db_session.execute(select(StorageOrphan)).scalars().all() == []


def test_deleted_review_leaves_the_admin_queue_intact(
    api, db_session, factories, verified_user, place, moderator
):
    """The queue groups by review, so a cascaded-away review would leave a
    row pointing at nothing. The list handler skips those rather than 500."""
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, place.id).json()["id"]

    reporter = factories.user(email="queue-cascade@example.com")
    admin = factories.admin(email="queue-cascade-admin@example.com")
    db_session.commit()
    api.as_user(reporter.id).post(
        f"/places/reviews/{review_id}/report", json={"reason": "OFF_TOPIC"}
    )

    api_author.delete(f"/me/reviews/{review_id}")

    resp = api.as_user(admin.id).get("/admin/review-reports")
    assert resp.status_code == 200, resp.text
    assert resp.json()["items"] == []


# ---------------------------------------------------------------------------
# Editing a review the owner already answered
# ---------------------------------------------------------------------------
# A reply is a public statement about specific words. When those words change
# afterwards the reply keeps standing underneath, now apparently answering
# something nobody said. Before this, nothing told the owner and nothing told
# readers — the owner inbox structurally could not surface it, because "needs
# reply" means "has no reply" and the list sorts by original post date.


def _reply(api, owner_id, review_id, body="Thanks for coming in."):
    return api.as_user(owner_id).post(
        f"/places/reviews/{review_id}/reply", json={"body": body}
    )


def test_material_body_change_detection():
    """The bar is similarity, not equality. Notifying an owner every time
    somebody fixed a typo teaches them the email is noise, and then the one
    that matters gets skimmed past with the rest."""
    from app.modules.reviews.repo import _is_material_body_change

    long_body = (
        "Ordered the mixed grill and asked about the chicken; they showed me "
        "the certificate without hesitation. Portions were generous."
    )

    # Cosmetic: a typo, a capitalisation change, reflowed whitespace.
    assert not _is_material_body_change(long_body, long_body.replace("grill", "gril"))
    assert not _is_material_body_change(long_body, long_body.upper())
    assert not _is_material_body_change(long_body, "  ".join(long_body.split()))
    assert not _is_material_body_change(long_body, long_body)

    # Material: a rewrite, and an appended paragraph that keeps every original
    # character intact but reverses the sentiment.
    assert _is_material_body_change(
        long_body, "Went back a second time and it was genuinely bad. Avoid."
    )
    assert _is_material_body_change(
        long_body,
        long_body + " Went back since and it was awful — I'm downgrading this.",
    )


def test_rating_change_alone_is_material(api, db_session, verified_user, place, moderator):
    """No body change at all, but the star count is the number the whole
    product ranks on and the thing a reply most often responds to."""
    from app.modules.reviews import repo

    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, place.id, rating=5).json()["id"]
    db_session.expire_all()

    review = repo.get_review(db_session, review_id)
    edit = repo.update_review(db_session, review=review, rating=2)
    db_session.commit()

    assert edit.changed is True
    assert edit.material is True
    assert edit.previous_rating == 5


def test_visited_on_change_alone_is_not_material(
    api, db_session, verified_user, place, moderator
):
    """Correcting which day you went doesn't change what you said about the
    place, so it isn't worth an owner's attention."""
    from datetime import date

    from app.modules.reviews import repo

    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, place.id).json()["id"]
    db_session.expire_all()

    review = repo.get_review(db_session, review_id)
    edit = repo.update_review(
        db_session,
        review=review,
        visited_on=date(2026, 1, 2),
        visited_on_provided=True,
    )
    db_session.commit()

    assert edit.changed is True
    assert edit.material is False


def test_edit_after_reply_flags_the_reply_publicly(
    api, db_session, verified_user, owned_place, moderator
):
    """Readers get told, because otherwise they see a reply that contradicts
    the review above it and have to guess which party is being dishonest."""
    p, owner, _org = owned_place
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, p.id, rating=5).json()["id"]
    assert _reply(api, owner.id, review_id).status_code in (200, 201)

    r = api_author.patch(
        f"/me/reviews/{review_id}",
        json={"rating": 2, "body": "Went back and it was genuinely bad. Avoid."},
    )
    assert r.status_code == 200
    assert r.json()["edited_after_reply"] is True

    # And on the public list, which is what a diner actually reads.
    listed = api.get(f"/places/{p.id}/reviews").json()["items"]
    assert [x["edited_after_reply"] for x in listed] == [True]


def test_edit_before_any_reply_does_not_flag(
    api, db_session, verified_user, owned_place, moderator
):
    """The harmless ordering. Flagging this would cry wolf on every review
    whose author fixed something before the owner got around to answering."""
    p, owner, _org = owned_place
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, p.id, rating=5).json()["id"]

    api_author.patch(f"/me/reviews/{review_id}", json={"rating": 4})
    assert _reply(api, owner.id, review_id).status_code in (200, 201)

    listed = api.get(f"/places/{p.id}/reviews").json()["items"]
    assert [x["edited_after_reply"] for x in listed] == [False]


def test_owner_editing_their_reply_clears_the_flag(
    api, db_session, verified_user, owned_place, moderator
):
    """The flag says "the owner may not have seen this". Once they've revised
    the reply they clearly have, and leaving the warning up would tell readers
    about a problem that's already been dealt with."""
    p, owner, _org = owned_place
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, p.id, rating=5).json()["id"]
    _reply(api, owner.id, review_id)
    api_author.patch(
        f"/me/reviews/{review_id}",
        json={"rating": 2, "body": "Went back and it was genuinely bad. Avoid."},
    )

    assert api.get(f"/places/{p.id}/reviews").json()["items"][0][
        "edited_after_reply"
    ] is True

    r = api.as_user(owner.id).patch(
        f"/places/reviews/{review_id}/reply",
        json={"body": "Sorry to hear the second visit fell short — please reach out."},
    )
    assert r.status_code == 200

    assert api.get(f"/places/{p.id}/reviews").json()["items"][0][
        "edited_after_reply"
    ] is False


def test_material_edit_notifies_the_owner(
    api, db_session, verified_user, owned_place, moderator, monkeypatch
):
    """The whole point. Without this the owner's reply silently rots."""
    from app.modules.reviews import router as reviews_router

    calls: list = []
    monkeypatch.setattr(
        reviews_router,
        "notify_review_edited_after_reply",
        lambda *a, **kw: calls.append(kw),
    )

    p, owner, _org = owned_place
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, p.id, rating=5).json()["id"]
    _reply(api, owner.id, review_id)

    api_author.patch(
        f"/me/reviews/{review_id}",
        json={"rating": 2, "body": "Went back and it was genuinely bad. Avoid."},
    )

    assert len(calls) == 1
    assert calls[0]["previous_rating"] == 5


def test_cosmetic_edit_does_not_notify(
    api, db_session, verified_user, owned_place, moderator, monkeypatch
):
    """A typo fix is not news. This is the check that keeps the channel worth
    reading — an owner who learns to ignore these will ignore the real one."""
    from app.modules.reviews import router as reviews_router

    calls: list = []
    monkeypatch.setattr(
        reviews_router,
        "notify_review_edited_after_reply",
        lambda *a, **kw: calls.append(kw),
    )

    p, owner, _org = owned_place
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, p.id, rating=5).json()["id"]
    _reply(api, owner.id, review_id)

    api_author.patch(f"/me/reviews/{review_id}", json={"body": BODY.replace("the", "teh", 1)})

    assert calls == []


def test_edit_with_no_reply_does_not_notify(
    api, db_session, verified_user, owned_place, moderator, monkeypatch
):
    """Nothing to go stale, and the review is already sitting in the owner's
    "needs reply" bucket where they'll see the current text anyway."""
    from app.modules.reviews import router as reviews_router

    calls: list = []
    monkeypatch.setattr(
        reviews_router,
        "notify_review_edited_after_reply",
        lambda *a, **kw: calls.append(kw),
    )

    p, _owner, _org = owned_place
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, p.id, rating=5).json()["id"]
    api_author.patch(f"/me/reviews/{review_id}", json={"rating": 1})

    assert calls == []


def test_owner_inbox_surfaces_edited_reviews_in_their_own_bucket(
    api, db_session, verified_user, owned_place, moderator
):
    """The bucket has to exist separately: "needs reply" is defined as having
    no reply, so an answered-then-edited review can never appear there, and
    the "all" list sorts by original post date."""
    p, owner, _org = owned_place
    api_author = api.as_user(verified_user.id)
    review_id = _post(api_author, p.id, rating=5).json()["id"]
    _reply(api, owner.id, review_id)
    api_author.patch(
        f"/me/reviews/{review_id}",
        json={"rating": 2, "body": "Went back and it was genuinely bad. Avoid."},
    )

    api_owner = api.as_user(owner.id)

    inbox = api_owner.get("/me/place-reviews?edited_after_reply=true").json()
    assert [x["id"] for x in inbox["items"]] == [review_id]
    assert inbox["edited_after_reply_count"] == 1

    # Still absent from needs-reply, which is exactly why the bucket exists.
    needs = api_owner.get("/me/place-reviews?needs_reply=true").json()
    assert [x["id"] for x in needs["items"]] == []
    assert needs["edited_after_reply_count"] == 1
