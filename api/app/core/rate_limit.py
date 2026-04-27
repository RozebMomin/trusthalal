"""Rate limiting for public + sensitive endpoints.

Uses slowapi (the de-facto FastAPI rate limit library). Counters live
in-memory by default — fine while we're on a single Render web
instance. Set ``RATE_LIMIT_REDIS_URL`` to a Redis URL when we either
scale out or want limits to survive deploys.

Two key functions, picked per-endpoint:

* ``ip_key`` — bucket by client IP. Used on auth (signup/login/etc.)
  and on public endpoints where we don't have a user yet.

* ``user_or_ip_key`` — bucket by session cookie when present, IP
  otherwise. Used on owner-mutating endpoints where we want one
  pool per account, not per IP, so users behind a NAT (an office,
  a coffee shop) don't burn each other's quota.

  Important: the key here is the cookie value, NOT the resolved
  user_id. We deliberately don't do a DB lookup at the rate-limit
  layer (slowapi runs before FastAPI dependency injection has
  built a session). Two requests from the same valid session land
  in the same bucket; a forged or expired cookie doesn't auth
  elsewhere so it doesn't matter that it might collide with itself.

The 429 response uses the standard ``ErrorResponse`` envelope so
clients can branch on ``error.code == "RATE_LIMITED"`` like any
other failure mode. The retry hint rides under ``error.detail``.

To apply a limit on a route, decorate it with ``@limiter.limit(...)``
and add ``request: Request`` to the signature — slowapi reads the
client info off the request. Stack multiple decorators to enforce
both short and long windows (e.g. ``5/minute`` AND ``50/hour``).
"""
from __future__ import annotations

import logging
import os

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address


# Cookie name duplicated here to avoid a circular import (the auth
# module imports from app.core; we don't want app.core importing
# back from app.modules). Same value as
# app.modules.auth.router.SESSION_COOKIE_NAME — kept in sync by code
# review, asserted on by ``test_rate_limit_cookie_constant`` if
# drift becomes a worry.
_SESSION_COOKIE_NAME = "tht_session"

logger = logging.getLogger(__name__)


def ip_key(request: Request) -> str:
    """IP-based bucket. slowapi's util respects X-Forwarded-For if
    we ever sit behind a proxy that sets it (Render does, on the
    Render edge → Render service hop)."""
    return get_remote_address(request)


def user_or_ip_key(request: Request) -> str:
    """Per-session bucket when authenticated, per-IP fallback otherwise."""
    cookie = request.cookies.get(_SESSION_COOKIE_NAME)
    if cookie:
        # Hash-stable: same cookie value → same bucket. Don't include
        # IP — a user moving between Wi-Fi networks shouldn't reset.
        return f"session:{cookie}"
    return f"ip:{get_remote_address(request)}"


def _build_limiter() -> Limiter:
    """Construct the singleton Limiter.

    Reads optional Redis URL from env so the swap to a shared
    backend is one env var, not a code change.

    ``RATE_LIMIT_ENABLED=false`` flips slowapi into pass-through
    mode — used by the pytest harness so tests that hammer
    /auth/signup or /auth/login don't trip the per-minute caps.
    """
    redis_url = os.getenv("RATE_LIMIT_REDIS_URL", "").strip()
    enabled = os.getenv("RATE_LIMIT_ENABLED", "true").strip().lower() != "false"
    storage_uri = redis_url or "memory://"
    if not enabled:
        logger.info("Rate limiter DISABLED (RATE_LIMIT_ENABLED=false)")
    elif redis_url:
        logger.info("Rate limiter using Redis backend")
    else:
        logger.info("Rate limiter using in-memory backend (single-instance only)")
    return Limiter(
        key_func=ip_key,  # default; per-decorator overrides via key_func=
        storage_uri=storage_uri,
        # Emit X-RateLimit-{Limit,Remaining,Reset} headers on every
        # response so clients can be polite without us spelling out
        # the limits in docs.
        headers_enabled=True,
        # Strategy "fixed-window" is cheap and predictable; we
        # don't need sliding-window precision for this scale.
        strategy="fixed-window",
        # Pass-through when disabled — decorators stay in place but
        # don't actually count.
        enabled=enabled,
    )


limiter: Limiter = _build_limiter()


async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
) -> JSONResponse:
    """Wrap slowapi's 429 in our standard ErrorResponse envelope.

    slowapi's default handler emits ``{"error": "Rate limit exceeded: ..."}``
    which doesn't match the ``{"error": {"code", "message", "detail"}}``
    shape every other failure uses. Override so clients can parse one
    envelope across the board.

    The ``Retry-After`` header is preserved if slowapi attached one
    (some strategies do, some don't — fixed-window does not, so we
    skip it rather than emit a misleading value).
    """
    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": "RATE_LIMITED",
                "message": (
                    "You've sent too many requests. "
                    "Please slow down and try again in a moment."
                ),
                "detail": {"limit": str(exc.detail)} if exc.detail else None,
            }
        },
    )
