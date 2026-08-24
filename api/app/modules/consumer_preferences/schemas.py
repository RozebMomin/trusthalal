"""Pydantic schemas for consumer preferences.

The wire shape mirrors the SQL columns 1-to-1 — each filter knob the
consumer search page exposes maps to one optional field here. Null
on the wire means "no preference" (same semantics as null in the
database), so the round-trip is lossless.

Validation tier and menu posture validate as their actual enums so
typos are 422s rather than 23514 CHECK violations at insert time.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app.modules.halal_profiles.enums import (
    MenuPosture,
    SlaughterMethod,
    ValidationTier,
    ZabihahStatus,
)

# Chicken (hand/machine): only the two methods a diner picks. NOT_SERVED /
# NOT_DISCLOSED describe a place, not a filter target, so they're rejected.
_SELECTABLE_SLAUGHTER = frozenset(
    {SlaughterMethod.HAND_CUT, SlaughterMethod.MACHINE_CUT}
)
# Red meat (zabihah): a diner filters for zabihah and can opt to include
# unsure. NOT_ZABIHAH and NOT_SERVED aren't things you filter *for*.
_SELECTABLE_ZABIHAH = frozenset({ZabihahStatus.ZABIHAH, ZabihahStatus.UNSURE})


def _dedupe(value):
    if value is None:
        return None
    seen: set = set()
    out: list = []
    for m in value:
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out or None


def _validate_slaughter(
    value: Optional[list[SlaughterMethod]],
) -> Optional[list[SlaughterMethod]]:
    if value is None:
        return None
    if any(m not in _SELECTABLE_SLAUGHTER for m in value):
        raise ValueError("chicken preferences must be HAND_CUT or MACHINE_CUT")
    return _dedupe(value)


def _validate_zabihah(
    value: Optional[list[ZabihahStatus]],
) -> Optional[list[ZabihahStatus]]:
    if value is None:
        return None
    if any(m not in _SELECTABLE_ZABIHAH for m in value):
        raise ValueError("zabihah preferences must be ZABIHAH or UNSURE")
    return _dedupe(value)


class ConsumerPreferencesRead(BaseModel):
    """GET /me/preferences response.

    Returned even when the underlying row doesn't exist yet — the
    repo's ``get_or_default`` returns an all-null record so the
    frontend can render the same form regardless of whether the user
    has saved anything.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    min_validation_tier: Optional[ValidationTier] = None
    min_menu_posture: Optional[MenuPosture] = None
    no_pork: Optional[bool] = None
    no_alcohol_served: Optional[bool] = None
    has_certification: Optional[bool] = None
    # Chicken keeps hand/machine; red meat uses the zabihah axis. Mirror the
    # search sheet's per-meat multi-select.
    chicken_slaughter: Optional[list[SlaughterMethod]] = None
    beef_zabihah: Optional[list[ZabihahStatus]] = None
    lamb_zabihah: Optional[list[ZabihahStatus]] = None
    goat_zabihah: Optional[list[ZabihahStatus]] = None
    # Set when at least one PUT has landed; null when the row doesn't
    # exist yet. Lets the UI tell "you haven't customized anything
    # yet" from "you turned everything off."
    updated_at: Optional[datetime] = None


class ConsumerPreferencesUpdate(BaseModel):
    """PUT /me/preferences payload.

    All fields are optional — a PUT with the empty body resets every
    preference to NULL ("no minimum, accept anything"). That's
    deliberately the default semantics: a "Reset" button on the
    preferences page is a `PUT /me/preferences` with `{}`.

    Filter values not present in the payload are coerced to NULL on
    the server side (full replace, not patch) — this matches the PUT
    verb. A future PATCH endpoint could give granular field updates,
    but the form-driven UI we're shipping always sends the complete
    state, so the simpler verb fits.
    """

    model_config = ConfigDict(extra="forbid")

    min_validation_tier: Optional[ValidationTier] = None
    min_menu_posture: Optional[MenuPosture] = None
    no_pork: Optional[bool] = None
    no_alcohol_served: Optional[bool] = None
    has_certification: Optional[bool] = None
    chicken_slaughter: Optional[list[SlaughterMethod]] = None
    beef_zabihah: Optional[list[ZabihahStatus]] = None
    lamb_zabihah: Optional[list[ZabihahStatus]] = None
    goat_zabihah: Optional[list[ZabihahStatus]] = None

    @field_validator("chicken_slaughter")
    @classmethod
    def _valid_chicken(
        cls, value: Optional[list[SlaughterMethod]]
    ) -> Optional[list[SlaughterMethod]]:
        return _validate_slaughter(value)

    @field_validator("beef_zabihah", "lamb_zabihah", "goat_zabihah")
    @classmethod
    def _valid_zabihah(
        cls, value: Optional[list[ZabihahStatus]]
    ) -> Optional[list[ZabihahStatus]]:
        return _validate_zabihah(value)
