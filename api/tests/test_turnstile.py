"""Turnstile signup gate.

The network call to Cloudflare is stubbed — what's under test is the policy
around the verdict (when we enforce, when we no-op, fail-open vs fail-closed),
not Cloudflare's own correctness.
"""
from __future__ import annotations

import pytest

from app.core import turnstile
from app.core.exceptions import BadRequestError

PASSWORD = "S3cure-passphrase"


@pytest.fixture
def enable_turnstile(monkeypatch):
    monkeypatch.setattr(turnstile.settings, "TURNSTILE_ENABLED", True)
    monkeypatch.setattr(turnstile.settings, "TURNSTILE_SECRET_KEY", "test-secret")
    monkeypatch.setattr(turnstile.settings, "TURNSTILE_FAIL_OPEN", False)
    monkeypatch.setattr(turnstile.settings, "TURNSTILE_REQUIRE_MOBILE", False)


def test_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(turnstile.settings, "TURNSTILE_ENABLED", False)
    # No token, no network — must simply return.
    turnstile.verify_signup_captcha(None, remote_ip=None)


def test_missing_token_is_rejected_when_enabled(enable_turnstile):
    with pytest.raises(BadRequestError) as exc:
        turnstile.verify_signup_captcha(None, remote_ip=None)
    assert exc.value.code == "CAPTCHA_REQUIRED"


def test_valid_token_passes(enable_turnstile, monkeypatch):
    monkeypatch.setattr(turnstile, "_verify_token", lambda *a, **k: True)
    turnstile.verify_signup_captcha("good-token", remote_ip="1.2.3.4")


def test_invalid_token_is_rejected(enable_turnstile, monkeypatch):
    monkeypatch.setattr(turnstile, "_verify_token", lambda *a, **k: False)
    with pytest.raises(BadRequestError) as exc:
        turnstile.verify_signup_captcha("bad-token", remote_ip=None)
    assert exc.value.code == "CAPTCHA_FAILED"


def test_cloudflare_outage_fails_closed_by_default(enable_turnstile, monkeypatch):
    def boom(*a, **k):
        raise turnstile.TurnstileError("cloudflare down")

    monkeypatch.setattr(turnstile, "_verify_token", boom)
    with pytest.raises(BadRequestError) as exc:
        turnstile.verify_signup_captcha("token", remote_ip=None)
    assert exc.value.code == "CAPTCHA_UNAVAILABLE"


def test_fail_open_flag_lets_signup_through_during_outage(
    enable_turnstile, monkeypatch
):
    monkeypatch.setattr(turnstile.settings, "TURNSTILE_FAIL_OPEN", True)

    def boom(*a, **k):
        raise turnstile.TurnstileError("cloudflare down")

    monkeypatch.setattr(turnstile, "_verify_token", boom)
    # Returns instead of raising — the emergency valve.
    turnstile.verify_signup_captcha("token", remote_ip=None)


def test_mobile_path_skips_captcha_until_flag_on(enable_turnstile):
    # mobile=True with TURNSTILE_REQUIRE_MOBILE off → no token needed.
    turnstile.verify_signup_captcha(None, remote_ip=None, mobile=True)


def test_mobile_path_enforces_when_flag_on(enable_turnstile, monkeypatch):
    monkeypatch.setattr(turnstile.settings, "TURNSTILE_REQUIRE_MOBILE", True)
    with pytest.raises(BadRequestError) as exc:
        turnstile.verify_signup_captcha(None, remote_ip=None, mobile=True)
    assert exc.value.code == "CAPTCHA_REQUIRED"
