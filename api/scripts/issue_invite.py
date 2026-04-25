"""Mint an invite token for a user from the command line.

Two modes, both useful for ops bootstrap:

  * **Issue** (default) — user must already exist. Mints a fresh invite
    token, revoking any previous live one. Useful for seeded users
    whose passwords were never set, or anyone whose original invite
    link expired.

  * **Create + issue** (``--create``) — creates the user first if they
    don't exist, then mints. Use this for the very first admin in a
    fresh production environment, where ``POST /admin/users`` can't
    be called yet (it requires being signed in as an existing admin).

This mirrors the same code path ``POST /admin/users`` triggers
internally. The token is single-use and expires after
``INVITE_TOKEN_TTL_DAYS`` (default 7).

Usage
-----
Local dev (uses the docker-compose database):

    poetry run python -m scripts.issue_invite admin@trusthalal.dev

Production bootstrap — first admin in a freshly-deployed Supabase:

    DATABASE_URL=postgresql+psycopg://postgres.<ref>:<pass>@aws-1-us-east-1.pooler.supabase.com:5432/postgres \\
    ADMIN_PANEL_ORIGIN=https://admin.trusthalal.org \\
    poetry run python -m scripts.issue_invite \\
        --create --role ADMIN --display-name "Rozeb Momin" \\
        rozebm@gmail.com

Re-issuing for a user who already exists in prod:

    DATABASE_URL=... ADMIN_PANEL_ORIGIN=... \\
    poetry run python -m scripts.issue_invite rozebm@gmail.com

Output is the pre-baked set-password URL — open it in your browser,
pick a password, and you'll land signed in. The token is logged
nowhere; if you lose the URL re-run this script for a fresh one.
"""
from __future__ import annotations

import argparse
import sys
from urllib.parse import urlencode

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.auth.invite_repo import mint_invite
from app.modules.users.enums import UserRole
from app.modules.users.models import User


def _build_url(token_plain: str) -> str:
    origin = settings.ADMIN_PANEL_ORIGIN.rstrip("/")
    query = urlencode({"token": token_plain})
    return f"{origin}/set-password?{query}"


def _resolve_role(value: str) -> UserRole:
    """Accept any case and validate against UserRole."""
    normalized = value.strip().upper()
    try:
        return UserRole(normalized)
    except ValueError:
        valid = ", ".join(r.value for r in UserRole)
        raise SystemExit(
            f"Invalid role {value!r}. Must be one of: {valid}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("email", help="The user's email address.")
    parser.add_argument(
        "--create",
        action="store_true",
        help=(
            "Create the user if they don't already exist. Required for"
            " bootstrapping the first admin in a fresh environment."
        ),
    )
    parser.add_argument(
        "--role",
        default="ADMIN",
        help=(
            "Role to assign when creating a new user (only used with"
            " --create). One of ADMIN, VERIFIER, OWNER, CONSUMER."
            " Default: ADMIN."
        ),
    )
    parser.add_argument(
        "--display-name",
        default=None,
        help=(
            "Optional display name when creating a new user. Falls back"
            " to None (server allows null)."
        ),
    )
    args = parser.parse_args()

    if not settings.DATABASE_URL:
        print(
            "DATABASE_URL is not set. Either source your .env or set it"
            " inline (see usage in the docstring).",
            file=sys.stderr,
        )
        return 1

    engine = create_engine(settings.DATABASE_URL, future=True)
    with Session(engine) as db:
        normalized_email = args.email.strip().lower()

        user = db.execute(
            select(User).where(func.lower(User.email) == normalized_email)
        ).scalar_one_or_none()

        if user is None:
            if not args.create:
                print(
                    f"No user found for {args.email!r}.\n"
                    f"\n"
                    f"To create them now, re-run with --create:\n"
                    f"    --create --role ADMIN"
                    f' --display-name "Your Name"\n'
                    f"\n"
                    f"Or call POST /admin/users from a signed-in admin"
                    f" session.",
                    file=sys.stderr,
                )
                return 2

            role = _resolve_role(args.role)
            user = User(
                email=normalized_email,
                role=role.value,
                display_name=args.display_name,
                is_active=True,
            )
            db.add(user)
            db.flush()  # populate user.id for the invite FK
            print(f"Created user {user.email} with role {user.role}.")

        elif not user.is_active:
            print(
                f"User {args.email!r} is deactivated. Re-activate them first"
                " (the set-password endpoint refuses inactive users on consume).",
                file=sys.stderr,
            )
            return 3

        # ``mint_invite`` revokes any previous live invite for this
        # user+purpose before inserting, so re-running is safe.
        _row, plaintext = mint_invite(
            db,
            user_id=user.id,
            created_by_user_id=None,  # CLI invocation has no acting admin
        )
        db.commit()

        url = _build_url(plaintext)
        print()
        print(f"Invite minted for {user.email} (role={user.role}).")
        print(f"Open this URL in a browser to set a password:\n")
        print(f"    {url}\n")
        print(
            f"Valid for {settings.INVITE_TOKEN_TTL_DAYS} days, single-use."
            " Re-run the script if you need a fresh URL."
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
