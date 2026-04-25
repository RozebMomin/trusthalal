"""Unified error response shape.

All error responses emitted by this API follow the shape:

    {
      "error": {
        "code": "DOMAIN_CODE",
        "message": "Human-readable summary",
        "detail": <optional structured payload>
      }
    }

Rationale
---------
Clients (the admin panel + any future consumer) want a stable, nested
envelope so they can parse the error once and branch on ``error.code``.
A flat ``{"detail", "code"}`` shape conflates the human message with the
FastAPI convention for validation detail arrays, which makes generic
client-side parsing fragile.

Three handlers are registered:

* ``app_error_handler`` covers domain errors (``AppError`` and subclasses
  in ``app.core.exceptions``). These carry a caller-actionable ``code``.

* ``http_exception_handler`` covers FastAPI's ``HTTPException`` (raised
  by dependencies like ``require_roles`` and path/body parsers). FastAPI's
  native shape is ``{"detail": "..."}``; we wrap it so auth rejections
  look the same as domain errors to the client. A status→code lookup
  assigns semantic codes (``UNAUTHORIZED``, ``FORBIDDEN``, ...) so
  clients can still branch on ``error.code`` when they want to.

* ``validation_error_handler`` covers ``RequestValidationError``. These
  don't have a domain code, so we synthesize ``VALIDATION_ERROR`` and
  surface the per-field error list as ``error.detail`` for clients that
  want to render field-level feedback.

The ``ErrorResponse`` + ``ErrorDetail`` Pydantic models below are the
canonical contract — routes reference ``ErrorResponse`` in their
``responses=`` declarations so OpenAPI (and downstream codegen in the
admin repo) captures this envelope alongside every endpoint's success
schema.
"""
from typing import Any

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.core.exceptions import AppError


class ErrorDetail(BaseModel):
    """The inner object of an error response."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(
        ...,
        description=(
            "Stable machine-readable error code. Domain errors use a"
            " SCREAMING_SNAKE_CASE identifier (e.g. GOOGLE_PLACE_NOT_FOUND);"
            " generic HTTP failures use one of UNAUTHORIZED, FORBIDDEN,"
            " NOT_FOUND, CONFLICT, VALIDATION_ERROR, or HTTP_ERROR."
        ),
    )
    message: str = Field(
        ...,
        description="Human-readable summary, safe to surface in toasts.",
    )
    detail: Any | None = Field(
        default=None,
        description=(
            "Optional structured payload. For VALIDATION_ERROR this is"
            " Pydantic's per-field errors list; for domain errors it's"
            " whatever AppError.extra was set to (usually absent)."
        ),
    )


class ErrorResponse(BaseModel):
    """Standard envelope for all 4xx / 5xx responses."""

    model_config = ConfigDict(extra="forbid")

    error: ErrorDetail


# ---------------------------------------------------------------------------
# Status → semantic code mapping (for HTTPException, which has no code)
# ---------------------------------------------------------------------------

_STATUS_TO_CODE: dict[int, str] = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    415: "UNSUPPORTED_MEDIA_TYPE",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    502: "BAD_GATEWAY",
    503: "SERVICE_UNAVAILABLE",
    504: "GATEWAY_TIMEOUT",
}


def _envelope(code: str, message: str, detail: Any | None = None) -> dict:
    """Build the standard error envelope, omitting ``detail`` when absent."""
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if detail is not None:
        body["error"]["detail"] = detail
    return body


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content=_envelope(exc.code, exc.detail, exc.extra),
    )


async def http_exception_handler(request: Request, exc: HTTPException):
    """Normalize FastAPI's ``{"detail": "..."}`` shape into our envelope.

    ``HTTPException.detail`` can be a string (typical) or an arbitrary
    JSON-serializable value (when a caller passes ``detail=[...]``).
    We always render the human message from the string form; anything
    structured rides along as ``error.detail``.
    """
    default_code = _STATUS_TO_CODE.get(exc.status_code, "HTTP_ERROR")
    detail = exc.detail

    if isinstance(detail, str):
        message = detail
        extra_detail = None
    elif detail is None:
        message = default_code.replace("_", " ").title()
        extra_detail = None
    else:
        # Structured detail: keep the payload, synthesize a generic summary.
        message = default_code.replace("_", " ").title()
        extra_detail = detail

    return JSONResponse(
        status_code=exc.status_code,
        content=_envelope(default_code, message, extra_detail),
        headers=getattr(exc, "headers", None),
    )


async def validation_error_handler(request: Request, exc: RequestValidationError):
    # Pydantic's errors() list is JSON-safe and useful to clients that want
    # to highlight the offending field. We pass it through unchanged.
    return JSONResponse(
        status_code=422,
        content=_envelope(
            "VALIDATION_ERROR",
            "Request validation failed",
            exc.errors(),
        ),
    )
