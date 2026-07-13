"""Server-side product analytics — a thin PostHog capture client.

Emits the marketplace / trust-engine events that clients can't see or
shouldn't be trusted to report: admin claim decisions, verifier outcomes,
disputes, ingestion. Events go to the SAME PostHog project as the web +
mobile clients (keyed by the acting user's id), so a person's server-side
actions unify with their app/web activity.

Design:
  * Fire-and-forget on a small thread pool — never blocks or fails the
    request that triggered it.
  * No-ops when ``POSTHOG_API_KEY`` is unset (local dev / preview), so call
    sites never have to guard.
  * Called from the central event recorders (``log_halal_claim_event``,
    ``log_place_event``, …), which run inside the business transaction just
    before commit. A rolled-back operation could therefore emit a phantom
    event, but that path is rare and analytics tolerates the noise.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional, Union
from uuid import UUID

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Small, bounded pool so a slow/unavailable PostHog never backs up requests.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="posthog")


def track(
    event: str,
    *,
    distinct_id: Optional[Union[str, UUID]],
    properties: Optional[dict[str, Any]] = None,
) -> None:
    """Queue a PostHog event. Returns immediately; sends on a worker thread."""
    key = settings.POSTHOG_API_KEY
    if not key:
        return

    host = (settings.POSTHOG_HOST or "https://us.i.posthog.com").rstrip("/")
    did = str(distinct_id) if distinct_id else "system"
    payload = {
        "api_key": key,
        "event": event,
        "distinct_id": did,
        "properties": {
            **(properties or {}),
            "$lib": "trusthalal-api",
            "source": "server",
        },
    }

    def _send() -> None:
        try:
            httpx.post(f"{host}/capture/", json=payload, timeout=3.0)
        except Exception:
            # Analytics must never surface to the caller.
            logger.debug("posthog capture failed for %s", event, exc_info=True)

    try:
        _executor.submit(_send)
    except Exception:
        logger.debug("posthog submit failed for %s", event, exc_info=True)
