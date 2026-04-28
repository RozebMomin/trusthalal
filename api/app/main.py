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

from app.modules.places.router import router as places_router  # noqa: E402
from app.modules.claims.router import router as claims_router  # noqa: E402
from app.modules.auth.router import router as auth_router  # noqa: E402
from app.modules.organizations.router import router as organizations_router  # noqa: E402
from app.modules.ownership_requests.router import router as ownership_requests_router  # noqa: E402

# Admin Routes
from app.modules.admin.router import router as admin_router  # noqa: E402
from app.modules.admin.places.router import router as admin_places_router  # noqa: E402
from app.modules.admin.claims.router import router as admin_claims_router  # noqa: E402
from app.modules.admin.ownership_requests.router import router as admin_ownership_requests_router  # noqa: E402
from app.modules.admin.users.router import router as admin_users_router  # noqa: E402
from app.modules.admin.organizations.router import router as admin_organizations_router  # noqa: E402

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
        # portal. Keeping all three so local stack can run any
        # combination of frontends against the same API without env
        # tweaks.
        for origin in (
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            "http://localhost:3002",
            "http://127.0.0.1:3002",
        ):
            if origin not in origins:
                origins.append(origin)

    return origins


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

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
app.include_router(claims_router)
app.include_router(auth_router)
app.include_router(organizations_router)
app.include_router(ownership_requests_router)

app.include_router(admin_router)
app.include_router(admin_places_router)
app.include_router(admin_claims_router)
app.include_router(admin_ownership_requests_router)
app.include_router(admin_users_router)
app.include_router(admin_organizations_router)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)


@app.get("/")
def root():
    return {"service": settings.APP_NAME, "status": "running", "env": settings.ENV}


@app.get("/health")
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

    @app.get("/debug/sentry/message")
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

    @app.get("/debug/sentry/exception")
    def _debug_sentry_exception():
        # Raise something the FastAPI integration will see as a real
        # unhandled exception. The 500 IS the success signal here —
        # Sentry should also capture it.
        raise RuntimeError(
            "Trust Halal API: debug-sentry-exception (intentional)."
        )
