"""Tests for the transactional email service + the invite-email
wiring.

Three layers exercised:

  1. ``send_email`` happy path — renders the named template pair
     against a captured Resend client and asserts the payload shape
     plus the rendered body content.
  2. ``send_email`` no-op mode — when ``RESEND_API_KEY`` is unset,
     the function returns ``None`` and never calls Resend. Defends
     the "local dev without a key still boots" contract.
  3. End-to-end invite wiring — POST ``/admin/users`` triggers the
     invite email via ``admin_create_user``; assert the captured
     Resend send carried the right To, Subject, and a body
     mentioning the invite URL the response also returned.

Resend is faked at the SDK boundary (``resend.Emails.send``) via
monkeypatch so the tests never touch the network and don't require
a live API key in the test env.
"""
from __future__ import annotations

import pytest

from app.core import email as email_module
from app.core.email import EmailError, send_email


# ---------------------------------------------------------------------------
# Resend fake
# ---------------------------------------------------------------------------


class _CapturedSends:
    """Container the tests assert against. ``captured`` accumulates
    every payload the fake handed back as if it'd been sent."""

    def __init__(self) -> None:
        self.captured: list[dict] = []
        # Test toggles this to make the fake raise like a real
        # Resend HTTP error would.
        self.raise_on_send: Exception | None = None

    def fake_send(self, payload: dict) -> dict:
        if self.raise_on_send is not None:
            raise self.raise_on_send
        self.captured.append(payload)
        return {"id": f"re_test_{len(self.captured)}"}


@pytest.fixture
def captured_emails(monkeypatch):
    """Replace ``resend.Emails.send`` with an in-memory capture and
    set a fake API key so the real send path runs (and we can
    assert against the payload). Yields the capture container.
    """
    sink = _CapturedSends()
    # Patch the SDK boundary, not the wrapper, so we exercise the
    # real ``send_email`` code path top to bottom.
    monkeypatch.setattr(
        email_module.resend.Emails, "send", staticmethod(sink.fake_send)
    )
    # Force a non-empty key so the no-op branch doesn't short-circuit
    # the send. ``email_module.settings`` is the same singleton the
    # function reads from, so patching the attribute is enough.
    monkeypatch.setattr(
        email_module.settings, "RESEND_API_KEY", "re_test_key"
    )
    yield sink


# ---------------------------------------------------------------------------
# Unit: send_email
# ---------------------------------------------------------------------------


def test_send_email_renders_template_and_sends(captured_emails):
    email_id = send_email(
        to="alice@example.com",
        subject="Set up your Trust Halal account",
        template="owner_invite_set_password",
        context={
            "preheader": "Your sign-in link is inside.",
            "display_name": "Alice",
            "invite_url": "https://admin.trusthalal.org/set-password?token=abc",
            "role_label": "restaurant owner",
            "ttl_days": 7,
        },
    )

    assert email_id == "re_test_1"
    assert len(captured_emails.captured) == 1
    sent = captured_emails.captured[0]

    # Payload shape — matches the Resend HTTP contract.
    assert sent["to"] == ["alice@example.com"]
    assert sent["subject"] == "Set up your Trust Halal account"
    assert "from" in sent
    assert "html" in sent
    assert "text" in sent

    # Rendered content carries the context fields. Don't pin the
    # whole HTML — it'd churn on every copy edit — just spot-check
    # the user-facing strings that prove the template ran.
    assert "Alice" in sent["html"]
    assert "restaurant owner" in sent["html"]
    assert "abc" in sent["html"]  # token from the invite_url
    assert "7 days" in sent["html"]

    # Plain-text body shouldn't carry HTML tags — quick sniff that
    # the right template variant got picked up.
    assert "<" not in sent["text"]
    assert "Alice" in sent["text"]


def test_send_email_to_list_normalizes_to_list(captured_emails):
    """``to`` accepts a string or a list — Resend's API takes a list."""
    send_email(
        to=["a@example.com", "b@example.com"],
        subject="Test",
        template="owner_invite_set_password",
        context={
            "preheader": "x",
            "display_name": "",
            "invite_url": "https://example.com",
            "role_label": "consumer",
            "ttl_days": 1,
        },
    )
    assert captured_emails.captured[0]["to"] == [
        "a@example.com",
        "b@example.com",
    ]


