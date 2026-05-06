"""Flush every row in ``app.*`` and re-seed a single admin user.

Usage:
    python -m scripts.reset_db                  # blocks unless ENV=local
    python -m scripts.reset_db --force          # skip the env guard
    python -m scripts.reset_db --email foo@example.com --password hunter22

What it does, in one transaction per phase:

  1. Discovers every table in the ``app`` schema via
     ``information_schema``. We don't hardcode the list because it
     drifts every time a phase lands a new table; reading it back
     keeps the reset a one-stop tool.
  2. ``TRUNCATE ... RESTART IDENTITY CASCADE`` drops every row and
     rolls auto-increment / sequence counters back to 1. CASCADE
     means the truncate doesn't care about FK order — if A points at
     B, A gets cleared along with B.
  3. Inserts one ADMIN user with the given email + Argon2id-hashed
     password. ``is_active=True`` and ``role='ADMIN'`` so the admin
     panel's role gate lets them in immediately.

Safety:
  * Default refuses to run unless ``ENV=local`` (matches the rest
    of the dev tooling — local is the only environment where data
    loss is acceptable).
  * ``--force`` overrides for explicit resets (CI, staging wipes).
    Even with --force, we print the resolved DATABASE_URL host so a
    misfire is at least loud rather than silent.
  * No-op against missing tables: TRUNCATE on a fresh schema (no
    rows yet) is harmless.

This script does NOT touch alembic or recreate tables — migrations
should already be at head. If your schema is broken, run
``make migrate`` first; this script assumes ``alembic upgrade head``
has been applied.
"""

from __future__ import annotations

import argparse
import sys
from getpass import getuser

from sqlalchemy import text
from sqlalchemy.orm import Session

# Register every model on Base.metadata before any query runs — same
# pattern as scripts/seed_dev.py. Without this the metadata is empty
# and downstream lookups would silently miss tables.
import app.db.models  # noqa: F401

from app.core.config import settings
from app.core.password_hashing import hash_password
from app.db.session import SessionLocal
from app.modules.users.enums import UserRole
from app.modules.users.models import User


DEFAULT_EMAIL = "admin@example.com"
DEFAULT_PASSWORD = "admin1234"  # generic dev password; rotate before non-dev
DEFAULT_DISPLAY_NAME = "Admin"


def _safe_to_run(force: bool) -> bool:
    """Return True when it's OK to clobber the database.

    We trust ``settings.ENV`` — it's wired off the same env var as
    the FastAPI app's runtime mode, so "what does this script see"
    matches "what does the API see." Anyone running this in a
    non-local environment has to opt in with --force.
    """
    if force:
        return True
    return settings.ENV == "local"


def _list_app_tables(db: Session) -> list[str]:
    """Pull every table in the ``app`` schema from
    ``information_schema``. Excludes views and the alembic version
    table (alembic lives in the ``public`` schema by default but
    we filter defensively).
    """
    rows = db.execute(
        text(
            """
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'app'
            ORDER BY tablename
            """
        )
    ).all()
    return [r[0] for r in rows]


def _truncate_all_app_tables(db: Session) -> list[str]:
    """``TRUNCATE`` every table in ``app.*`` with CASCADE.

    Returns the list of tables it touched so the caller can print a
    summary. RESTART IDENTITY resets serial / identity sequences in
    case anything is bigserial-backed — we mostly use UUID PKs but
    sequences exist on a couple of legacy tables.
    """
    tables = _list_app_tables(db)
    if not tables:
        return []

    qualified = ", ".join(f'"app"."{t}"' for t in tables)
    db.execute(text(f"TRUNCATE TABLE {qualified} RESTART IDENTITY CASCADE"))
    db.commit()
    return tables


def _seed_admin(
    db: Session, *, email: str, password: str, display_name: str
) -> User:
    """Insert the lone admin user. The TRUNCATE above wiped
    everything, so we don't bother with an UPSERT — INSERT and let
    a unique-violation surface as a hard error if someone runs the
    script on a half-cleared database.
    """
    user = User(
        email=email,
        display_name=display_name,
        role=UserRole.ADMIN.value,
        password_hash=hash_password(password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _print_credentials(*, user: User, email: str, password: str) -> None:
    """Stdout summary so the operator can copy/paste into the
    admin panel login form."""
    print()
    print("=" * 72)
    print("  Trust Halal — admin user ready")
    print("=" * 72)
    print(f"  Email:    {email}")
    print(f"  Password: {password}")
    print(f"  Role:     ADMIN")
    print(f"  User ID:  {user.id}")
    print("=" * 72)
    print()
    print("Sign in at the admin panel with the credentials above.")
    print("Rotate the password before using anywhere non-local.")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Flush every row in app.* and re-seed a single admin "
            "user. Safe by default — refuses to run unless ENV=local."
        )
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "Override the ENV=local guard. Use with intent — this "
            "deletes every row in every table."
        ),
    )
    parser.add_argument(
        "--email",
        default=DEFAULT_EMAIL,
        help=f"Admin email (default: {DEFAULT_EMAIL}).",
    )
    parser.add_argument(
        "--password",
        default=DEFAULT_PASSWORD,
        help=f"Admin password (default: {DEFAULT_PASSWORD}).",
    )
    parser.add_argument(
        "--display-name",
        default=DEFAULT_DISPLAY_NAME,
        help=f"Admin display name (default: {DEFAULT_DISPLAY_NAME!r}).",
    )
    args = parser.parse_args()

    db_url = settings.DATABASE_URL
    db_host = db_url.split("@")[-1].split("/")[0] if "@" in db_url else db_url

    if not _safe_to_run(args.force):
        print(
            f"Refusing to run: ENV={settings.ENV!r} (not 'local').\n"
            f"  Target database: {db_host}\n"
            f"  Pass --force if you really mean to wipe this DB.",
            file=sys.stderr,
        )
        return 2

    print(
        f"Resetting Trust Halal app schema "
        f"(ENV={settings.ENV}, db host={db_host}, "
        f"operator={getuser()})…"
    )

    with SessionLocal() as db:
        tables = _truncate_all_app_tables(db)
        if tables:
            print(f"  Truncated {len(tables)} tables: {', '.join(tables)}")
        else:
            print("  No tables found in 'app' schema (fresh DB?).")

        user = _seed_admin(
            db,
            email=args.email,
            password=args.password,
            display_name=args.display_name,
        )

    _print_credentials(user=user, email=args.email, password=args.password)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
