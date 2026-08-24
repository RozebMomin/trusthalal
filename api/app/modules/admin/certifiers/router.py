"""Admin endpoints for the certifier registry (admin-curated).

Canonical certifying bodies + their aliases + adverse-event history. Everything
is ADMIN-only. The registry is the target that free-text certifying-body strings
(on supplier lines and verifier findings) resolve to.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_roles
from app.core.exceptions import NotFoundError
from app.db.deps import get_db
from app.modules.admin.certifiers.repo import (
    add_adverse_event,
    add_alias,
    create_certifier,
    delete_alias,
    get_certifier,
    list_certifiers,
    patch_certifier,
    resolve_by_name,
)
from app.modules.admin.certifiers.schemas import (
    CertifierAdminRead,
    CertifierAdverseEventCreate,
    CertifierAliasCreate,
    CertifierCreate,
    CertifierDetailRead,
    CertifierPatch,
    CertifierResolveResult,
)
from app.modules.certifiers.models import Certifier
from app.modules.users.enums import UserRole

router = APIRouter(prefix="/admin/certifiers", tags=["admin: certifiers"])


def _read(cert: Certifier) -> CertifierAdminRead:
    item = CertifierAdminRead.model_validate(cert)
    item.alias_count = len(cert.aliases)
    item.adverse_event_count = len(cert.adverse_events)
    return item


def _detail(cert: Certifier) -> CertifierDetailRead:
    item = CertifierDetailRead.model_validate(cert)
    item.alias_count = len(cert.aliases)
    item.adverse_event_count = len(cert.adverse_events)
    return item


@router.get("", response_model=list[CertifierAdminRead])
def list_all(
    q: str | None = Query(default=None, max_length=255),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[CertifierAdminRead]:
    return [_read(c) for c in list_certifiers(db, q=q)]


@router.get("/resolve", response_model=CertifierResolveResult)
def resolve(
    name: str = Query(min_length=1, max_length=255),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> CertifierResolveResult:
    """Resolve a free-text certifying-body string to a canonical certifier via
    the alias table. Powers 'link to registry' reconciliation on supplier lines
    and verifier findings."""
    cert = resolve_by_name(db, name)
    return CertifierResolveResult(
        query=name,
        matched=cert is not None,
        certifier=_read(cert) if cert is not None else None,
    )


@router.post("", response_model=CertifierDetailRead, status_code=status.HTTP_201_CREATED)
def create(
    payload: CertifierCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> CertifierDetailRead:
    cert = create_certifier(
        db,
        slug=payload.slug.strip(),
        name=payload.name.strip(),
        legal_entity=payload.legal_entity,
        country_code=payload.country_code,
        website=payload.website,
        notes=payload.notes,
        aliases=payload.aliases,
    )
    return _detail(cert)


@router.get("/{certifier_id}", response_model=CertifierDetailRead)
def get_one(
    certifier_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> CertifierDetailRead:
    cert = get_certifier(db, certifier_id)
    if cert is None:
        raise NotFoundError("CERTIFIER_NOT_FOUND", "Certifier not found.")
    return _detail(cert)


@router.patch("/{certifier_id}", response_model=CertifierDetailRead)
def patch(
    certifier_id: UUID,
    payload: CertifierPatch,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> CertifierDetailRead:
    cert = get_certifier(db, certifier_id)
    if cert is None:
        raise NotFoundError("CERTIFIER_NOT_FOUND", "Certifier not found.")
    fields = payload.model_dump(exclude_unset=True)
    return _detail(patch_certifier(db, cert, fields))


@router.post(
    "/{certifier_id}/aliases",
    response_model=CertifierDetailRead,
    status_code=status.HTTP_201_CREATED,
)
def add_certifier_alias(
    certifier_id: UUID,
    payload: CertifierAliasCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> CertifierDetailRead:
    cert = get_certifier(db, certifier_id)
    if cert is None:
        raise NotFoundError("CERTIFIER_NOT_FOUND", "Certifier not found.")
    add_alias(db, cert, payload.alias)
    db.refresh(cert)
    return _detail(cert)


@router.delete("/{certifier_id}/aliases/{alias_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_certifier_alias(
    certifier_id: UUID,
    alias_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> None:
    if not delete_alias(db, certifier_id, alias_id):
        raise NotFoundError("CERTIFIER_ALIAS_NOT_FOUND", "Alias not found.")


@router.post(
    "/{certifier_id}/adverse-events",
    response_model=CertifierDetailRead,
    status_code=status.HTTP_201_CREATED,
)
def add_certifier_adverse_event(
    certifier_id: UUID,
    payload: CertifierAdverseEventCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> CertifierDetailRead:
    cert = get_certifier(db, certifier_id)
    if cert is None:
        raise NotFoundError("CERTIFIER_NOT_FOUND", "Certifier not found.")
    add_adverse_event(
        db,
        cert,
        event_type=payload.event_type.value,
        occurred_on=payload.occurred_on,
        summary=payload.summary,
        source_url=payload.source_url,
    )
    db.refresh(cert)
    return _detail(cert)
