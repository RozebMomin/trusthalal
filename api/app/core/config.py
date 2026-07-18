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

    # Origins for the other password-facing frontends, used to compose
    # password-reset links per audience. Like ADMIN_PANEL_ORIGIN, the API
    # never serves these pages — it just builds the URL the reset email
    # points at. Defaults match the local dev stack (owner :3002,
    # consumer :3003). Override in staging/prod (owner.trusthalal.org,
    # halalfoodnearme.com). The mobile app reuses the consumer page.
    OWNER_PORTAL_ORIGIN: str = "http://localhost:3002"
    CONSUMER_ORIGIN: str = "http://localhost:3003"

    # Password-reset token lifetime. Deliberately short (unlike the 7-day
    # invite): a reset link is a bearer credential to an existing account,
    # so it should not sit valid for long.
    PASSWORD_RESET_TTL_MINUTES: int = 60

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------
    # Public base URL of THIS API — used to build one-click unsubscribe
    # links in outbound emails (they hit an API endpoint, not a frontend).
    # Override in prod (e.g. https://api.trusthalal.org).
    API_PUBLIC_BASE_URL: str = "http://localhost:8000"

    # HMAC secret for signing stateless unsubscribe tokens. Low-stakes
    # (worst case: someone unsubscribes someone else from optional emails),
    # but still override with a real random value in prod.
    NOTIFICATION_UNSUBSCRIBE_SECRET: str = "dev-insecure-change-me"

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
    # Legacy Place Details endpoint — kept for any env still on
    # `GOOGLE_PLACES_USE_NEW=false`. The new endpoint below is the
    # default going forward; legacy stays addressable for rollback.
    GOOGLE_PLACES_DETAILS_URL: str = (
        "https://maps.googleapis.com/maps/api/place/details/json"
    )
    # Places API New — per-place URL is templated with the place ID:
    # ``{base}/{place_id}``. Field mask is sent via X-Goog-FieldMask
    # header by the fetcher. See:
    # https://developers.google.com/maps/documentation/places/web-service/place-details
    GOOGLE_PLACES_DETAILS_NEW_URL: str = "https://places.googleapis.com/v1/places"
    # Toggle while we burn in the New API in production. Defaults to
    # the new endpoint; flip to false in env to fall back to legacy
    # without a redeploy if the new path misbehaves.
    GOOGLE_PLACES_USE_NEW: bool = True
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

    # Server-side product analytics (PostHog). The project API key is the
    # SAME public key the web/mobile clients use — sharing it keeps all
    # events in one project so a user's server + client activity unify.
    # Unset ⇒ server-side analytics no-op (local dev / preview).
    POSTHOG_API_KEY: str | None = None
    POSTHOG_HOST: str = "https://us.i.posthog.com"

    # Public-readable bucket for owner + consumer uploaded place
    # photos. Configured public in the Supabase dashboard so the
    # consumer site can render images via the bucket's public URL
    # without signing every request — search-result thumbnails would
    # defeat any CDN cache otherwise. The service-role key still
    # gates writes; only this server can put bytes in.
    SUPABASE_PHOTOS_BUCKET: str = "place-photos"

    # Public-readable bucket for halal certificate documents that are
    # surfaced on the consumer place-detail page. Same posture as the
    # place-photos bucket (public read, service-role write); separate
    # bucket so the access policy and content moderation story stay
    # bucket-scoped rather than path-scoped. Profile derivation copies
    # the latest HALAL_CERTIFICATE attachment here on approval.
    SUPABASE_CERTS_BUCKET: str = "halal-certificates"

    # ------------------------------------------------------------------
    # Mapbox — alternative geocoder
    # ------------------------------------------------------------------
    # Mapbox's free tier is 100k geocoding requests/month vs Google's
    # ~40k under the $200/month credit. When this token is present,
    # the forward / reverse geocode routes prefer Mapbox; Google is
    # used only as a fallback when Mapbox isn't configured. Google
    # Places (autocomplete, ingest details) keep using their own key
    # — different products, different free tiers, no reason to
    # migrate both at once.
    #
    # Get a token: https://account.mapbox.com/access-tokens
    # Server-side usage doesn't need URL restrictions; the token
    # only ever sees daylight on the API server.
    MAPBOX_ACCESS_TOKEN: str | None = None
    MAPBOX_GEOCODE_BASE_URL: str = (
        "https://api.mapbox.com/search/geocode/v6"
    )

    # ------------------------------------------------------------------
    # Email — Resend
    # ------------------------------------------------------------------
    # Transactional email goes through Resend; ``trusthalal.org`` is
    # the verified sender domain (chosen over halalfoodnearme.com so
    # both audiences see the same trust-platform sender). Leave the
    # API key blank in environments where you don't want emails to
    # actually go out — the ``send_email`` helper silently no-ops
    # rather than throwing, so feature work + tests stay green
    # without a live Resend account.
    #
    # Get a key at https://resend.com/api-keys (scope to "Sending
    # access" only; the full-access key shouldn't sit on a server
    # process).
    RESEND_API_KEY: str | None = None
    # The ``From:`` header on every outbound transactional email.
    # Pre-formatted as ``"Display Name <addr>"`` so the recipient's
    # client renders a friendly sender name instead of just the
    # mailbox. Override per-message via the ``from_email`` kwarg on
    # ``send_email`` for one-off cases (e.g., admin-facing alerts).
    RESEND_FROM_EMAIL: str = "Trust Halal <noreply@trusthalal.org>"
    # Optional ``Reply-To:`` so recipients hitting reply land in a
    # monitored mailbox instead of the no-reply void. Leave unset to
    # omit the header entirely.
    RESEND_REPLY_TO: str | None = None

    # ------------------------------------------------------------------
    # Push — Expo
    # ------------------------------------------------------------------
    # Mobile push goes through Expo's push service (the app ships via EAS,
    # so Expo already holds the APNs key + FCM credentials). No key is
    # required to send, but Expo lets you require one per project under
    # "enhanced security" — set it here when you turn that on so a leaked
    # device token can't be used to push to your users.
    #
    # Create at https://expo.dev/accounts/<account>/settings/access-tokens
    EXPO_ACCESS_TOKEN: str | None = None

    # ------------------------------------------------------------------
    # Pydantic settings config
    # ------------------------------------------------------------------
    # ``extra="ignore"`` is a deliberate defensive default: env vars
    # that don't bind to a declared field get silently dropped instead
    # of failing the whole boot. The alternative (Pydantic v2's strict
    # default of ``extra="forbid"``) makes the API crash at startup
    # whenever a feature-branch env var lands ahead of the code change
    # that consumes it — e.g., setting ``MAPBOX_ACCESS_TOKEN`` on Render
    # before the Mapbox PR is merged would otherwise 500 every request
    # until the var is removed. We'd rather have the var quietly ignored
    # until the field exists; the merged code picks it up automatically.
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
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