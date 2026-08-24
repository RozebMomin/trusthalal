"""Persistence for the admin certifier registry."""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.certifiers.models import (
    Certifier,
    CertifierAdverseEvent,
    CertifierAlias,
)


def list_certifiers(db: Session, *, q: str | None = None) -> list[Certifier]:
    stmt = select(Certifier).order_by(Certifier.name.asc())
    if q:
        needle = f"%{q.strip().lower()}%"
        stmt = stmt.where(func.lower(Certifier.name).like(needle))
    return list(db.execute(stmt).scalars().all())


def get_certifier(db: Session, certifier_id: UUID) -> Certifier | None:
    return db.get(Certifier, certifier_id)


def resolve_by_name(db: Session, name: str) -> Certifier | None:
    """Case-insensitive match of a free-text certifying-body string against the
    alias table. Returns the canonical certifier or None."""
    key = (name or "").strip().lower()
    if not key:
        return None
    stmt = (
        select(Certifier)
        .join(CertifierAlias, CertifierAlias.certifier_id == Certifier.id)
        .where(func.lower(CertifierAlias.alias) == key)
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def create_certifier(
    db: Session,
    *,
    slug: str,
    name: str,
    legal_entity: str | None,
    country_code: str | None,
    website: str | None,
    notes: str | None,
    aliases: list[str],
) -> Certifier:
    cert = Certifier(
        slug=slug,
        name=name,
        legal_entity=legal_entity,
        country_code=country_code,
        website=website,
        notes=notes,
    )
    db.add(cert)
    db.flush()  # get cert.id before adding aliases
    for a in _dedupe(aliases):
        db.add(CertifierAlias(certifier_id=cert.id, alias=a))
    db.commit()
    db.refresh(cert)
    return cert


def patch_certifier(db: Session, cert: Certifier, fields: dict) -> Certifier:
    for key, value in fields.items():
        setattr(cert, key, value)
    db.commit()
    db.refresh(cert)
    return cert


def add_alias(db: Session, cert: Certifier, alias: str) -> CertifierAlias:
    row = CertifierAlias(certifier_id=cert.id, alias=alias.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_alias(db: Session, certifier_id: UUID, alias_id: UUID) -> bool:
    row = db.get(CertifierAlias, alias_id)
    if row is None or row.certifier_id != certifier_id:
        return False
    db.delete(row)
    db.commit()
    return True


def add_adverse_event(
    db: Session,
    cert: Certifier,
    *,
    event_type: str,
    occurred_on,
    summary: str,
    source_url: str | None,
) -> CertifierAdverseEvent:
    row = CertifierAdverseEvent(
        certifier_id=cert.id,
        event_type=event_type,
        occurred_on=occurred_on,
        summary=summary,
        source_url=source_url,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        s = v.strip()
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out
