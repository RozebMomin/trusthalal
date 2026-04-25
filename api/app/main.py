import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.logging import setup_logging

import app.db.models  # noqa: F401

from app.modules.places.router import router as places_router
from app.modules.claims.router import router as claims_router
from app.modules.auth.router import router as auth_router
from app.modules.ownership_requests.router import router as ownership_requests_router

# Admin Routes
from app.modules.admin.router import router as admin_router
from app.modules.admin.places.router import router as admin_places_router
from app.modules.admin.claims.router import router as admin_claims_router
from app.modules.admin.ownership_requests.router import router as admin_ownership_requests_router
from app.modules.admin.users.router import router as admin_users_router
from app.modules.admin.organizations.router import router as admin_organizations_router

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError

from app.core.exceptions import AppError
from app.core.exception_handlers import (
    app_error_handler,
    http_exception_handler,
    validation_error_handler,
)

setup_logging()
logger = logging.getLogger(__name__)


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

cors_origins = _cors_origins()
if cors_origins:
    # ``allow_credentials=True`` is required for the session cookie to
    # round-trip across origins (admin panel on :3001 ↔ api on :8000).
    # The CORS spec forbids ``allow_origins=["*"]`` when credentials
    # are enabled, so the explicit origin list above is mandatory.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(places_router)
app.include_router(claims_router)
app.include_router(auth_router)
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
