"""Who accepted the terms, to what version, and when.

App Store Guideline 1.2 requires users of a UGC app to agree to terms. The
notice on the signup screens is the agreement; these tests pin the record of
it, which is the part that has to survive a dispute or a revision by counsel.

The property that matters most is the one in
``test_existing_accounts_are_not_backfilled``: an account that predates this
feature must read as "never accepted", because it never did. Anything that
quietly marks those users as having agreed is manufacturing evidence of
consent, which is worse than having no record at all.
"""
from __future__ import annotations

from sqlalchemy import select

from app.core.legal import TERMS_VERSION, acceptance_required
from app.modules.users.models import User

PASSWORD = "S3cure-passphrase"


def _signup(api, email: str, *, role: str = "CONSUMER"):
    return api.post(
        "/auth/signup",
        json={
            "email": email,
            "password": PASSWORD,
            "display_name": "Terms Tester",
            "role": role,
        },
    )


# ---------------------------------------------------------------------------
# The pure predicate
# ---------------------------------------------------------------------------


def test_acceptance_required_is_driven_by_version_not_a_flag():
    """A boolean would answer 'ever accepted anything', which stops being the
    useful question the first time the document is revised."""
    assert acceptance_required(None) is True
    assert acceptance_required("1999-01-01") is True
    assert acceptance_required(TERMS_VERSION) is False


# ---------------------------------------------------------------------------
# Signup stamps
# ---------------------------------------------------------------------------


def test_web_signup_records_acceptance(api, db_session):
    """The signup screen shows the notice above the button, so arriving here
    IS the acceptance. If it weren't stamped, every new account would be born
    owing an acknowledgement it had already given."""
    assert _signup(api, "terms-web@example.com").status_code == 200

    user = db_session.execute(
        select(User).where(User.email == "terms-web@example.com")
    ).scalar_one()
    assert user.terms_version == TERMS_VERSION
    assert user.terms_accepted_at is not None


def test_mobile_signup_records_acceptance(api, db_session):
    resp = api.post(
        "/auth/mobile/signup",
        json={
            "email": "terms-mobile@example.com",
            "password": PASSWORD,
            "display_name": "Terms Tester",
        },
    )
    assert resp.status_code in (200, 201), resp.text

    user = db_session.execute(
        select(User).where(User.email == "terms-mobile@example.com")
    ).scalar_one()
    assert user.terms_version == TERMS_VERSION
    assert user.terms_accepted_at is not None


def test_a_fresh_signup_is_not_prompted(api, db_session):
    """They just agreed. Prompting them immediately would read as the app
    having lost the answer it was given ten seconds ago."""
    assert _signup(api, "terms-fresh@example.com").status_code == 200
    user = db_session.execute(
        select(User).where(User.email == "terms-fresh@example.com")
    ).scalar_one()

    body = api.as_user(user.id).get("/me").json()
    assert body["terms_acceptance_required"] is False


# ---------------------------------------------------------------------------
# Existing accounts — the population the prompt exists for
# ---------------------------------------------------------------------------


def test_existing_accounts_are_not_backfilled(api, db_session, factories):
    """Every account that existed when this shipped had never been shown
    terms — including the people whose reviews and photos the content licence
    is written to cover. NULL is the honest state and the prompt's trigger."""
    user = factories.user(email="terms-legacy@example.com")
    db_session.commit()

    assert user.terms_version is None
    assert user.terms_accepted_at is None
    assert api.as_user(user.id).get("/me").json()["terms_acceptance_required"] is True


def test_accepting_clears_the_prompt(api, db_session, factories):
    user = factories.user(email="terms-accept@example.com")
    db_session.commit()

    resp = api.as_user(user.id).post("/me/accept-terms")
    assert resp.status_code == 200, resp.text
    # Returned inline so the client dismisses from the response rather than
    # refetching and briefly re-showing the prompt.
    assert resp.json()["terms_acceptance_required"] is False

    db_session.expire_all()
    refreshed = db_session.get(User, user.id)
    assert refreshed.terms_version == TERMS_VERSION
    assert refreshed.terms_accepted_at is not None
    assert api.as_user(user.id).get("/me").json()["terms_acceptance_required"] is False


def test_a_stale_version_re_prompts(api, db_session, factories):
    """The whole reason this is a version string. Counsel revises the terms,
    TERMS_VERSION is bumped, and everyone is asked again — no migration, no
    flag to remember to reset."""
    user = factories.user(email="terms-stale@example.com")
    user.terms_version = "2020-01-01"
    db_session.commit()

    assert api.as_user(user.id).get("/me").json()["terms_acceptance_required"] is True


def test_accepting_twice_is_harmless(api, db_session, factories):
    """A double-tap on the prompt's button must not error."""
    user = factories.user(email="terms-twice@example.com")
    db_session.commit()

    assert api.as_user(user.id).post("/me/accept-terms").status_code == 200
    assert api.as_user(user.id).post("/me/accept-terms").status_code == 200


def test_anonymous_cannot_accept(api):
    assert api.post("/me/accept-terms").status_code == 401
