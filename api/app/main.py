import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.core.logging import setup_logging
from app.core.observability import RequestIDMiddleware, init_sentry
from app.core.rate_limit import limiter, rate_limit_exceeded_handler

# Configure logging FIRST so any messages emitted during Sentry init
# (and the routers' import-time work that follows) actually land in
# stdout/stderr at the configured level rather than getting suppressed
# by Python's default WARNING-level root logger.
setup_logging()
logger = logging.getLogger(__name__)

# Sentry init runs before the routers import so that any exception
# raised during their import is captured. ``init_sentry()`` always
# emits a status line on stderr (DSN missing / import failed / live)
# so the Render log tab is the source of truth for "is Sentry on?".
# No-op when SENTRY_DSN isn't set, so local dev / tests don't ship
# events to nowhere.
_sentry_active = init_sentry()
if _sentry_active:
    logger.info("Sentry observability is active for this process.")
else:
    logger.info(
        "Sentry observability is NOT active — see [observability] line above "
        "for the reason."
    )

import app.db.models  # noqa: F401  E402

from app.modules.places.router import (  # noqa: E402
    me_places_router as me_places_router,
    router as places_router,
)
from app.modules.auth.router import router as auth_router  # noqa: E402
from app.modules.organizations.router import router as organizations_router  # noqa: E402
from app.modules.ownership_requests.router import router as ownership_requests_router  # noqa: E402

# Halal v2 — Phase 2 lights up the owner submission surface at
# /me/halal-claims; Phase 3 adds /admin/halal-claims for review +
# the profile-derivation service.
from app.modules.halal_claims.router import router as halal_claims_router  # noqa: E402

# Admin Routes
from app.modules.admin.router import router as admin_router  # noqa: E402
from app.modules.admin.places.router import router as admin_places_router  # noqa: E402
from app.modules.admin.ownership_requests.router import router as admin_ownership_requests_router  # noqa: E402
from app.modules.admin.users.router import router as admin_users_router  # noqa: E402
from app.modules.admin.organizations.router import router as admin_organizations_router  # noqa: E402
from app.modules.admin.halal_claims.router import router as admin_halal_claims_router  # noqa: E402

from fastapi import HTTPException  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402

from app.core.exceptions import AppError  # noqa: E402
from app.core.exception_handlers import (  # noqa: E402
    app_error_handler,
    http_exception_handler,
    validation_error_handler,
)

# (logging + Sentry init already ran at the top of this module.)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown hooks for the app.

    Runs once before the server starts accepting requests, then once on
    graceful shutdown. Replaces the deprecated @app.on_event decorators.
    """
    logger.info("Starting %s (ENV=%s)", settings.APP_NAME, settings.ENV)
    try:
        yield
    finally:
        logger.info("Shutting down %s", settings.APP_NAME)


def _cors_origins() -> list[str]:
    origins = list(settings.CORS_ORIGINS)

    if settings.ENV == "local":
        # 3000 = next dev default; 3001 = admin panel; 3002 = owner
        # portal; 3003 = consumer site. Keeping all four so local
        # stack can run any combination of frontends against the
        # same API without env tweaks.
        for origin in (
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            "http://localhost:3002",
            "http://127.0.0.1:3002",
            "http://localhost:3003",
            "http://127.0.0.1:3003",
        ):
            if origin not in origins:
                origins.append(origin)

    return origins


# ---------------------------------------------------------------------------
# OpenAPI metadata
# ---------------------------------------------------------------------------
# Surfaces at /docs (Swagger UI) and /redoc (ReDoc). The description is
# rendered as Markdown, so reach for it whenever the browseable docs
# would benefit from explanation a per-endpoint summary can't carry.
_API_DESCRIPTION = """\
The backend service for the **Trust Halal** halal-restaurant verification
platform.

## Surfaces

This API serves three frontends from a single origin:

