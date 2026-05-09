"""Pydantic schemas for the consumer favorites endpoints.

The list endpoint embeds a ``PlaceSearchResult`` for each row so the
consumer site can render the same ``PlaceResultCard`` it uses on the
search results page — same data shape, same trust pill, same hero
photo, no second fetch per row.

Why ``PlaceSearchResult`` and not ``PlaceDetail``: the favorites page
shows a list, not a detail view. We want hero photo + halal profile
embed + cuisine tags (all on PlaceSearchResult) but NOT the full
photo gallery + place metadata (PlaceDetail). The detail view lives
one tap away on the place's own page.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict


if TYPE_CHECKING:  # pragma: no cover
    from app.modules.places.schemas import PlaceSearchResult


class FavoriteRead(BaseModel):
    """One row on the consumer favorites list.

    The ``place`` payload is the same ``PlaceSearchResult`` shape used
    by the public search list — kept identical on purpose so the
    consumer site reuses ``PlaceResultCard`` without a second
    transformation step. ``saved_at`` lets the listing sort newest-
    first and powers any future "you saved this 3 days ago"
    affordance.
    """

    model_config = ConfigDict(from_attributes=True)

    saved_at: datetime
    place: "PlaceSearchResult"


# Resolve the forward reference once the place schema module is
# importable. The pattern matches how ``PlaceDetail`` resolves its
# inline ``HalalProfileEmbed`` reference: import here at the bottom
# of the file (post-class-definition) so Pydantic v2's model_rebuild
# can see the concrete type.
from app.modules.places.schemas import PlaceSearchResult  # noqa: E402

FavoriteRead.model_rebuild()
