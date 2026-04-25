import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.modules.admin.schemas import PlaceExternalIdUpsert, PlaceExternalIdRead
from app.modules.admin.deps import require_admin, admin_db
from app.modules.places.models import Place, PlaceExternalId  # adjust if split
from app.core.auth import CurrentUser

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post(
    "/places/{place_id}/external-ids",
    response_model=PlaceExternalIdRead,
)
def upsert_place_external_id(
    place_id: uuid.UUID,
    payload: PlaceExternalIdUpsert,
    overwrite: bool = Query(False),
    db: Session = Depends(admin_db),
    _: CurrentUser = Depends(require_admin),
):
    # Ensure place exists
    place_exists = db.execute(select(Place.id).where(Place.id == place_id)).scalar_one_or_none()
    if not place_exists:
        raise HTTPException(status_code=404, detail="Place not found")

    # Upsert by (place_id, provider)
    row = db.execute(
        select(PlaceExternalId).where(
            PlaceExternalId.place_id == place_id,
            PlaceExternalId.provider == payload.provider.value,  # StrEnum -> string
        )
    ).scalar_one_or_none()

    if row:
        if not overwrite:
            raise HTTPException(
                status_code=409,
                detail=f"External id already set for provider={payload.provider}. Use proper flags to replace."
            )
        row.external_id = payload.external_id
    else:
        row = PlaceExternalId(
            place_id=place_id,
            provider=payload.provider.value,
            external_id=payload.external_id,
        )
        db.add(row)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Most likely uniqueness violation: (provider, external_id) already attached elsewhere
        raise HTTPException(
            status_code=409,
            detail="External ID already assigned to another place for this provider",
        )

    db.refresh(row)
    return row