* **Owner portal** (`owner.trusthalal.org`) — restaurant owners sign
  up, create an organization, claim places, file halal-trust
  questionnaires, and upload supporting evidence. Endpoints under
  `/auth/*`, `/me/*`, and the public `/places/*` read paths.
* **Admin panel** (`admin.trusthalal.org`) — Trust Halal staff
  verify orgs, decide ownership requests, and review halal claims.
  Endpoints under `/admin/*`.
* **Consumer site** (planned) — public directory of verified halal
  restaurants. Reads `/places/*` plus the embedded halal profile.

## Authentication

Single-cookie session auth. `POST /auth/login` (or `/auth/signup`)
sets an HttpOnly `tht_session` cookie scoped to the API origin; every
subsequent request carries it via `credentials: "include"` from the
browser. There's no public bearer token API today — every endpoint
that requires auth reads the session cookie.

## Error envelope

Every 4xx / 5xx response uses the same shape:

```json
{
  "error": {
    "code": "DOMAIN_CODE",
    "message": "Human-readable summary",
    "detail": <optional structured payload>
  }
}
```

`error.code` is stable and machine-parseable — frontends branch on
that rather than parsing the message text. Generic HTTP errors (401,
403, 404, etc.) get a synthesized code like `UNAUTHORIZED`,
`FORBIDDEN`, `NOT_FOUND`. Domain errors carry a SCREAMING_SNAKE_CASE
code from the route (e.g. `EMAIL_TAKEN`, `OWNERSHIP_REQUEST_NOT_FOUND`).

## Rate limits

Public + sensitive endpoints are rate-limited. Limits return 429 with
the same envelope and `code: RATE_LIMITED`. See
`docs/observability-and-rate-limits.md` for the current limits table.

## Request correlation

Every response includes an `X-Request-ID` header. The same id rides
into Sentry as a tag so a single request can be traced across browser
and server in the issues UI.

## Versioning

