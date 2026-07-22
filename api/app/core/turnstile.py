"""Cloudflare Turnstile verification for signup.

A CAPTCHA the user almost never sees but a script can't clear. The client
renders the widget, gets a one-time token, and sends it with the signup body;
this module hands that token to Cloudflare's ``siteverify`` and refuses the
signup if Cloudflare doesn't vouch for it.

Mirrors app.core.text_moderation on purpose: a settings flag, a real client,
a no-op client for when it's unconfigured, and a single entry point the
routers call. If you're changing one, read the other.

## Failure posture — fail CLOSED, and why

When Turnstile is enabled and configured, a missing/invalid token, or a
Cloudflare that can't be reached after retries, **rejects the signup**. That
is the same call text_moderation makes, and it's deliberate: the entire point
is to keep bots out, and "let everyone through when the checker is down" is
precisely when a bot flood would walk in.

The cost is real — a Cloudflare outage blocks all new signups for its
duration. ``TURNSTILE_FAIL_OPEN`` exists to flip that trade in an emergency
(accept signups when Cloudflare is unreachable), defaulting off. Reach for it
only if a Cloudflare incident is actively costing you real users; the bots
will also walk in while it's on.

## Mobile

The React Native app can't render the widget without a WebView-based
integration that hasn't shipped, so ``mobile=True`` verification is gated
behind ``TURNSTILE_REQUIRE_MOBILE`` (default off). Until that's on, the mobile
endpoint is protected by email hygiene + rate limits only, and flipping the
flag on before the app has a widget would break signup in the shipped app.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import httpx
from fastapi import Request

from app.core.config import settings
from app.core.exceptions import BadRequestError

logger = logging.getLogger(__name__)

_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
_TIMEOUT_SECONDS = 5.0
_RETRIES = 2


class TurnstileError(Exception):
    """Cloudflare couldn't be reached or answered unusably. The caller turns
    this into a rejected signup unless ``TURNSTILE_FAIL_OPEN`` is set."""


def _client_ip(request: Request) -> Optional[str]:
    """Best-effort caller IP for Cloudflare's optional ``remoteip`` check.

    Same caveat as the rate limiter: only trustworthy if the proxy is
    configured to set forwarded headers correctly. Passed to Cloudflare as a
    hint, never used as a security boundary here.
    """
    if request.client is None:
        return None
    return request.client.host


def _verify_token(token: str, *, remote_ip: Optional[str]) -> bool:
    """Ask Cloudflare whether this token is good. Raises TurnstileError if
    Cloudflare can't be reached; returns the boolean verdict otherwise."""
    secret = settings.TURNSTILE_SECRET_KEY
    if not secret:
        # Enabled but keyless is a deployment mistake — fail loudly rather
        # than silently letting everyone through.
        raise TurnstileError(
            "TURNSTILE_ENABLED is true but TURNSTILE_SECRET_KEY is unset."
        )

    payload = {"secret": secret, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip

    last_exc: Exception | None = None
    for attempt in range(_RETRIES + 1):
        try:
            resp = httpx.post(_ENDPOINT, data=payload, timeout=_TIMEOUT_SECONDS)
            resp.raise_for_status()
            data = resp.json()
            success = bool(data.get("success"))
            if not success:
                # Log the error codes so a spike of "invalid token" (bots) vs
                # "timeout-or-duplicate" (a real widget bug) is tellable apart.
                logger.info(
                    "turnstile rejected token: %s", data.get("error-codes")
                )
            return success
        except Exception as exc:  # httpx errors + JSON decode
            last_exc = exc
            if attempt < _RETRIES:
                time.sleep(0.5 * (attempt + 1))
                continue
            raise TurnstileError(
                f"Cloudflare siteverify failed: {exc}"
            ) from last_exc
    return False  # unreachable; keeps type checkers happy


def verify_signup_captcha(
    token: Optional[str], *, remote_ip: Optional[str], mobile: bool = False
) -> None:
    """Gate a signup on a valid Turnstile token. Returns on success, raises a
    ``BadRequestError`` (surfaced as 400) on failure.

    No-ops when the feature is off, or when it's on but this is the mobile
    path and ``TURNSTILE_REQUIRE_MOBILE`` is off — see the module docstring.
    """
    if not settings.TURNSTILE_ENABLED:
        return
    if mobile and not settings.TURNSTILE_REQUIRE_MOBILE:
        return

    if not token:
        raise BadRequestError(
            "CAPTCHA_REQUIRED",
            "Please complete the verification challenge and try again.",
        )

    try:
        ok = _verify_token(token, remote_ip=remote_ip)
    except TurnstileError as exc:
        if settings.TURNSTILE_FAIL_OPEN:
            logger.warning(
                "turnstile unreachable, failing OPEN (bots may pass): %s", exc
            )
            return
        logger.error("turnstile unreachable, failing closed: %s", exc)
        raise BadRequestError(
            "CAPTCHA_UNAVAILABLE",
            "We couldn't run the verification check just now. Please try "
            "again in a moment.",
        ) from exc

    if not ok:
        raise BadRequestError(
            "CAPTCHA_FAILED",
            "That verification didn't check out. Please try the challenge "
            "again.",
        )
