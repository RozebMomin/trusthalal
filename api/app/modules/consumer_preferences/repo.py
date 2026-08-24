"""Persistence helpers for consumer preferences.

Two callsites:

  * ``get_or_default(db, user_id)`` — returns the existing row or
    None. The router converts None into the "all-null" read shape
    so the UI doesn't have to branch on existence.
  * ``upsert(db, user_id, payload)`` — INSERT-or-UPDATE on
    user_id. Always full-replace: every column the payload omitted
    is reset to NULL. This matches the PUT verb's "replace
    representation" semantics and keeps the wire shape symmetric
    with ``ConsumerPreferencesRead``.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.consumer_preferences.models import ConsumerPreferences
from app.modules.consumer_preferences.schemas import (
    ConsumerPreferencesUpdate,
)


def _enum_values(values) -> list[str] | None:
    """Enum members → list of plain strings for the JSONB column. None stays
    None (no preference); an empty list also collapses to None so "cleared all
    values for this meat" reads the same as "never set"."""
    if not values:
        return None
    return [v.value for v in values]


def get_or_default(
    db: Session, *, user_id: UUID
) -> ConsumerPreferences | None:
    """Return the user's preferences row, or None if they haven't
    saved anything yet."""
    return db.execute(
        select(ConsumerPreferences).where(
            ConsumerPreferences.user_id == user_id
        )
    ).scalar_one_or_none()


def upsert(
    db: Session,
    *,
    user_id: UUID,
    payload: ConsumerPreferencesUpdate,
) -> ConsumerPreferences:
    """INSERT-or-UPDATE the user's preferences row.

    Full-replace semantics: every column not present in ``payload``
    is set back to NULL. The frontend always submits the complete
    form state on save so this matches the user's mental model
    ("these are now my prefs").
    """
    existing = get_or_default(db, user_id=user_id)

    # Coerce enum values to their string form before they hit the
    # column. Pydantic gives us Enum instances; the column is a
    # plain String so we need the .value.
    fields: dict[str, object] = {
        "min_validation_tier": (
            payload.min_validation_tier.value
            if payload.min_validation_tier is not None
            else None
        ),
        "min_menu_posture": (
            payload.min_menu_posture.value
            if payload.min_menu_posture is not None
            else None
        ),
        "no_pork": payload.no_pork,
        "no_alcohol_served": payload.no_alcohol_served,
        "has_certification": payload.has_certification,
        # JSONB arrays of method strings. Coerce enum members to their .value
        # so the stored JSON is plain strings ("HAND_CUT"), matching what the
        # search query params expect. None (no preference) stays None.
        "chicken_slaughter": _enum_values(payload.chicken_slaughter),
        "beef_zabihah": _enum_values(payload.beef_zabihah),
        "lamb_zabihah": _enum_values(payload.lamb_zabihah),
        "goat_zabihah": _enum_values(payload.goat_zabihah),
    }

    if existing is None:
        record = ConsumerPreferences(user_id=user_id, **fields)
        db.add(record)
    else:
        for key, value in fields.items():
            setattr(existing, key, value)
        record = existing

    db.commit()
    db.refresh(record)
    return record
