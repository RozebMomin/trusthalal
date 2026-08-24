"""Pydantic schemas for the admin certifier registry."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.certifiers.enums import CertifierAdverseEventType


class CertifierAliasRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    alias: str


class CertifierAdverseEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    event_type: CertifierAdverseEventType
    occurred_on: Optional[date] = None
    summary: str
    source_url: Optional[str] = None
    created_at: datetime


class CertifierAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    name: str
    legal_entity: Optional[str] = None
    country_code: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Filled by the router so the list view can show how much context exists.
    alias_count: int = 0
    adverse_event_count: int = 0


class CertifierDetailRead(CertifierAdminRead):
    aliases: list[CertifierAliasRead] = Field(default_factory=list)
    adverse_events: list[CertifierAdverseEventRead] = Field(default_factory=list)


class CertifierCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    legal_entity: Optional[str] = Field(default=None, max_length=255)
    country_code: Optional[str] = Field(default=None, max_length=2)
    website: Optional[str] = Field(default=None, max_length=512)
    notes: Optional[str] = None
    # Optional seed aliases created alongside the certifier.
    aliases: list[str] = Field(default_factory=list)


class CertifierPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, max_length=255)
    legal_entity: Optional[str] = Field(default=None, max_length=255)
    country_code: Optional[str] = Field(default=None, max_length=2)
    website: Optional[str] = Field(default=None, max_length=512)
    notes: Optional[str] = None


class CertifierAliasCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    alias: str = Field(min_length=1, max_length=255)


class CertifierAdverseEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_type: CertifierAdverseEventType
    occurred_on: Optional[date] = None
    summary: str = Field(min_length=1)
    source_url: Optional[str] = Field(default=None, max_length=1024)


class CertifierResolveResult(BaseModel):
    """Resolve a free-text certifying-body string to a canonical certifier via
    aliases. Used by the visit/supplier reconciliation flows."""
    query: str
    matched: bool
    certifier: Optional[CertifierAdminRead] = None
