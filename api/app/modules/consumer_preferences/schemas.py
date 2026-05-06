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

from pydantic import BaseModel, ConfigDict

from app.modules.halal_profiles.enums import MenuPosture, ValidationTier


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
