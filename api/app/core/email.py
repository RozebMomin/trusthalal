"""Transactional email service.

Single ``send_email(...)`` entrypoint that:

  1. Loads a paired Jinja2 template (``<name>.html.jinja`` +
     ``<name>.txt.jinja``) from ``app/emails/templates/``.
  2. Renders both with the caller's context dict.
  3. Sends through Resend via their Python SDK, returning the
     resulting email id on success.

Both an HTML and a plain-text body are sent on every message —
deliverability is materially better when multipart/alternative is
present, and a corporate spam filter that strips HTML still hands
the recipient a readable text version. The two templates inherit a
shared ``_base`` so styling + footer copy lives in one place; the
per-email template just overrides the ``content`` block.

When ``RESEND_API_KEY`` is unset (local dev without a Resend
account, ephemeral CI, etc.) the function is a graceful no-op —
the template still renders (so a typo in the template is still a
loud error in dev) and the rendered HTML is logged at DEBUG. This
keeps the call-site contract honest ("you can always call
send_email") without forcing every test or scratch script to wire
up a fake.

Why not React Email / MJML / etc.
---------------------------------
The API process is Python-only. Jinja2 templates living next to
the backend code mean no Node sidecar at runtime and no separate
build step. The downside — less reusable design components —
matters less for transactional email where each message is mostly
prose with a single CTA button.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import resend
from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from app.core.config import settings


logger = logging.getLogger(__name__)


class EmailError(Exception):
    """Raised when an outbound email fails for any reason.

    Wraps the underlying Resend / Jinja error so callers (the auth
    invite path, the claim-approval path, etc.) can branch on a
    single exception type. The original cause is chained.
    """


# ---------------------------------------------------------------------------
# Template environment
# ---------------------------------------------------------------------------

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "emails" / "templates"

# Singleton Jinja env. ``StrictUndefined`` flips a missing variable
# from a silent empty-string render to a loud ``UndefinedError`` so a
# template that references ``{{ recipient_name }}`` while the caller
# passed ``user_name`` fails the test that exercises it instead of
# emitting a half-blank email to a real user.
_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "jinja"]),
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)


def _render_pair(template: str, context: dict[str, Any]) -> tuple[str, str]:
    """Render the ``<template>.html.jinja`` + ``<template>.txt.jinja``
    pair with the same context.

    Both must exist — a missing text template means the recipient's
    client falls back to an auto-converted HTML body that's almost
    always uglier than a hand-written text version. Tests assert the
    pair is present for every shipped template name.
    """
    html = _env.get_template(f"{template}.html.jinja").render(**context)
    text = _env.get_template(f"{template}.txt.jinja").render(**context)
    return html, text


# ---------------------------------------------------------------------------
# Send
# ---------------------------------------------------------------------------


def send_email(
    *,
    to: str | list[str],
    subject: str,
    template: str,
    context: dict[str, Any],
    from_email: str | None = None,
    reply_to: str | None = None,
) -> str | None:
    """Render the named template and send through Resend.

    Returns the Resend email id on success, ``None`` when the API
    key isn't configured (no-op mode). Raises ``EmailError`` when
    the template fails to render or Resend rejects the send.

    Args:
      to: One recipient email, or a list for multi-recipient sends.
        Resend accepts up to 50 addresses per request; we cap at 1
        in practice because every outbound is per-user transactional.
      subject: ``Subject:`` header. The caller owns the copy.
      template: Filename stem under ``app/emails/templates/``. Both
        ``<template>.html.jinja`` and ``<template>.txt.jinja`` must
        exist.
      context: Variables passed into both templates. ``StrictUndefined``
        means a missing key raises during render — caller's
        responsibility to pass everything the templates reference.
      from_email: Override the configured ``RESEND_FROM_EMAIL``.
        Useful for admin-facing emails that want a different sender
        identity. Defaults to ``settings.RESEND_FROM_EMAIL``.
      reply_to: Override the configured ``RESEND_REPLY_TO``. Pass
        ``""`` to explicitly omit the header for one send. Defaults
        to ``settings.RESEND_REPLY_TO`` (may be None).
    """
    # Render first — a template error is a developer mistake we want
    # to surface in dev even when the API key isn't set.
    try:
        html_body, text_body = _render_pair(template, context)
    except Exception as exc:
        raise EmailError(
            f"Failed to render email template {template!r}: {exc}"
        ) from exc

    # No-op mode for local dev / CI without a Resend account. We log
    # the rendered HTML at DEBUG so a developer who wants to eyeball
    # the output can still see it. Returning None signals "didn't
    # actually send" so callers can branch (e.g., the CLI invite
    # script prints the URL in addition to triggering the email).
    if not settings.RESEND_API_KEY:
        logger.info(
            "[email] RESEND_API_KEY not configured — skipping send",
            extra={"template": template, "to": to, "subject": subject},
        )
        logger.debug("[email] would-have-sent body:\n%s", html_body)
        return None

    # Re-apply the API key on every send — the SDK reads from a
    # module global, and we want to support test fixtures that
    # swap settings.RESEND_API_KEY at runtime.
    resend.api_key = settings.RESEND_API_KEY

    payload: dict[str, Any] = {
        "from": from_email or settings.RESEND_FROM_EMAIL,
        "to": to if isinstance(to, list) else [to],
        "subject": subject,
        "html": html_body,
        "text": text_body,
    }
    effective_reply_to = (
        reply_to if reply_to is not None else settings.RESEND_REPLY_TO
    )
    if effective_reply_to:
        payload["reply_to"] = effective_reply_to

    try:
        result = resend.Emails.send(payload)
    except Exception as exc:
        raise EmailError(f"Resend send failed: {exc}") from exc

    email_id = result.get("id") if isinstance(result, dict) else None
    logger.info(
        "[email] sent",
        extra={
            "template": template,
            "to": to,
            "subject": subject,
            "resend_id": email_id,
        },
    )
    return email_id
