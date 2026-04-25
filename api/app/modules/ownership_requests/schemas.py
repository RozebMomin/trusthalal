from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class OwnershipRequestCreate(BaseModel):
    contact_name: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr = Field(..., max_length=255)
    contact_phone: str | None = Field(default=None, max_length=50)
    message: str | None = Field(default=None, max_length=2000)


class OwnershipRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    requester_user_id: UUID | None
    contact_name: str
    contact_email: str
    contact_phone: str | None
    message: str | None
    status: str
    created_at: datetime
    updated_at: datetime


class OwnershipRequestStatusRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    status: str
    created_at: datetime
    updated_at: datetime


class OwnershipRequestDetailRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    requester_user_id: UUID | None

    contact_name: str
    contact_email: EmailStr
    contact_phone: str | None
    message: str | None

    status: str
    created_at: datetime
    updated_at: datetime