This API doesn't have a versioned URL prefix yet (e.g. `/v1/`).
Breaking changes are coordinated with the frontends in the same
deploy. Watch the version stamp in the OpenAPI metadata for cuts.
"""

# Tag descriptions render as section headings in /docs and /redoc, so
# group endpoints by audience rather than by HTTP path. Names match
# the ``tags=`` declarations on each router. The ``admin: *`` family
# is the staff-only surface; everything else is owner-portal or
# consumer-facing.
_OPENAPI_TAGS: list[dict] = [
    {
        "name": "auth",
        "description": (
            "Authentication and session management. Signup, login, logout, "
            "invite-token-based set-password, plus the `/me` self-lookup "
            "every frontend uses to render 'signed in as ...'. All of these "
            "share the same `tht_session` cookie posture."
        ),
    },
    {
        "name": "places",
        "description": (
            "Public places catalog. Text search, geo search, individual "
            "place detail with embedded halal profile, plus the "
            "server-side Google Places autocomplete proxy that powers "
            "the owner portal's 'can't find your restaurant?' fallback."
        ),
    },
    {
        "name": "ownership-requests",
        "description": (
            "Restaurant ownership claim submissions. The public path "
            "(`POST /places/{id}/ownership-requests`) accepts anonymous "
            "claims; the authenticated owner-portal path (`/me/ownership-"
            "requests`) ties claims to a sponsoring organization, supports "
            "evidence-file uploads, and enforces the duplicate-claim guard."
        ),
    },
    {
        "name": "organizations",
        "description": (
            "Owner-managed organizations — the legal entity behind a claim. "
            "Self-service create, edit, upload formation/renewal documents, "
            "and submit for admin review. Admin staff review on the "
            "/admin/organizations side."
        ),
    },
    {
        "name": "halal-claims",
        "description": (
            "Owner-portal halal-claim workflow. Owners submit a "
            "structured questionnaire (menu posture, alcohol policy, "
            "per-meat slaughter, certification context) for places "
            "they own. Status flow: DRAFT → PENDING_REVIEW → "
            "APPROVED/REJECTED/NEEDS_MORE_INFO. On approval the claim "
            "drives the place's public `HalalProfile`. Admin review "
            "lives under `admin: halal-claims`."
        ),
    },
    {
        "name": "admin: halal-claims",
        "description": (
            "Staff review surface for owner-submitted halal claims. "
            "Approve (assigns a validation tier), reject, request more "
            "info, or revoke a previously approved claim. Approval runs "
            "the profile-derivation service that creates / updates the "
            "place's `HalalProfile` in the same transaction."
        ),
    },
    {
        "name": "admin: places",
        "description": (
            "Catalog management. Ingest from Google Place ID, manual "
            "edits, soft-delete + restore, retroactively link a manual "
            "place to Google, and audit-event timeline reads. Admin "
            "sees soft-deleted rows that the public catalog hides."
        ),
    },
    {
        "name": "admin: organizations",
        "description": (
            "Org review queue. Verify or reject owner-submitted orgs, "
            "manage members, and download supporting documents. Halal "
            "claims and ownership requests are gated on the org being "
            "VERIFIED, so this queue is the unblocker for both."
        ),
    },
    {
        "name": "admin: ownership-requests",
        "description": (
            "Decision surface for ownership claims (place-of-business "
            "verification). Approve grants the org an active "
            "`PlaceOwner` link; reject closes the request with a "
            "reason; request-evidence asks the requester for more "
            "documentation without closing the case."
        ),
    },
    {
        "name": "admin: users",
        "description": (
            "Staff user management. Invite a teammate by email "
            "(generates a one-time set-password token), edit role, "
            "deactivate. Self-demotion + self-deactivation are blocked "
            "server-side."
        ),
    },
    {
        "name": "health",
        "description": (
            "Liveness + service-identity pings. Render's deploy gate uses "
            "`/health`; the unauthenticated `/` is a 'is this the right "
            "service?' sanity probe that includes the env name."
        ),
    },
    {
        "name": "debug",
        "description": (
            "Diagnostics behind feature flags. Currently only the "
            "Sentry verification endpoints, gated by `SENTRY_DEBUG_ENABLED`. "
            "Not part of the contract — anything tagged `debug` may "
            "disappear without notice."
        ),
    },
]

app = FastAPI(
    title=settings.APP_NAME,
    summary="Backend for the Trust Halal halal-restaurant verification platform.",
    description=_API_DESCRIPTION,
    version="0.1.0",
    contact={
        "name": "Trust Halal",
        "email": "support@trusthalal.org",
    },
    license_info={
        "name": "Apache 2.0",
        "url": "https://www.apache.org/licenses/LICENSE-2.0.html",
    },
    openapi_tags=_OPENAPI_TAGS,
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Observability + rate limiting wiring
# ---------------------------------------------------------------------------
# Order matters: middlewares run in REVERSE registration order (the
# last one added runs first). We want the request-ID middleware to
# run early so every other layer (CORS, rate limit, Sentry capture)
# sees the id we minted. Adding it last makes it the outermost
# middleware on the inbound request.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

cors_origins = _cors_origins()
if cors_origins:
    # ``allow_credentials=True`` is required for the session cookie to
    # round-trip across origins (admin panel on :3001 ↔ api on :8000).
    # The CORS spec forbids ``allow_origins=["*"]`` when credentials
    # are enabled, so the explicit origin list above is mandatory.
    #
    # ``X-Request-ID`` is exposed so the frontend can read it off
    # responses and surface it on its own Sentry breadcrumbs — that's
    # how a single request stays correlated across browser + server
    # in the issues UI.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

app.add_middleware(RequestIDMiddleware)

app.include_router(places_router)
app.include_router(me_places_router)
app.include_router(auth_router)
app.include_router(organizations_router)
app.include_router(ownership_requests_router)
app.include_router(halal_claims_router)

app.include_router(admin_router)
app.include_router(admin_places_router)
app.include_router(admin_ownership_requests_router)
app.include_router(admin_users_router)
app.include_router(admin_organizations_router)
app.include_router(admin_halal_claims_router)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)


@app.get(
    "/",
    summary="Service banner",
    description=(
        "Lightweight identity ping. Returns the service name, current "
        "env (local / staging / prod), and a static 'running' status. "
        "Useful for sanity-checking that DNS and the load balancer "
        "are pointing at the right deploy."
    ),
    tags=["health"],
)
def root():
    return {"service": settings.APP_NAME, "status": "running", "env": settings.ENV}


@app.get(
    "/health",
    summary="Liveness probe",
    description=(
        "Bare-minimum health check used by Render's deploy gate. Always "
        "returns 200 with `{\"status\": \"ok\"}` when the FastAPI worker "
        "can serve requests. It deliberately doesn't check the database "
        "— a failed DB connection should not pull the service out of "
        "rotation; routes that need the DB will surface their own "
        "errors and let Sentry capture them."
    ),
    tags=["health"],
)
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Sentry diagnostic routes
# ---------------------------------------------------------------------------
# These exist to verify the Sentry pipeline end-to-end in production.
# Sentry's FastAPI integration only captures UNHANDLED exceptions; our
# domain errors all flow through registered exception handlers and are
# considered "handled," so they never reach Sentry. That makes it hard
# to tell from outside whether Sentry is wired up correctly until a
# real bug actually 500s.
#
# Two endpoints, both gated behind ``SENTRY_DEBUG_ENABLED=true`` env
# var so they can't be hit accidentally in normal prod:
#
#   * GET /debug/sentry/message  → emits an INFO event via
#     sentry_sdk.capture_message(). Tests "is the SDK installed +
#     can it reach the Sentry ingest URL?"
#
#   * GET /debug/sentry/exception → raises an unhandled RuntimeError.
#     Tests "does the FastAPI integration capture exceptions on the
#     normal request path?"
#
# Once you've confirmed both arrive in the Sentry UI, flip the env
# var off (or leave it on — they're rate-limited and harmless).
import os as _os  # noqa: E402

if _os.getenv("SENTRY_DEBUG_ENABLED", "").strip().lower() == "true":
    from fastapi import HTTPException as _HTTPException  # noqa: E402

    @app.get(
        "/debug/sentry/message",
        summary="Send a manual Sentry capture_message ping",
        description=(
            "Calls `sentry_sdk.capture_message()` with a known string and "
            "returns the event_id so the Sentry ingest path can be "
            "verified end-to-end without engineering a real exception. "
            "Available only when `SENTRY_DEBUG_ENABLED=true`."
        ),
        tags=["debug"],
    )
    def _debug_sentry_message():
        try:
            import sentry_sdk

            event_id = sentry_sdk.capture_message(
                "Trust Halal API: debug capture_message ping",
                level="info",
            )
            return {
                "status": "captured",
                "event_id": event_id,
                "hint": (
                    "Search Sentry Issues for this message. If event_id "
                    "is null or 'captured' but nothing arrives in ~60s, "
                    "the ingest URL is unreachable from this server."
                ),
            }
        except ImportError:
            raise _HTTPException(
                status_code=500,
                detail="sentry-sdk is not installed in this deploy.",
            )

    @app.get(
        "/debug/sentry/exception",
        summary="Raise an unhandled exception (verifies Sentry's request middleware)",
        description=(
            "Raises a `RuntimeError` from inside a normal route handler. "
            "Returns a 500 — that IS the success signal here, since the "
            "point is to confirm Sentry's FastAPI integration captures "
            "unhandled exceptions on the request path. Available only "
            "when `SENTRY_DEBUG_ENABLED=true`."
        ),
        tags=["debug"],
    )
    def _debug_sentry_exception():
        # Raise something the FastAPI integration will see as a real
        # unhandled exception. The 500 IS the success signal here —
        # Sentry should also capture it.
        raise RuntimeError(
            "Trust Halal API: debug-sentry-exception (intentional)."
        )
