"""Consumer-preferences endpoints.

Two routes only:

  * ``GET  /me/preferences`` — the caller's saved preferences.
    Returns an all-null shape when the row doesn't exist yet so the
    frontend's preferences page can render the same form regardless
    of whether the user has customized anything.
  * ``PUT  /me/preferences`` — full-replace upsert.

Auth: signed-in CONSUMER or VERIFIER. Verifiers browse and search the
consumer surface just like diners (they were consumers before approval),
so they keep their search-preference defaults. Owners / admins are still
excluded — they operate from the owner/admin surfaces, not the consumer
search page, so saving search defaults there would be misleading.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.db.deps import get_db
from app.modules.consumer_preferences.repo import (
    get_or_default,
    upsert,
)
from app.modules.consumer_preferences.schemas import (
    ConsumerPreferencesRead,
    ConsumerPreferencesUpdate,
)
from app.modules.users.enums import UserRole


router = APIRouter(prefix="/me/preferences", tags=["consumer-preferences"])


_EMPTY_PREFERENCES = ConsumerPreferencesRead()


@router.get(
    "",
    response_model=ConsumerPreferencesRead,
    summary="Get the caller's saved consumer search preferences",
    description=(
        "Returns an all-null payload when the user hasn't saved any "
        "preferences yet — the frontend renders the same form in "
        "both states. ``updated_at`` is null in the empty case."
    ),
)
def get_my_preferences(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.CONSUMER, UserRole.VERIFIER)),
) -> ConsumerPreferencesRead:
    record = get_or_default(db, user_id=user.id)
    if record is None:
        return _EMPTY_PREFERENCES
    return ConsumerPreferencesRead.model_validate(record)


@router.put(
    "",
    response_model=ConsumerPreferencesRead,
    summary="Replace the caller's consumer search preferences",
    description=(
        "Full-replace upsert. Any field omitted from the payload is "
        "reset to ``null`` (\"no preference\"). Sending ``{}`` is "
        "the canonical 'reset everything' operation."
    ),
)
def put_my_preferences(
    payload: ConsumerPreferencesUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.CONSUMER, UserRole.VERIFIER)),
) -> ConsumerPreferencesRead:
    record = upsert(db, user_id=user.id, payload=payload)
    return ConsumerPreferencesRead.model_validate(record)
