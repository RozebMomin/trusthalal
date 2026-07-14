"""One-click unsubscribe endpoints for notification emails.

Two-step by design: the link in the email is a GET that renders a small
confirmation page with a button; the button POSTs to actually unsubscribe.
This keeps email-client link *prefetching* from silently unsubscribing
people (a real problem with single-GET unsubscribe links).

Served as self-contained HTML by the API so no frontend page is needed.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.core.notifications import unsubscribe, verify_unsubscribe_token
from app.db.deps import get_db

router = APIRouter(prefix="/notifications", tags=["notifications"])

_CATEGORY_LABELS = {
    "PLACE_VERIFIED": "updates when a place you saved becomes verified",
    "CLAIM_DECISION": "halal-claim decision emails",
    "DISPUTE": "dispute emails",
    "VERIFIER": "verifier emails",
}


def _page(title: str, body: str, *, status: int = 200) -> HTMLResponse:
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f6f7;margin:0;padding:48px 16px;color:#1a1a1a;">
  <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #ececef;border-radius:12px;padding:28px;">
    {body}
  </div>
</body></html>"""
    return HTMLResponse(content=html, status_code=status)


_INVALID = _page(
    "Link expired",
    "<h1 style='font-size:20px;margin:0 0 10px;'>This link is no longer valid</h1>"
    "<p style='color:#555;margin:0;'>The unsubscribe link is malformed or has "
    "expired. You can manage email preferences from your account settings.</p>",
    status=400,
)


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe_landing(token: str) -> HTMLResponse:
    parsed = verify_unsubscribe_token(token)
    if parsed is None:
        return _INVALID
    _, category = parsed
    label = _CATEGORY_LABELS.get(category, "these emails")
    body = (
        "<h1 style='font-size:20px;margin:0 0 10px;'>Unsubscribe?</h1>"
        f"<p style='color:#555;margin:0 0 20px;'>Stop receiving {label}?</p>"
        '<form method="post" action="/notifications/unsubscribe">'
        f'<input type="hidden" name="token" value="{token}">'
        '<button type="submit" style="background:#6f8b3e;color:#fff;border:0;'
        'font-weight:600;padding:11px 20px;border-radius:8px;cursor:pointer;">'
        "Yes, unsubscribe</button></form>"
    )
    return _page("Unsubscribe", body)


@router.post("/unsubscribe", response_class=HTMLResponse)
def unsubscribe_confirm(
    token: str = Form(...),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    parsed = verify_unsubscribe_token(token)
    if parsed is None:
        return _INVALID
    user_id, category = parsed
    unsubscribe(db, user_id=user_id, category=category)
    return _page(
        "Unsubscribed",
        "<h1 style='font-size:20px;margin:0 0 10px;'>You're unsubscribed</h1>"
        "<p style='color:#555;margin:0;'>You won't get these emails anymore. "
        "You can still manage all preferences from your account settings.</p>",
    )
