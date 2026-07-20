"""Create (or reset) the App Review demo account.

    python -m scripts.create_review_demo_account
    python -m scripts.create_review_demo_account --email x@y.com --password 'Sw0rdfish-demo'

## Why this exists

Apple's reviewer needs an account that can exercise everything the app does,
and ours has a gate they physically cannot pass: posting a review requires a
confirmed email, and the reviewer can't read a mailbox they don't own. A
reviewer who signs up fresh, taps "Write a review", and is told to confirm an
email will reasonably conclude the core feature is broken — that's a rejection
for something that works perfectly for real users.

So the account is created here with ``email_verified_at`` already stamped.

## Re-run it after every review cycle

The reviewer is specifically checking that account deletion works (guideline
5.1.1(v)), which means there's a good chance they will delete this account
while testing it. That's the feature behaving correctly, and it leaves the
credentials in your App Review notes pointing at nothing. Re-running this
script recreates the account with the same credentials.

The script is idempotent: it resets the password, re-verifies the email, and
reactivates the row if one already exists.

## What it deliberately doesn't do

It doesn't write reviews on the demo account's behalf. A reviewer needs to
*post* one to test the flow, and one-review-per-place would block them on
whichever place we'd pre-seeded. Better to hand them an empty account and let
them use it.

## It tells you which database it's about to touch

The credentials only matter on production, but the script connects to whatever
``DATABASE_URL`` is set — which, from a dev shell, is localhost. Creating the
demo account on a local database looks exactly like success and fails a week
later at Apple's sign-in screen. So the target is printed first, and anything
that isn't obviously local asks for confirmation before writing.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.password_hashing import hash_password
from app.core.password_policy import validate_password_strength
from app.db.session import SessionLocal
from app.modules.users.enums import UserRole
from app.modules.users.models import User

# Deterministic so the value in App Review notes stays correct across reruns.
DEFAULT_EMAIL = "appreview@trusthalal.org"
DEFAULT_PASSWORD = "Rev1ewer-Demo"
DEFAULT_NAME = "App Review"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument("--display-name", default=DEFAULT_NAME)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the confirmation prompt (for non-interactive use).",
    )
    args = parser.parse_args()

    # Where are we actually writing? Print it before doing anything, because
    # "it worked" against localhost is indistinguishable from "it worked"
    # against production until Apple tries to sign in.
    if not settings.DATABASE_URL:
        print("DATABASE_URL is not set — nothing to connect to.")
        return 1
    url = make_url(settings.DATABASE_URL)
    host = url.host or "(local socket)"
    target = f"{url.database} on {host}  [ENV={settings.ENV}]"
    is_local = host in {"localhost", "127.0.0.1", "::1", "(local socket)"}

    print(f"Target database: {target}")
    if is_local:
        print(
            "  ^ this is a LOCAL database. The demo account only helps Apple "
            "if it exists on production."
        )
    elif not args.yes:
        # Non-local means this write is probably the one that counts. Make the
        # person say so, rather than discovering later which environment they
        # were pointed at.
        answer = input("Write the demo account to this database? [y/N] ")
        if answer.strip().lower() not in {"y", "yes"}:
            print("Aborted.")
            return 1

    # Fail here rather than at the login screen a week later. The API enforces
    # this policy on signup, so a demo password that doesn't meet it would
    # create an account nobody could re-create through the normal flow.
    try:
        validate_password_strength(args.password)
    except Exception as exc:  # noqa: BLE001 - surface the policy message as-is
        print(f"Password rejected by the same policy the API enforces: {exc}")
        return 1

    norm = args.email.strip().lower()
    db = SessionLocal()
    try:
        user = db.execute(
            select(User).where(func.lower(User.email) == norm)
        ).scalar_one_or_none()

        created = user is None
        if user is None:
            user = User(
                email=norm,
                role=UserRole.CONSUMER.value,
                display_name=args.display_name,
                is_active=True,
            )
            db.add(user)

        # Reset every field the reviewer depends on, so a rerun repairs an
        # account that was deleted, deactivated, or had its password changed.
        user.password_hash = hash_password(args.password)
        user.display_name = args.display_name
        user.is_active = True
        # The whole point: skip the email gate they can't clear.
        user.email_verified_at = datetime.now(timezone.utc)

        db.add(user)
        db.commit()
        db.refresh(user)
    finally:
        db.close()

    print(f"{'Created' if created else 'Reset'} demo account on {target}")
    print(f"  email:    {user.email}")
    print(f"  password: {args.password}")
    print(f"  role:     {user.role}")
    print(f"  verified: {user.email_verified_at.isoformat()}")
    print()
    print("Paste the email and password into App Store Connect →")
    print("App Review Information → Sign-In Required.")
    print()
    print("Re-run this after review: they will likely delete the account while")
    print("testing that account deletion works.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
