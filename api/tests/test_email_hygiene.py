"""Email canonicalisation + disposable screening, and the signup paths that use them.

The pure functions are the load-bearing part — if canonicalisation is wrong
we either merge accounts that shouldn't be (locking a real user out) or fail
to merge the ones that should (the abuse we're trying to stop). So they're
pinned directly, not only through the endpoint.
"""
from __future__ import annotations

from app.core.email_hygiene import canonical_email, is_disposable_domain

PASSWORD = "S3cure-passphrase"


# ---------------------------------------------------------------------------
# Pure functions
# ---------------------------------------------------------------------------


def test_gmail_dots_and_plus_collapse_to_one_inbox():
    assert canonical_email("M.E+trusthalal@GMail.com") == "me@gmail.com"
    assert canonical_email("a.b.c@gmail.com") == "abc@gmail.com"
    assert canonical_email("me@googlemail.com") == "me@gmail.com"


def test_plus_tag_stripped_for_known_aliasing_providers():
    assert canonical_email("user+anything@outlook.com") == "user@outlook.com"
    assert canonical_email("user+x@icloud.com") == "user@icloud.com"


def test_non_special_providers_keep_dots():
    # A provider we don't know treats dots as significant must NOT have them
    # stripped, or we'd merge two different real mailboxes.
    assert canonical_email("a.b@example.com") == "a.b@example.com"


def test_canonical_is_idempotent():
    once = canonical_email("First.Last+tag@gmail.com")
    assert canonical_email(once) == once


def test_disposable_domains_flagged_and_real_ones_not():
    assert is_disposable_domain("x@mailinator.com") is True
    assert is_disposable_domain("x@guerrillamail.com") is True
    assert is_disposable_domain("x@gmail.com") is False
    assert is_disposable_domain("owner@some-restaurant.co") is False


# ---------------------------------------------------------------------------
# Signup enforcement
# ---------------------------------------------------------------------------


def test_signup_rejects_a_disposable_domain(api):
    resp = api.post(
        "/auth/signup",
        json={
            "email": "bot@mailinator.com",
            "password": PASSWORD,
            "display_name": "Bot",
            "role": "CONSUMER",
        },
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "EMAIL_NOT_ALLOWED"


def test_signup_blocks_a_canonical_duplicate(api, db_session):
    """The abuse case: second account at an address that reaches the first
    inbox. me@ then m.e+promo@ must collide."""
    first = api.post(
        "/auth/signup",
        json={
            "email": "realuser@gmail.com",
            "password": PASSWORD,
            "display_name": "Real",
            "role": "CONSUMER",
        },
    )
    assert first.status_code == 200, first.text

    dup = api.post(
        "/auth/signup",
        json={
            "email": "r.eal.user+promo@gmail.com",
            "password": PASSWORD,
            "display_name": "Alsome",
            "role": "CONSUMER",
        },
    )
    assert dup.status_code == 409, dup.text
    assert dup.json()["error"]["code"] == "EMAIL_TAKEN"


def test_signup_stores_the_canonical_key(api, db_session):
    from sqlalchemy import select

    from app.modules.users.models import User

    api.post(
        "/auth/signup",
        json={
            "email": "Canon.Test+x@gmail.com",
            "password": PASSWORD,
            "display_name": "Canon",
            "role": "CONSUMER",
        },
    )
    user = db_session.execute(
        select(User).where(User.email == "Canon.Test+x@gmail.com")
    ).scalar_one()
    # Delivery address kept as typed; dedup key canonicalised.
    assert user.email == "Canon.Test+x@gmail.com"
    assert user.email_canonical == "canontest@gmail.com"


def test_mobile_signup_screens_email_too(api, db_session):
    """The mobile endpoint isn't a side door — same email hygiene applies."""
    resp = api.post(
        "/auth/mobile/signup",
        json={
            "email": "bot@guerrillamail.com",
            "password": PASSWORD,
            "display_name": "Bot",
        },
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "EMAIL_NOT_ALLOWED"
