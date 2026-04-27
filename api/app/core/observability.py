"""Sentry initialization + request-ID propagation.

Call ``init_sentry()`` once at app startup, before any imports that
might raise an exception we'd want captured. Reads ``SENTRY_DSN`` from
env — if unset, init is a no-op so local dev and tests don't ship
events to nowhere or pollute the prod project.

Request-ID middleware (``RequestIDMiddleware``) reads or mints an
``X-Request-ID`` for every request, attaches it to the Sentry scope as
a tag, and echoes it on the response. Frontends pluck the same header
off responses and attach it to their own Sentry breadcrumbs, so a
single request shows up under the same correlation key on both sides
of the wire.

Why we don't use ``sentry-sdk[fastapi]``'s built-in trace IDs:
they're per-transaction (sample-rate-gated) where we want a stable
correlation key on every request, including the ones Sentry chose
not to record. A 4-byte UUID is cheap enough to mint unconditionally.
"""
from __future__ import annotations

import logging
import os
import sys
import uuid
from typing import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"


def init_sentry() -> bool:
    """Initialize Sentry if a DSN is configured.

    Returns True when init ran (DSN was set + import worked), False
    otherwise. We always emit a status line on stderr so boot-time
    diagnostics are visible regardless of where the logging
    configuration lands — Render shows everything written to stderr
    in the service log, so "did Sentry init?" is answerable from the
    log tab without having to dig.

    Imports sentry-sdk lazily so the dependency stays soft — the
    server still boots if the package isn't installed yet (e.g. on a
    branch that hasn't picked up the new requirements file).
    """
    dsn = os.getenv("SENTRY_DSN", "").strip()

    if not dsn:
        # Print to stderr so the message survives any logging config
        # ordering issue (the early-boot logger may be at WARNING level).
        # ``flush=True`` so Render captures it before the next line.
        print(
            "[observability] SENTRY_DSN not set — Sentry disabled.",
            file=sys.stderr,
            flush=True,
        )
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    except ImportError as exc:
        print(
            f"[observability] SENTRY_DSN is set but sentry-sdk import "
            f"failed ({exc}); Sentry disabled.",
            file=sys.stderr,
            flush=True,
        )
        return False

    environment = os.getenv("APP_ENV") or os.getenv("ENV") or "development"
    release = os.getenv("APP_RELEASE_SHA") or os.getenv("RENDER_GIT_COMMIT")
    traces_sample_rate = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1"))
    profiles_sample_rate = float(
        os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "0.0")
    )

    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=environment,
            release=release,
            integrations=[
                FastApiIntegration(),
                StarletteIntegration(),
                SqlalchemyIntegration(),
            ],
            traces_sample_rate=traces_sample_rate,
            profiles_sample_rate=profiles_sample_rate,
            # PII off by default — we don't want emails, IPs, or session
            # cookies leaking into the issues UI. Flip to True with intent
            # if a debugging session warrants it.
            send_default_pii=False,
            # Drop the Authorization header / Cookie before send as
            # belt-and-suspenders even if PII flips on.
            before_send=_strip_sensitive_headers,
        )
    except Exception as exc:  # pragma: no cover — defensive
        print(
            f"[observability] sentry_sdk.init() raised {type(exc).__name__}: "
            f"{exc}; Sentry disabled.",
            file=sys.stderr,
            flush=True,
        )
        return False

    # Mask the host portion of the DSN before printing so we don't put
    # the secret in the log. The DSN format is
    # ``https://<public_key>@<host>/<project_id>``.
    dsn_host = "<unknown>"
    try:
        from urllib.parse import urlparse

        parsed = urlparse(dsn)
        if parsed.hostname:
            dsn_host = parsed.hostname
    except Exception:
        pass

    print(
        f"[observability] Sentry initialized: env={environment} "
        f"release={release or '<none>'} traces={traces_sample_rate:.2f} "
        f"host={dsn_host}",
        file=sys.stderr,
        flush=True,
    )
    return True


def _strip_sensitive_headers(event, _hint):
    """Defense-in-depth scrubber: nuke auth + cookie headers from events.

    Sentry has its own default scrubber but it errs on the lenient side
    (e.g. doesn't always catch ``cookie`` casing variants). We also
    drop the ``X-User-Id`` test header just in case it lands in an
    accidentally-not-stripped local environment.
    """
    request = event.get("request") or {}
    headers = request.get("headers") or {}
    if headers:
        for key in list(headers.keys()):
            lk = key.lower()
            if lk in ("authorization", "cookie", "set-cookie", "x-user-id"):
                headers[key] = "[Filtered]"
        request["headers"] = headers
        event["request"] = request
    return event


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Mint or honor ``X-Request-ID`` for every request.

    * If the client sent a header value (e.g. our frontend forwarding
      one from the previous hop), we honor it.
    * Otherwise we mint a UUID4.
    * The id is attached to the Sentry scope as a tag so issues
      cluster correctly across browser + server, and echoed on the
      response so the frontend sees the same value the server logged.
    * The id is also stashed on ``request.state.request_id`` so route
      handlers and downstream services can reference it (e.g. as a
      ``X-Request-ID`` outbound header on calls to Google).
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER, "").strip()
        # Cap an honored header at 64 chars + alnum/hyphen so a hostile
        # client can't poison Sentry tag values with arbitrary data.
        request_id = (
            incoming
            if (incoming and len(incoming) <= 64 and _looks_like_id(incoming))
            else uuid.uuid4().hex
        )
        request.state.request_id = request_id

        # Attach to Sentry scope for any errors raised while handling
        # this request. Lazily import sentry_sdk so the middleware is
        # safe even when Sentry isn't installed.
        try:
            import sentry_sdk

            with sentry_sdk.configure_scope() as scope:
                scope.set_tag("request_id", request_id)
        except ImportError:
            pass

        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


def _looks_like_id(s: str) -> bool:
    """Permit the small alphabet we'd realistically emit as a request ID.

    Hex (uuid4 / sha-prefix), base32-ish (some tools), and our own
    hyphenated UUIDs all pass. Anything with whitespace, control
    characters, or punctuation outside ``-`` is rejected and we mint
    a fresh id instead.
    """
    return all(c.isalnum() or c == "-" for c in s)
