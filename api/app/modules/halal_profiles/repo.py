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

import logging

from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.halal_profiles.models import HalalProfile

logger = logging.getLogger(__name__)


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


def public_meat_products(
    db: Session, *, profile: HalalProfile
) -> list["MeatProductRead"]:
    """Per-product sourcing for a profile, projected for public reading.

    The profile's per-meat columns are a rollup of exactly this list, so the
    two can't contradict each other: both derive from the same approved
    claim, and there is no path that edits profile columns after approval.
    If one is ever added, it has to rewrite the claim or this stops being
    true and the detail page starts arguing with itself.

    Returns ``[]`` rather than raising when anything is missing — no source
    claim (the FK is ``ON DELETE SET NULL``), no questionnaire, or a
    questionnaire that predates the ``meat_products`` field. This is
    supplementary context on a page that already renders without it; a
    restaurant whose claim was tidied up in support shouldn't 500 the place
    it belongs to.

    Malformed entries are skipped individually rather than failing the whole
    list. The column is owner-authored JSON that has been through several
    schema revisions, so one bad row losing the other five would be the
    wrong trade.
    """
    from app.modules.halal_claims.models import HalalClaim
    from app.modules.halal_profiles.schemas import MeatProductRead

    if profile.source_claim_id is None:
        return []

    response = db.execute(
        select(HalalClaim.structured_response).where(
            HalalClaim.id == profile.source_claim_id
        )
    ).scalar_one_or_none()
    if not isinstance(response, dict):
        return []

    raw = response.get("meat_products")
    if not isinstance(raw, list):
        return []

    out: list[MeatProductRead] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        try:
            out.append(
                MeatProductRead(
                    meat_type=entry["meat_type"],
                    product_name=entry["product_name"],
                    slaughter_method=entry["slaughter_method"],
                    supplier_name=entry.get("supplier_name"),
                    supplier_city=entry.get("supplier_city"),
                    supplier_state=entry.get("supplier_state"),
                    certifying_authority=entry.get("certifying_authority"),
                )
            )
        except Exception:  # noqa: BLE001 — see docstring
            logger.warning(
                "skipping malformed meat_products entry on claim %s",
                profile.source_claim_id,
            )
    # NOT_SERVED entries are an artefact of the questionnaire's symmetry —
    # an entry exists because the product is served. Showing "Lamb chops:
    # not served" would be noise; the absent-meats line already covers it.
    return [p for p in out if p.slaughter_method.value != "NOT_SERVED"]
