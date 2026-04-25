import uuid
from pydantic import BaseModel, ConfigDict, Field

from app.modules.places.enums import ExternalIdProvider  # wherever your StrEnum lives


class PlaceExternalIdUpsert(BaseModel):
    provider: ExternalIdProvider
    external_id: str = Field(..., min_length=3, max_length=255)


class PlaceExternalIdRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    place_id: uuid.UUID
    provider: ExternalIdProvider
    external_id: str