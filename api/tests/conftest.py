"""Pytest harness for trusthalal-api.

Design
------
- One Postgres test database (default: trusthalal_test), reused across the
  session. Alembic migrations run once per session, not per test.
- Each test gets a function-scoped SQLAlchemy Session bound to a long-lived
  connection wrapped in an outer transaction that is rolled back at teardown.
  The Session uses ``join_transaction_mode="create_savepoint"``, so any
  ``db.commit()`` inside app code releases a savepoint rather than committing
  the outer transaction. Net effect: repo code can call commit() normally, but
  nothing persists across tests.
- The FastAPI ``get_db`` dependency is overridden to hand back this same
  per-test session, so the HTTP layer and direct DB access in a test see the
  same uncommitted state.
- ``TestClient`` is wrapped with a thin ``APIClient`` that lets a test say
  ``api.as_user(user)`` instead of repeating the X-User-Id header.

Environment
-----------
- ``TEST_DATABASE_URL`` overrides the default connection string.
- PostGIS must be available (the ``postgis/postgis`` image used by
  docker-compose ships with it). The harness runs ``CREATE EXTENSION IF NOT
  EXISTS postgis`` before migrations so autopopulation isn't required.
- Tests force ``ENV=local`` so dev-only endpoints (e.g. /auth/dev-login) work.

Usage
-----
    poetry run pytest
    # or target a specific file
    poetry run pytest tests/test_claim_lifecycle.py -v
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

# The app reads DATABASE_URL + auth flags at import time via pydantic-
# settings, so we have to set everything before importing anything from
# app.*.
_DEFAULT_TEST_DATABASE_URL = (
    "postgresql+psycopg://trusthalal:trusthalal@localhost:5432/trusthalal_test"
)
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", _DEFAULT_TEST_DATABASE_URL)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("ENV", "local")

# The test suite's APIClient helper (see ``APIClient.as_user``) sets
# X-User-Id on every request so a single test can pretend to be admin,
# owner, verifier, etc. without a real login dance. That fallback in
# ``app.core.auth.get_current_user`` is gated on DEV_HEADER_AUTH_ENABLED
# — flip it on here so the header path works for tests only. Production
# + dev containers leave it off, so a malicious X-User-Id there gets the
# same 401 as any other unauthenticated request.
os.environ.setdefault("DEV_HEADER_AUTH_ENABLED", "true")

# Rate limits are decorated on real endpoints (auth/signup, /me/...,
# Google autocomplete proxy). Tests that hammer those would trip the
# per-minute caps and become flaky. Flip the limiter to pass-through
# mode here — a dedicated test in test_rate_limit.py re-enables it
# locally to pin the 429 envelope contract.
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

# Text moderation defaults to ON in the app, which is the right production
# posture — a config slip should fail loudly rather than quietly publish
# unscreened content. The test suite has no GCP key and shouldn't make network
# calls anyway, so it opts out explicitly here. Tests that care about
# moderation behaviour inject a fake through
# ``app.dependency_overrides[get_text_moderation_client]`` (see
# tests/test_reviews.py) rather than relying on this flag.
os.environ.setdefault("TEXT_MODERATION_ENABLED", "false")

import pytest
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

# After env vars are set, importing the app is safe.
from app.core.text_moderation import (
    ModerationResult,
    ModerationVerdict,
    TextModerationError,
    get_text_moderation_client,
)
from app.db import deps as db_deps
from app.main import app as fastapi_app

from tests.factories import Factories


_REPO_ROOT = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------
# Session-scoped engine + migrations
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def test_engine() -> Iterator[Engine]:
    """Create the engine, ensure PostGIS + schema, and upgrade to head.

    Migrations run exactly once per pytest session. Tables are not dropped
    between sessions — the transactional rollback keeps data isolated, and
    rebuilding a fresh schema each run makes no meaningful difference for the
    speed of this suite.
    """
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True, future=True)

    # PostGIS + schema must exist before Alembic runs (the first migration
    # assumes the extension is available for the Geometry column).
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS postgis")
        conn.exec_driver_sql("CREATE SCHEMA IF NOT EXISTS app")

    cfg = AlembicConfig(str(_REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    # Make alembic's env.py find app modules.
    cfg.set_main_option("script_location", str(_REPO_ROOT / "alembic"))
    alembic_command.upgrade(cfg, "head")

    # Clean slate: TRUNCATE all data tables. Every test wraps its work in a
    # rolled-back transaction, so nothing should leak between tests — but if
    # a previous run crashed mid-transaction, stale rows could still be
    # visible. TRUNCATE at session start is cheap and eliminates that class
    # of flakiness.
    with engine.begin() as conn:
        tables = conn.exec_driver_sql(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'app'"
        ).fetchall()
        if tables:
            names = ", ".join(f'"app"."{row[0]}"' for row in tables)
            conn.exec_driver_sql(
                f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE"
            )

    yield engine
    engine.dispose()


# ---------------------------------------------------------------------------
# Per-test transactional session
# ---------------------------------------------------------------------------
@pytest.fixture
def db_session(test_engine: Engine) -> Iterator[Session]:
    """Function-scoped Session that rolls back everything at teardown.

    Pattern: open a raw connection, begin an outer transaction, then bind a
    Session with ``join_transaction_mode="create_savepoint"``. The first
    operation on the session opens a SAVEPOINT inside the outer transaction.
    Any commit() inside app code releases that savepoint; SQLAlchemy creates
    a new one on the next operation. The outer transaction is rolled back in
    the teardown, so no test leaves rows behind.
    """
    connection = test_engine.connect()
    outer_tx = connection.begin()

    TestingSession = sessionmaker(
        bind=connection,
        autoflush=False,
        autocommit=False,
        future=True,
        # App repos call db.commit() liberally. With savepoint mode, those
        # commits only release the savepoint — the outer transaction is
        # rolled back in teardown so nothing leaks.
        join_transaction_mode="create_savepoint",
        # Keep factory-created objects usable across HTTP calls that commit().
        expire_on_commit=False,
    )
    session = TestingSession()

    try:
        yield session
    finally:
        session.close()
        if outer_tx.is_active:
            outer_tx.rollback()
        connection.close()


# ---------------------------------------------------------------------------
# FastAPI TestClient with auth helper
# ---------------------------------------------------------------------------
class APIClient:
    """TestClient wrapper that carries an X-User-Id header if set.

    ``api.as_user(user_or_id)`` returns a new client instance with the header
    attached — the original ``api`` keeps acting as an anonymous caller. This
    lets a single test exercise anonymous, owner, admin, etc. paths without
    fighting with ``headers=`` kwargs.
    """

    def __init__(self, client: TestClient, user_id: str | None = None):
        self._client = client
        self._user_id = user_id

    def as_user(self, user_or_id) -> "APIClient":
        uid = getattr(user_or_id, "id", user_or_id)
        return APIClient(self._client, str(uid))

    def as_anonymous(self) -> "APIClient":
        return APIClient(self._client, None)

    def _with_auth(self, headers: dict | None) -> dict:
        merged = dict(headers or {})
        if self._user_id:
            merged.setdefault("X-User-Id", self._user_id)
        return merged

    def get(self, url, **kw):
        kw["headers"] = self._with_auth(kw.get("headers"))
        return self._client.get(url, **kw)

    def post(self, url, **kw):
        kw["headers"] = self._with_auth(kw.get("headers"))
        return self._client.post(url, **kw)

    def patch(self, url, **kw):
        kw["headers"] = self._with_auth(kw.get("headers"))
        return self._client.patch(url, **kw)

    def delete(self, url, **kw):
        kw["headers"] = self._with_auth(kw.get("headers"))
        # httpx.Client.delete() follows the classic "DELETE has no body"
        # convention and doesn't accept ``json=`` / ``content=`` / ``data=``.
        # Our admin DELETE routes (e.g. /admin/places/{id}) optionally
        # take a JSON body (delete reason), so when a body kwarg is
        # supplied we route through the generic ``request()`` method
        # which does support it. Callers keep the natural
        # ``api.delete(url, json={...})`` shape either way.
        if any(k in kw for k in ("json", "content", "data")):
            return self._client.request("DELETE", url, **kw)
        return self._client.delete(url, **kw)

    def put(self, url, **kw):
        kw["headers"] = self._with_auth(kw.get("headers"))
        return self._client.put(url, **kw)


@pytest.fixture
def api(db_session: Session) -> Iterator[APIClient]:
    """TestClient wired to the transactional test session."""

    def _override_get_db():
        try:
            yield db_session
        finally:
            # Don't close here — the db_session fixture owns lifecycle.
            pass

    fastapi_app.dependency_overrides[db_deps.get_db] = _override_get_db
    try:
        with TestClient(fastapi_app) as raw:
            yield APIClient(raw)
    finally:
        fastapi_app.dependency_overrides.pop(db_deps.get_db, None)


# ---------------------------------------------------------------------------
# Factories
# ---------------------------------------------------------------------------
@pytest.fixture
def factories(db_session: Session) -> Factories:
    """Domain factory helpers bound to the per-test session."""
    return Factories(db_session)


# ---------------------------------------------------------------------------
# Text moderation
# ---------------------------------------------------------------------------
# Lives here rather than in test_reviews.py because moderation now gates more
# than reviews: any test that posts a review as setup needs it, including the
# account-deletion and blocking suites. A module-local fixture is invisible to
# other files, which surfaces as a confusing collection-time ERROR rather than
# a missing-fixture message at the call site.

class _FakeModerator:
    """Scriptable stand-in for Cloud Natural Language.

    ``verdict`` drives the answer; setting ``raise_error`` simulates the
    outage path, which is the one branch that behaves differently from a
    rejection and is easy to get backwards.
    """

    def __init__(self, verdict=ModerationVerdict.ALLOW, category=None):
        self.verdict = verdict
        self.category = category
        self.raise_error = False
        self.calls: list[str] = []

    def evaluate(self, text: str) -> ModerationResult:
        self.calls.append(text)
        if self.raise_error:
            raise TextModerationError("simulated outage")
        return ModerationResult(
            verdict=self.verdict, category=self.category, confidence=0.9
        )


@pytest.fixture
def moderator():
    """Injects the fake for the duration of one test.

    Cleaned up in the teardown so a test that flips ``verdict`` to BLOCK
    can't leak that into the next one through the app-level override dict.
    """
    fake = _FakeModerator()
    fastapi_app.dependency_overrides[get_text_moderation_client] = lambda: fake
    yield fake
    fastapi_app.dependency_overrides.pop(get_text_moderation_client, None)


# ---------------------------------------------------------------------------
# Approved halal profile with per-product sourcing
# ---------------------------------------------------------------------------
# Lives here rather than in test_meat_products.py because the same shape is
# useful anywhere a test needs a real profile — and a module-local fixture is
# invisible to other files, which surfaces as a confusing collection-time
# ERROR rather than a missing-fixture message at the call site. That mistake
# already cost a debugging session once in this suite (see the moderator
# fixture above).
@pytest.fixture
def approved_claim_profile(api, factories, db_session):
    """Build a place whose halal profile was derived from a real approved
    claim carrying the given ``meat_products``.

    Goes through the actual HTTP create → submit → approve flow rather than
    inserting a HalalProfile directly. That matters for these tests
    specifically: the per-meat rollup columns are computed by the approval
    service, so hand-writing them would let a test assert that products and
    rollup agree while proving nothing about the code that derives one from
    the other.

    Returns ``(profile, claim)``.
    """
    from sqlalchemy import select as _select

    from app.modules.halal_claims.models import HalalClaim
    from app.modules.halal_profiles.models import HalalProfile

    def _build(meat_products: list[dict], *, validation_tier="CERTIFICATE_ON_FILE"):
        admin = factories.admin()
        owner = factories.owner()
        place = factories.place()
        org = factories.org_for_user(user=owner)
        factories.place_owner_link(place=place, organization=org)
        db_session.commit()

        questionnaire = {
            "questionnaire_version": 1,
            "menu_posture": "FULLY_HALAL",
            "has_pork": False,
            "alcohol_policy": "NONE",
            "alcohol_in_cooking": False,
            "meat_products": meat_products,
            "seafood_only": False,
            "caveats": None,
        }

        created = api.as_user(owner).post(
            "/me/halal-claims",
            json={
                "place_id": str(place.id),
                "organization_id": str(org.id),
                "structured_response": questionnaire,
            },
        )
        assert created.status_code == 201, created.text
        claim_id = created.json()["id"]

        submitted = api.as_user(owner).post(f"/me/halal-claims/{claim_id}/submit")
        assert submitted.status_code == 200, submitted.text

        approved = api.as_user(admin).post(
            f"/admin/halal-claims/{claim_id}/approve",
            json={"validation_tier": validation_tier},
        )
        assert approved.status_code == 200, approved.text

        profile = db_session.execute(
            _select(HalalProfile).where(HalalProfile.place_id == place.id)
        ).scalar_one()
        claim = db_session.get(HalalClaim, claim_id)
        return profile, claim

    return _build
