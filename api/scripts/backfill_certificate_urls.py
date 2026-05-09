"""Backfill ``certificate_url`` on approved halal profiles.

The cert-publishing step landed alongside the public ``halal-certificates``
Supabase bucket. Approvals from this point forward populate
``HalalProfile.certificate_url`` automatically; this script catches
the profiles that approved BEFORE the slice landed (or any approval
where the publish step soft-failed).

What it does
------------

For every approved halal profile (``has_certification=True``,
``revoked_at IS NULL``) that doesn't yet have a published cert URL:

  1. Find the ``source_claim`` and its latest ``HALAL_CERTIFICATE``
     attachment.
  2. Download the bytes from the private ``evidence`` bucket.
  3. Upload them to the public ``halal-certificates`` bucket at
     ``<profile_id>.<ext>`` (the same path scheme the live derivation
     service uses, so a future renewal overwrites this object cleanly
     instead of creating a parallel one).
  4. Stamp ``certificate_url`` + ``certificate_content_type`` on the
     profile and commit.

Failure modes are handled per-profile:

  * No source claim attached       → skipped (with a count in the
                                     final summary).
  * Source claim has no cert
    attachment                     → skipped.
  * Bucket download / upload fails → logged + counted; the script
                                     keeps going so a transient
                                     bucket blip doesn't block the
                                     rest of the batch.

Idempotency: re-running is safe. By default the query filters out
profiles that already have a ``certificate_url`` so a rerun is a no-op
if everything succeeded last time. ``--force`` re-publishes from the
source claim regardless — useful after a bucket migration or a
content-type fix.

Usage
-----
Dry-run to preview which profiles would be touched:

    poetry run python -m scripts.backfill_certificate_urls --dry-run

Run for real:

    poetry run python -m scripts.backfill_certificate_urls

Limit to a small first batch (canary / staged rollout):

    poetry run python -m scripts.backfill_certificate_urls --limit 5

Re-publish even profiles that already have a URL:

    poetry run python -m scripts.backfill_certificate_urls --force

Production invocation — same env-var pattern as ``issue_invite.py``:

    DATABASE_URL=postgresql+psycopg://...:5432/postgres \
    SUPABASE_URL=https://<ref>.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
    SUPABASE_STORAGE_BUCKET=evidence \
    SUPABASE_CERTS_BUCKET=halal-certificates \
    poetry run python -m scripts.backfill_certificate_urls
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.storage import (
    StorageError,
    get_certificates_storage_client,
    get_storage_client,
)

# Pull in every SQLAlchemy model class so the mapper registry is
# fully populated before the first query runs. Without this,
# string-based relationships on tangentially-related models (e.g.,
# ``OrganizationMember.user = relationship("User")``) can't resolve
# at configure time and raise
# ``InvalidRequestError: ... failed to locate a name ('User')``
# the moment SQLAlchemy walks the ORM graph. The aggregator's the
# canonical "import everything" entry point — same trick the FastAPI
# app uses on startup via ``app.db.base``.
import app.db.models  # noqa: F401

from app.modules.halal_claims.models import HalalClaim
from app.modules.halal_profiles.models import HalalProfile

# These two are private helpers in the derivation service. Importing
# them here keeps the bucket-to-bucket copy logic (download → upload →
# public_url) defined in exactly ONE place — the script and the live
# approve path can't drift on filename schemes or failure semantics.
from app.modules.halal_profiles.service import (
    _copy_cert_to_public_bucket,
    _latest_cert_attachment,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Print which profiles would be published without actually "
            "downloading / uploading bytes or writing to the database."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "Re-publish even when the profile already has a "
            "certificate_url. Use after a bucket migration or to "
            "refresh the content_type on previously-published certs."
        ),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help=(
            "Process at most N profiles. Useful for a canary run "
            "before a full backfill — e.g., --limit 5."
        ),
    )
    args = parser.parse_args()

    if not settings.DATABASE_URL:
        print(
            "DATABASE_URL is not set. Either source your .env or set "
            "it inline (see the usage section in this script's "
            "docstring).",
            file=sys.stderr,
        )
        return 1

    # Resolve storage clients up front. Failing here means the script
    # can't do useful work — bail before opening a DB transaction.
    try:
        evidence_storage = get_storage_client()
        certs_storage = get_certificates_storage_client()
    except StorageError as exc:
        print(
            f"Storage clients aren't configured: {exc}\n"
            "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "
            "SUPABASE_STORAGE_BUCKET, and SUPABASE_CERTS_BUCKET in "
            "the environment.",
            file=sys.stderr,
        )
        return 1

    engine = create_engine(settings.DATABASE_URL, future=True)
    with Session(engine) as db:
        # Pull the candidate set with the source claim's attachments
        # eager-loaded — saves a per-profile round trip when the
        # backfill walks dozens or hundreds of rows.
        query = (
            select(HalalProfile)
            .where(HalalProfile.has_certification.is_(True))
            .where(HalalProfile.revoked_at.is_(None))
            .order_by(HalalProfile.created_at)
        )
        if not args.force:
            query = query.where(HalalProfile.certificate_url.is_(None))
        if args.limit is not None:
            query = query.limit(args.limit)

        profiles = db.execute(query).scalars().all()

        total = len(profiles)
        prefix = "[dry-run] " if args.dry_run else ""
        print(f"{prefix}Considering {total} profile(s).")

        published = 0
        skipped_no_claim = 0
        skipped_no_attachment = 0
        failed = 0

        for profile in profiles:
            if profile.source_claim_id is None:
                print(
                    f"  · {profile.id}: no source_claim — skipping"
                )
                skipped_no_claim += 1
                continue

            # Fetch the claim with its attachments preloaded so
            # ``_latest_cert_attachment`` doesn't trigger another
            # round trip per row.
            claim = db.execute(
                select(HalalClaim)
                .where(HalalClaim.id == profile.source_claim_id)
                .options(selectinload(HalalClaim.attachments))
            ).scalar_one_or_none()
            if claim is None:
                print(
                    f"  · {profile.id}: source_claim "
                    f"{profile.source_claim_id} not found — skipping"
                )
                skipped_no_claim += 1
                continue

            attachment = _latest_cert_attachment(claim)
            if attachment is None:
                print(
                    f"  · {profile.id}: claim has no HALAL_CERTIFICATE "
                    "attachment — skipping"
                )
                skipped_no_attachment += 1
                continue

            if args.dry_run:
                # Print the source path so ops can copy-paste it
                # into the Supabase dashboard's Storage > evidence
                # browser to confirm the file is actually there
                # before flipping off --dry-run. Catches the case
                # where the DB row points at a path that was
                # cleaned up (or never landed) in the bucket.
                print(
                    f"  · {profile.id}: would publish "
                    f"{attachment.original_filename} "
                    f"({attachment.content_type}) "
                    f"from evidence://{attachment.storage_path}"
                )
                continue

            url, content_type = _copy_cert_to_public_bucket(
                profile_id=profile.id,
                attachment=attachment,
                evidence_storage=evidence_storage,
                certs_storage=certs_storage,
            )
            if url is None:
                # ``_copy_cert_to_public_bucket`` already logged the
                # underlying error via the service module's logger.
                # Print a one-liner here so the script's stdout has
                # the same row visible without a separate log tail.
                print(
                    f"  ✗ {profile.id}: copy failed (see logs) — "
                    "skipping"
                )
                failed += 1
                continue

            profile.certificate_url = url
            profile.certificate_content_type = content_type
            db.add(profile)
            # Commit per profile so a mid-run failure (e.g. network
            # blip on the next download) doesn't lose the work
            # that already succeeded. The cost of N small commits
            # vs. one batch commit is negligible at the scale of a
            # one-time backfill.
            db.commit()
            published += 1
            print(f"  ✓ {profile.id}: {url}")

        print()
        print(f"Published:                 {published}")
        print(f"Skipped (no attachment):   {skipped_no_attachment}")
        print(f"Skipped (no source claim): {skipped_no_claim}")
        print(f"Failed:                    {failed}")
        if args.dry_run:
            print("(dry-run — no bytes copied, no rows updated)")

    # Non-zero return when at least one profile failed so a CI
    # invocation surfaces the issue. The "skipped" buckets are
    # benign (data state, not a script error).
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
