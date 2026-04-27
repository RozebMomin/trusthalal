"""Pin the rate-limit 429 contract.

The pytest harness disables rate limits globally via
``RATE_LIMIT_ENABLED=false`` (see conftest.py) so happy-path tests can
hammer endpoints without tripping caps. This module flips the limiter
back on locally, drives a small handful of requests against the
cheapest decorated endpoint (``GET /places/google/autocomplete``,
which limits at 30/minute per IP), and verifies the contract:

  * 429 status when the cap is exceeded.
  * Body matches the standard ErrorResponse envelope:
    ``{"error": {"code": "RATE_LIMITED", "message": "...", "detail": ...}}``.
  * ``X-Request-ID`` header still echoes (the request-ID middleware
    runs after the limiter rejects, so this header should still be
    present for log correlation).

We pick the autocomplete endpoint specifically because it's a public
GET — no auth fixtures, no DB writes, no side effects. Calling it
also doesn't hit Google because the API key isn't configured in the
test env, so the limiter rejection lands BEFORE the upstream proxy
call. Side benefit: 429s here don't wedge against Google's quota.
"""
from __future__ import annotations

import pytest

from app.core import rate_limit


@pytest.fixture
def enabled_limiter():
    """Re-enable the limiter for the duration of one test.

    slowapi's ``Limiter`` exposes ``enabled`` as a mutable property;
    we flip it on, ensure counters are reset so we start at zero,
    and restore both on teardown so neighbouring tests in the same
    pytest run aren't affected.
    """
    rate_limit.limiter.enabled = True
    rate_limit.limiter.reset()
    try:
        yield rate_limit.limiter
    finally:
        rate_limit.limiter.reset()
        rate_limit.limiter.enabled = False


def test_rate_limited_response_uses_standard_envelope(api, enabled_limiter):
    """Drive the autocomplete endpoint past 30/minute and verify the
    429 envelope shape + request-ID header echo."""
    # The autocomplete endpoint requires q=, but the request rejects
    # at the limiter before validation runs once we exceed the cap.
    path = "/places/google/autocomplete?q=test"

    # Burn through the per-minute cap. We don't care about the body
    # of the successful (or upstream-failed) responses here, only the
    # transition to 429.
    last_resp = None
    for _ in range(35):
        last_resp = api.get(path)
        if last_resp.status_code == 429:
            break

    assert last_resp is not None
    assert last_resp.status_code == 429, (
        f"expected 429 after exceeding cap, got {last_resp.status_code}: "
        f"{last_resp.text}"
    )

    body = last_resp.json()
    assert "error" in body, f"missing error envelope: {body}"
    err = body["error"]
    assert err["code"] == "RATE_LIMITED"
    assert "too many requests" in err["message"].lower()
    # detail is optional but if present should carry a parseable
    # ``limit`` description string.
    if err.get("detail") is not None:
        assert "limit" in err["detail"]

    # Request-ID middleware runs outermost so the header should be
    # present even on a limiter-rejected response. Test it once on
    # the failure response — the contract matters most here.
    assert last_resp.headers.get("X-Request-ID"), (
        "X-Request-ID header should be set on rate-limited responses"
    )


def test_x_request_id_echoes_when_client_provides_one(api):
    """The middleware honors a client-supplied X-Request-ID up to
    64 chars of alphanumeric+hyphen and echoes it on the response.
    Anything else gets replaced with a freshly minted UUID."""
    incoming = "test-request-id-1234"
    resp = api.get("/health", headers={"X-Request-ID": incoming})
    assert resp.status_code == 200
    assert resp.headers.get("X-Request-ID") == incoming


def test_x_request_id_replaced_when_malformed(api):
    """A client header with whitespace or punctuation outside [-A-Za-z0-9]
    gets replaced with a server-minted UUID rather than echoed."""
    resp = api.get("/health", headers={"X-Request-ID": "bad value with spaces"})
    assert resp.status_code == 200
    echoed = resp.headers.get("X-Request-ID", "")
    assert echoed
    assert echoed != "bad value with spaces"
    # UUID4 hex form: 32 chars of [0-9a-f]
    assert all(c in "0123456789abcdef" for c in echoed)
