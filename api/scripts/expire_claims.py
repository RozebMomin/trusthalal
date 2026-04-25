from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

import app.db.models  # noqa: F401  # ensures all models are registered

from app.db.session import SessionLocal
from app.modules.claims.enums import ClaimEventType, ClaimStatus
from app.modules.claims.models import HalalClaim, ClaimEvent


BATCH_SIZE = 500


def expire_claims(db: Session) -> int:
    now = datetime.now(timezone.utc)

    # Grab candidates in batches so we can write audit events per-claim.
    stmt = (
        select(HalalClaim)
        .where(HalalClaim.expires_at <= now)
        .where(HalalClaim.status.in_([ClaimStatus.PENDING, ClaimStatus.VERIFIED]))
        .limit(BATCH_SIZE)
    )

    expired_count = 0

    while True:
        claims = db.execute(stmt).scalars().all()
        if not claims:
            break

        for claim in claims:
            claim.status = ClaimStatus.EXPIRED

            db.add(
                ClaimEvent(
                    claim_id=claim.id,
                    event_type=ClaimEventType.EXPIRED,
                    message="Claim auto-expired by daily job",
                    actor_user_id=None,
                )
            )
            expired_count += 1

        db.commit()

    return expired_count


def main() -> None:
    db = SessionLocal()
    try:
        count = expire_claims(db)
        print(f"Expired {count} claims")
    finally:
        db.close()


if __name__ == "__main__":
    main()