def test_send_email_noop_when_api_key_missing(monkeypatch):
    """No key configured → return None, never call Resend."""
    monkeypatch.setattr(email_module.settings, "RESEND_API_KEY", None)
    call_log: list = []
    monkeypatch.setattr(
        email_module.resend.Emails,
        "send",
        staticmethod(lambda payload: call_log.append(payload)),
    )

    result = send_email(
        to="x@example.com",
        subject="Test",
        template="owner_invite_set_password",
        context={
            "preheader": "x",
            "display_name": "",
            "invite_url": "https://example.com",
            "role_label": "consumer",
            "ttl_days": 1,
        },
    )
    assert result is None
    assert call_log == []


def test_send_email_raises_email_error_on_template_typo(
    captured_emails,
):
    """A typo'd template name surfaces as ``EmailError`` (wraps the
    Jinja exception) — so callers have a single exception type to
    catch regardless of whether the failure was render-time or
    network."""
    with pytest.raises(EmailError, match="Failed to render"):
        send_email(
            to="x@example.com",
            subject="Test",
            template="this_template_does_not_exist",
            context={},
        )
    # No Resend call should have happened — render failed first.
    assert captured_emails.captured == []


def test_send_email_raises_email_error_on_resend_failure(
    captured_emails,
):
    """Resend SDK raising bubbles up as ``EmailError`` with the
    original cause chained. Same single-exception contract."""
    captured_emails.raise_on_send = RuntimeError("boom")
    with pytest.raises(EmailError, match="Resend send failed"):
        send_email(
            to="x@example.com",
            subject="Test",
            template="owner_invite_set_password",
            context={
                "preheader": "x",
                "display_name": "",
                "invite_url": "https://example.com",
                "role_label": "consumer",
                "ttl_days": 1,
            },
        )


# ---------------------------------------------------------------------------
# Integration: admin user create → invite email
# ---------------------------------------------------------------------------


def test_admin_create_user_sends_invite_email(
    api, factories, db_session, captured_emails
):
    """POST ``/admin/users`` mints an invite AND triggers the invite
    email. Response carries the URL the admin can also copy manually;
    the email is the convenience layer on top."""
    admin = factories.admin()
    db_session.commit()

    resp = api.as_user(admin).post(
        "/admin/users",
        json={
            "email": "newowner@example.com",
            "role": "OWNER",
            "display_name": "Jane Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert "invite_url" in body
    assert body["user"]["email"] == "newowner@example.com"

    # Exactly one email captured, carrying the right To + Subject +
    # the invite URL the response returned (so the admin's manual
    # fallback and the email lead to the same destination).
    assert len(captured_emails.captured) == 1
    sent = captured_emails.captured[0]
    assert sent["to"] == ["newowner@example.com"]
    assert sent["subject"] == "Set up your Trust Halal account"
    assert body["invite_url"] in sent["html"]
    assert body["invite_url"] in sent["text"]
    # Role-aware body copy — owner gets the owner label, not the
    # default enum value.
    assert "restaurant owner" in sent["html"]


def test_admin_create_user_succeeds_even_when_email_send_fails(
    api, factories, db_session, captured_emails
):
    """Resend outage doesn't break the admin's create-user flow. The
    user row + invite token still land; the response still carries
    the URL the admin can hand-deliver."""
    captured_emails.raise_on_send = RuntimeError("Resend is down")

    admin = factories.admin()
    db_session.commit()

    resp = api.as_user(admin).post(
        "/admin/users",
        json={
            "email": "newuser@example.com",
            "role": "OWNER",
            "display_name": "Joe",
        },
    )
    assert resp.status_code == 201, resp.text
    assert "invite_url" in resp.json()
    # Send was attempted but swallowed by the repo's
    # try/except — captured is empty (the fake raised before
    # capturing).
    assert captured_emails.captured == []
