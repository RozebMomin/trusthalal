"""Public read helpers for halal profiles.

Phase 4 of the halal-trust v2 rebuild. The consumer-facing surfaces
(``GET /places/{id}/halal-profile`` and the embedded shape on
``GET /places/{id}``) come through here.

Visibility rules (consumer-facing reads):

  * Place must exist and not be soft-deleted (the surrounding
    ``get_place`` helper already enforces this).
  * Profile must exist for the place (1:1).
  * Profile must NOT be revoked (revoked_at is NULL).

Expired profiles (expires_at in the past) ARE returned — the
consumer UI can render a "Last verified ..." line and a stale
indicator. We don't hide stale data because doing so removes
useful context ("this place was verified 14 months ago and hasn't
re-certified yet" is meaningful information for the consumer).

Disputed profiles ARE returned — the dispute_state field rides
along so the UI can render a "conflicting reports" badge.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.halal_profiles.models import HalalProfile


def get_public_halal_profile(
    db: Session, *, place_id: UUID
) -> Optional[HalalProfile]:
    """Return the place's HalalProfile if it's safe to show consumers.

    Returns None when:
      * No profile exists for this place yet (owner hasn't claimed
        and gotten approved).
      * The profile was revoked by an admin.

    The caller decides whether None means 404 or "no halal info on
    file" — the dedicated ``/halal-profile`` endpoint 404s, the
    embedded shape on ``GET /places/{id}`` simply leaves the field
    null.
    """
    return db.execute(
        select(HalalProfile).where(
            HalalProfile.place_id == place_id,
            HalalProfile.revoked_at.is_(None),
        )
    ).scalar_one_or_none()
