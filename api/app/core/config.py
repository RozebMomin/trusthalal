from functools import lru_cache
from typing import List

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ------------------------------------------------------------------
    # Application
    # ------------------------------------------------------------------
    APP_NAME: str = "TrustHalal API"
    ENV: str = "local"  # local | staging | prod
    DEBUG: bool = False

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------
    LOG_LEVEL: str = "INFO"

    # ------------------------------------------------------------------
    # API
    # ------------------------------------------------------------------
    API_V1_PREFIX: str = ""

    # ------------------------------------------------------------------
    # CORS
    # ------------------------------------------------------------------
    CORS_ORIGINS: List[str] = []

    # ------------------------------------------------------------------
    # Database (future use)
    # ------------------------------------------------------------------
    DATABASE_URL: str | None = None

    # ------------------------------------------------------------------
    # Domain configuration
    # ------------------------------------------------------------------
    CLAIM_DEFAULT_EXPIRY_DAYS: int = 90
    CLAIM_TTL_DAYS: int = 90
    CLAIM_REFRESH_WINDOW_DAYS: int = 14

    # ------------------------------------------------------------------
    # Media Storage configuration
    # ------------------------------------------------------------------
    MEDIA_BUCKET_NAME: str | None = None
    MEDIA_BUCKET_PROVIDER: str = "gcs"  # or "s3"
    MEDIA_PUBLIC_BASE_URL: str | None = None

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------
    # Opt-in fallback: when enabled, ``get_current_user`` accepts an
    # ``X-User-Id`` header as an alternative to the session cookie.
    # DO NOT enable this in any real environment — anyone who can craft
    # an HTTP request can impersonate any user. It exists for the
    # integration test suite, which needs to simulate being different
    # roles without a full login dance per request. The test harness
    # (tests/conftest.py) sets this True before importing the app.
    DEV_HEADER_AUTH_ENABLED: bool = False

    # Origin of the admin panel, used to compose the set-password URL
    # returned alongside an invite. The API never serves the set-
    # password page itself — that's the admin panel's job — but the
    # invite response is much more useful when it carries a ready-to-
    # share URL than when it just carries the raw token.
    #
    # Default matches the local dev stack (Next.js on 3001). Override
    # in staging/prod env files.
    ADMIN_PANEL_ORIGIN: str = "http://localhost:3001"

    # How long an invite token is valid. 7 days is the common default
    # for admin-onboarding links — long enough that a new hire can
    # complete setup on their own schedule, short enough that an
    # abandoned invite doesn't sit around indefinitely. Overridable so
    # tests can exercise expiry without sleeping.
    INVITE_TOKEN_TTL_DAYS: int = 7

    # ------------------------------------------------------------------
    # External integrations
    # ------------------------------------------------------------------
    # Server-side Google Maps key used by the Place Details ingest. NEVER
    # expose this in the admin/web frontend — browser autocomplete uses a
    # separate, domain-restricted key.
    GOOGLE_MAPS_API_KEY: str | None = None
    # Allow swapping endpoint for tests / regional mirrors.
    GOOGLE_PLACES_DETAILS_URL: str = (
        "https://maps.googleapis.com/maps/api/place/details/json"
    )
    # Autocomplete endpoint for the owner-portal claim flow's "search
    # Google" fallback. Hit server-side via a thin proxy so the browser
    # key never needs to be exposed on the owner origin.
    GOOGLE_PLACES_AUTOCOMPLETE_URL: str = (
        "https://maps.googleapis.com/maps/api/place/autocomplete/json"
    )
    # Reverse Geocoding endpoint for the consumer "near me" pill —
    # given the user's lat/lng, derive the city label so the active
    # pill can read "Searching X mi around Snellville" rather than the
    # generic "around you". Hit server-side for the same key-hygiene
    # reasons as the autocomplete proxy.
    GOOGLE_GEOCODE_URL: str = (
        "https://maps.googleapis.com/maps/api/geocode/json"
    )

    # ------------------------------------------------------------------
    # Object storage (Supabase Storage for v1)
    # ------------------------------------------------------------------
    # Owner-uploaded evidence (utility bills, business filings, etc.)
    # lives in Supabase Storage. The service-role key bypasses RLS so
    # this server can write/read freely; the bucket itself stays
    # locked-down to the public anon key.
    #
    # SUPABASE_URL is the project URL (e.g. https://xyz.supabase.co).
    # The same URL is used by the JS client; we share it.
    SUPABASE_URL: str | None = None
    SUPABASE_SERVICE_ROLE_KEY: str | None = None
    SUPABASE_STORAGE_BUCKET: str = "evidence"

    # ------------------------------------------------------------------
    # Pydantic settings config
    # ------------------------------------------------------------------
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


@lru_cache
def get_settings() -> Settings:
    """
    Cached settings object.
    This ensures settings are loaded once per process.
    """
    return Settings()


# Canonical settings instance used across the app
settings = get_settings()