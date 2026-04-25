from __future__ import annotations

from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict, field_validator

from app.modules.claims.enums import ClaimEventType, ClaimScope, ClaimStatus, ClaimType


class ClaimCreate(BaseModel):
    place_id: UUID
    claim_type: ClaimType
    scope: ClaimScope = ClaimScope.ALL_MENU


class ClaimRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    claim_type: ClaimType
    scope: ClaimScope
    status: ClaimStatus
    expires_at: datetime
    created_at: datetime


class EvidenceCreate(BaseModel):
    evidence_type: str = Field(..., min_length=1, max_length=50)  # later enum
    uri: str = Field(..., min_length=1, max_length=1024)
    notes: Optional[str] = Field(None, max_length=5000)


class EvidenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    claim_id: UUID
    evidence_type: str
    uri: str
    notes: Optional[str]
    uploaded_by_user_id: UUID | None
    created_at: datetime


class ClaimEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    claim_id: UUID
    event_type: ClaimEventType
    message: Optional[str]
    actor_user_id: UUID | None
    created_at: datetime


class DisputeRequest(BaseModel):
    reason: str = Field(..., min_length=5, max_length=2000)

    @field_validator("reason")
    @classmethod
    def reason_not_blank(cls, v: str) -> str:
        v2 = v.strip()
        if not v2:
            raise ValueError("reason must not be blank")
        return v2
    

class RefreshRequest(BaseModel):
    reason: str | None = Field(default=None, min_length=3, max_length=500)


class ClaimDetailRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    place_id: UUID
    claim_type: ClaimType
    scope: ClaimScope
    status: ClaimStatus
    expires_at: datetime
    created_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime

    evidence: list[EvidenceRead]
    events: list[ClaimEventRead]