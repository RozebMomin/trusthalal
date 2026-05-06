from uuid import UUID
from fastapi import APIRouter, Body, Depends, Query, status

from app.core.auth import CurrentUser, require_roles
from app.core.exception_handlers import ErrorResponse
from app.db.deps import get_db
from app.modules.admin.places.repo import (
    admin_get_place_by_id,
    admin_list_place_countries,
    admin_list_place_events,
    admin_list_place_external_ids,
    admin_list_place_owners,
    admin_list_places,
    admin_patch_place,
    admin_restore_place,
    admin_revoke_place_owner,
    admin_soft_delete_place,
    admin_unlink_place_external,
)
from app.modules.admin.places.schemas import (
    PlaceAdminPatch,
    PlaceAdminRead,
    PlaceDeleteRequest,
    PlaceEventRead,
    PlaceExternalIdAdminRead,
    PlaceIngestRequest,
    PlaceIngestResponse,
    PlaceLinkExternalRequest,
    PlaceLinkExternalResponse,
    PlaceOwnerAdminRead,
    PlaceOwnerRevokeRequest,
    PlaceResyncResponse,
    PlaceRestoreRequest,
    PlaceUnlinkExternalRequest,
)
from app.modules.places.enums import ExternalIdProvider
from app.modules.places.ingest import (
    ingest_google_place,
    link_google_place_to_existing,
    resync_google_place,
)
from app.modules.users.enums import UserRole

from sqlalchemy.orm import Session


router = APIRouter(prefix="/admin/places", tags=["admin: places"])

# NOTE: Admin places endpoints return `PlaceAdminRead` (not the public
# `PlaceRead`) because admin UIs need `is_deleted` / `deleted_at` to flip
# between Delete and Restore actions and badge deleted rows. The public
# `/places/{id}` deliberately 404s on soft-deleted rows, so it has no
# reason to expose those fields.

@router.post(
    "/ingest",
    response_model=PlaceIngestResponse,
    status_code=status.HTTP_200_OK,
    summary="Ingest a place from a Google Place ID (idempotent)",
    description=(
        "Pulls Place Details from Google for the given `google_place_id`, "
        "extracts the canonical address fields (city / region / country / "
        "postal_code / timezone), and upserts a Place row tied to that "
        "Google ID. Idempotent on the Google ID — re-ingesting refreshes "
        "the canonical fields. Used by both the admin 'New place' modal "
        "and the owner-portal claim flow's Google fallback (which calls "
        "this server-side before creating the claim)."
    ),
    # Document every error shape the admin panel needs to branch on. Each
    # entry points at the shared ``ErrorResponse`` envelope and carries a
    # concrete example so Swagger UI + the admin repo's codegen both see
    # the exact ``code`` values this route can emit.
    responses={
        401: {
            "model": ErrorResponse,
            "description": "X-User-Id header is missing or invalid.",
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "UNAUTHORIZED",
                            "message": "Missing X-User-Id header",
                        }
                    }
                }
            },
        },
        403: {
            "model": ErrorResponse,
            "description": "Caller is authenticated but not an admin.",
            "content": {
                "application/json": {
                    "example": {
                        "error": {"code": "FORBIDDEN", "message": "Forbidden"}
                    }
                }
            },
        },
        404: {
            "model": ErrorResponse,
            "description": (
                "Google Places returned NOT_FOUND or ZERO_RESULTS for the"
                " supplied google_place_id. Typically means the ID is stale"
                " or was typed incorrectly; the admin panel surfaces this"
                " in a toast rather than creating a ghost Place."
            ),
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "GOOGLE_PLACE_NOT_FOUND",
                            "message": (
                                "Google Places returned NOT_FOUND for"
                                " place_id 'ChIJxxxxxxxx'"
                            ),
                        }
                    }
                }
            },
        },
        422: {
            "model": ErrorResponse,
            "description": (
                "Request body failed Pydantic validation — missing"
                " google_place_id or extra fields. PlaceIngestRequest uses"
                " extra='forbid', so unknown keys reject instead of being"
                " silently dropped."
            ),
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "VALIDATION_ERROR",
                            "message": "Request validation failed",
                            "detail": [
                                {
                                    "loc": ["body", "google_place_id"],
                                    "msg": "Field required",
                                    "type": "missing",
                                }
                            ],
                        }
                    }
                }
            },
        },
    },
)
def ingest_place_admin(
    payload: PlaceIngestRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> PlaceIngestResponse:
    """Create-or-find a Place from a Google Place ID.

    The admin UI obtains ``google_place_id`` via the browser-side Places
    Autocomplete widget, then POSTs just that ID here. This endpoint does the
    server-side Place Details call (keeping the billed API key out of the
    browser), extracts canonical fields, and persists the Place + provider
    link + audit event in a single transaction.

    Idempotent on ``(GOOGLE, google_place_id)``: repeated calls for the same
    Google Place return the existing Place with ``existed=true``. If that
    existing Place has been soft-deleted, ``was_deleted=true`` lets the UI
    offer a Restore action instead of silently creating a duplicate.
    """
    result = ingest_google_place(
        db,
        google_place_id=payload.google_place_id,
        actor_user_id=user.id,
    )
    return PlaceIngestResponse(
        place=PlaceAdminRead.model_validate(result.place),
        existed=result.existed,
        was_deleted=result.was_deleted,
    )


@router.post(
    "/{place_id}/link-external",
    response_model=PlaceLinkExternalResponse,
    status_code=status.HTTP_200_OK,
    summary="Link an existing Place to a Google Place ID",
    description=(
        "Attach a Google Place ID to a Place that was created without "
        "the Google ingest flow. Fetches Place Details server-side and "
        "backfills NULL canonical fields (admin edits are preserved). "
        "Rejects if either side already has a different link (409)."
    ),
    responses={
        401: {
            "model": ErrorResponse,
            "description": "Missing or invalid X-User-Id header.",
        },
        403: {
            "model": ErrorResponse,
            "description": "Caller is authenticated but not an admin.",
        },
        404: {
            "model": ErrorResponse,
            "description": (
                "Either the Place id is unknown (code PLACE_NOT_FOUND), or the"
                " supplied google_place_id wasn't recognized by Google"
                " (code GOOGLE_PLACE_NOT_FOUND)."
            ),
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "GOOGLE_PLACE_NOT_FOUND",
                            "message": (
                                "Google Places returned NOT_FOUND for"
                                " place_id 'ChIJxxxxxxxx'"
                            ),
                        }
                    }
                }
            },
        },
        409: {
            "model": ErrorResponse,
            "description": (
                "Either the Google Place is already linked to a DIFFERENT"
                " Place (code GOOGLE_PLACE_ALREADY_LINKED), or this Place"
                " already has a DIFFERENT Google link"
                " (code PLACE_ALREADY_HAS_GOOGLE_LINK). Linking the exact"
                " same pair that already exists is a 200 with existed=true,"
                " not a 409."
            ),
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "PLACE_ALREADY_HAS_GOOGLE_LINK",
                            "message": (
                                "Place is already linked to Google id"
                                " 'ChIJxxxx'. Unlink first before linking"
                                " to a different Google Place."
                            ),
                        }
                    }
                }
            },
        },
        422: {
            "model": ErrorResponse,
            "description": "Malformed body (missing or unknown fields).",
        },
    },
)
def link_place_external_admin(
    place_id: UUID,
    payload: PlaceLinkExternalRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> PlaceLinkExternalResponse:
    """Attach a Google Place ID to an existing Place.

    Used for places that predate the Google ingest flow (or were added by
    other means that didn't create a provider link). The server:

      1. Validates the place exists.
      2. Rejects if the Google Place is already linked somewhere else, or
         if this Place already has a different Google link (409s).
      3. Fetches Google Place Details server-side (same client as /ingest,
         so the billed API key stays off the browser).
      4. Writes the ``PlaceExternalId`` row and backfills ONLY the canonical
         columns that are currently NULL on the Place — admin edits are
         preserved.
      5. Logs an EDITED event noting which columns got populated.

    The response's ``fields_updated`` list lets the UI surface exactly what
    changed ("Backfilled: city, country_code") instead of a vague toast.
    """
    result = link_google_place_to_existing(
        db,
        place_id=place_id,
        google_place_id=payload.google_place_id,
        actor_user_id=user.id,
    )
    return PlaceLinkExternalResponse(
        place=PlaceAdminRead.model_validate(result.place),
        existed=result.existed,
        fields_updated=result.fields_updated,
    )


@router.get(
    "/{place_id}/external-ids",
    response_model=list[PlaceExternalIdAdminRead],
    summary="List provider links (Google, etc.) for a place",
    responses={
        401: {"model": ErrorResponse, "description": "Missing/invalid X-User-Id."},
        403: {"model": ErrorResponse, "description": "Not an admin."},
        404: {
            "model": ErrorResponse,
            "description": "No place with this id exists.",
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "PLACE_NOT_FOUND",
                            "message": "Place not found",
                        }
                    }
                }
            },
        },
    },
)
def list_place_external_ids_admin(
    place_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[PlaceExternalIdAdminRead]:
    """List the external-provider links attached to a place.

    Admin UI renders one row per link (Google today; others later) with
    last-synced context and Resync / Unlink actions. Empty list is a
    valid response — the place simply has no provider links yet.

    Works on soft-deleted places too, so an admin triaging a restore can
    see provider context before deciding.
    """
    rows = admin_list_place_external_ids(db, place_id=place_id)
    return [PlaceExternalIdAdminRead.model_validate(r) for r in rows]


@router.delete(
    "/{place_id}/external-ids/{provider}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a provider link from a place",
    responses={
        401: {"model": ErrorResponse, "description": "Missing/invalid X-User-Id."},
        403: {"model": ErrorResponse, "description": "Not an admin."},
        404: {
            "model": ErrorResponse,
            "description": (
                "Either the place id is unknown (PLACE_NOT_FOUND) or the"
                " place has no link for the requested provider"
                " (EXTERNAL_ID_NOT_FOUND)."
            ),
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "EXTERNAL_ID_NOT_FOUND",
                            "message": "Place has no GOOGLE link to unlink",
                        }
                    }
                }
            },
        },
        422: {
            "model": ErrorResponse,
            "description": "Reason failed validation (too short or too long).",
        },
    },
)
def unlink_place_external_admin(
    place_id: UUID,
    provider: ExternalIdProvider,
    payload: PlaceUnlinkExternalRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> None:
    """Remove a provider link from a place.

    Logs an EDITED audit event with an optional reason. Clears
    ``canonical_source`` on the place iff it was pointing at the
    provider being unlinked — that's what makes "Link to Google"
    reappear in the admin UI after an unlink.

    Canonical backfilled fields (city/region/etc.) are NOT touched;
    they're still valid data points even without the provider link, and
    wiping them would feel destructive. Admins who want to clear them
    can patch the place directly.
    """
    admin_unlink_place_external(
        db,
        place_id=place_id,
        provider=provider,
        actor_user_id=user.id,
        reason=payload.reason if payload else None,
    )
    return None


@router.post(
    "/{place_id}/resync",
    response_model=PlaceResyncResponse,
    status_code=status.HTTP_200_OK,
    summary="Re-pull canonical fields from the linked Google Place",
    responses={
        401: {"model": ErrorResponse, "description": "Missing/invalid X-User-Id."},
        403: {"model": ErrorResponse, "description": "Not an admin."},
        404: {
            "model": ErrorResponse,
            "description": (
                "Either the place id is unknown (PLACE_NOT_FOUND) or the"
                " linked Google place was not found by Google"
                " (GOOGLE_PLACE_NOT_FOUND — rare, means the place_id has"
                " been retired upstream)."
            ),
        },
        409: {
            "model": ErrorResponse,
            "description": (
                "Place has no Google link to resync. Use /link-external"
                " to establish one first."
            ),
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "NO_GOOGLE_LINK",
                            "message": (
                                "Place has no Google link to resync."
                                " Use /link-external first."
                            ),
                        }
                    }
                }
            },
        },
    },
)
def resync_place_admin(
    place_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> PlaceResyncResponse:
    """Refresh the Google snapshot for a linked place.

    Updates the cached ``raw_data`` + ``last_synced_at`` on the existing
    PlaceExternalId row, then backfills any canonical columns on the
    Place that are still NULL. Admin-set values are preserved — resync
    is strictly additive today. Overwrite-mode is a future feature.
    """
    result = resync_google_place(db, place_id=place_id, actor_user_id=user.id)
    return PlaceResyncResponse(
        place=PlaceAdminRead.model_validate(result.place),
        fields_updated=result.fields_updated,
    )


@router.get(
    "",
    response_model=list[PlaceAdminRead],
    summary="List places (admin view) with search + filters",
    description=(
        "Admin places browse. Supports text search (`q`), country and "
        "city filters, soft-delete inclusion, ordering by name / city / "
        "country / updated_at, and pagination. Returns the admin shape "
        "(includes is_deleted / deleted_at) so the panel can flip "
        "Delete/Restore actions per row."
    ),
)
def list_places_admin(
    # "include deleted?" flag. Defaults to false so an unqualified browse
    # returns only active places.
    deleted: str = Query("false", pattern="^(true|false|all)$"),
    # Text search (ILIKE on name + address) — same param as before.
    q: str | None = Query(default=None, max_length=255),
    # City ILIKE + country exact match. Both optional; admin UI can stack
    # them with q for "halal in Brooklyn, US" style browsing.
    city: str | None = Query(default=None, max_length=255),
    country: str | None = Query(
        default=None,
        max_length=2,
        description="ISO-2 country code (e.g. US, GB). Case-insensitive.",
    ),
    # Sort key. Regex-validated against the known set so a typo 422s
    # instead of silently falling back to the default — admins see their
    # bug, not a confusing result. Note: ``created_at`` is NOT a valid
    # value — see Place model + schemas for the "PlaceEvent.CREATED row
    # is the source of truth for ingest time" rationale.
    order_by: str = Query(
        default="updated_at",
        pattern="^(updated_at|name|city|country)$",
    ),
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[PlaceAdminRead]:
    return admin_list_places(
        db,
        deleted=deleted,
        q=q,
        city=city,
        country=country,
        order_by=order_by,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/countries",
    response_model=list[str],
    summary="List distinct country codes present in the catalog",
    responses={
        401: {"model": ErrorResponse, "description": "Missing/invalid X-User-Id."},
        403: {"model": ErrorResponse, "description": "Not an admin."},
    },
)
def list_place_countries_admin(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[str]:
    """Distinct ISO-2 country codes present in the catalog.

    Feeds the admin filter dropdown so the options reflect actual data
    (no "France" in the dropdown when the catalog is US/GB only). Sorted
    alphabetically; soft-deleted places included, NULL codes excluded.
    """
    return admin_list_place_countries(db)


@router.get(
    "/{place_id}/events",
    response_model=list[PlaceEventRead],
    summary="List the audit-event history for a place",
    description="Includes EDITED, DELETED, RESTORED, LINKED, etc. Newest first.",
)
def list_place_events_admin(
    place_id: UUID,
    limit: int = Query(50, gt=0, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[PlaceEventRead]:
    return admin_list_place_events(db, place_id=place_id, limit=limit, offset=offset)


@router.get(
    "/{place_id}/owners",
    response_model=list[PlaceOwnerAdminRead],
    summary="List organizations that own a place",
    description=(
        "Joins the `place_owners` rows with the owning organization "
        "and surfaces the active-member count. Sorted ACTIVE-first so "
        "current ownership shows above historical / pending links."
    ),
    responses={
        401: {
            "model": ErrorResponse,
            "description": "Missing or invalid X-User-Id header.",
        },
        403: {
            "model": ErrorResponse,
            "description": "Caller is authenticated but not an admin.",
        },
        404: {
            "model": ErrorResponse,
            "description": "No place with this id exists (even in the soft-deleted set).",
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "PLACE_NOT_FOUND",
                            "message": "Place not found",
                        }
                    }
                }
            },
        },
    },
)
def list_place_owners_admin(
    place_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> list[PlaceOwnerAdminRead]:
    """List organization ownership links for a place.

    Returns every ``place_owners`` row for the given place, joined with
    the owning organization and the org's active-member count. Sorted
    ACTIVE-first so the admin UI shows "who's running this today" before
    historical or pending links.

    Empty list is a valid response — the place simply has no owners yet.
    Soft-deleted places still resolve here; the admin needs to see
    ownership context when triaging restore decisions.
    """
    return admin_list_place_owners(db, place_id=place_id)


@router.delete(
    "/{place_id}/owners/{owner_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a place's organization ownership (soft-unlink)",
    description=(
        "Flips the PlaceOwner row to REVOKED rather than deleting it. "
        "The place becomes eligible for a fresh live owner; the "
        "historical row survives in the audit trail. Optional reason "
        "rides into the EDITED PlaceEvent. Idempotent."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Missing/invalid X-User-Id."},
        403: {"model": ErrorResponse, "description": "Not an admin."},
        404: {
            "model": ErrorResponse,
            "description": (
                "Either the place id is unknown (PLACE_NOT_FOUND) or the"
                " owner_id isn't a PlaceOwner row for this place"
                " (OWNERSHIP_NOT_FOUND). Requiring both guards against"
                " typoing the place_id in the URL and accidentally"
                " revoking an ownership row on a different place."
            ),
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "OWNERSHIP_NOT_FOUND",
                            "message": (
                                "No ownership link with this id on this place"
                            ),
                        }
                    }
                }
            },
        },
        422: {
            "model": ErrorResponse,
            "description": "Reason failed validation (too short or too long).",
        },
    },
)
def revoke_place_owner_admin(
    place_id: UUID,
    owner_id: UUID,
    payload: PlaceOwnerRevokeRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> None:
    """Revoke a place's ownership relationship.

    Soft-unlink: flips the ``PlaceOwner.status`` to ``REVOKED`` rather
    than deleting the row. The schema's partial unique index on
    ``place_id WHERE status IN ('PENDING','ACTIVE','VERIFIED')``
    excludes REVOKED, so the place becomes eligible for a fresh live
    owner after this action — and the historical row survives so
    "Acme Inc used to own this place" remains answerable from the
    event history.

    Optional ``reason`` body flows to the EDITED PlaceEvent message
    alongside the org name + role + prior status.

    Idempotent: revoking an already-REVOKED owner is a 204 no-op (no
    new event logged).
    """
    admin_revoke_place_owner(
        db,
        place_id=place_id,
        owner_id=owner_id,
        actor_user_id=user.id,
        reason=payload.reason if payload else None,
    )
    return None


@router.get(
    "/{place_id}",
    response_model=PlaceAdminRead,
    summary="Get a place (admin view, includes soft-deleted)",
)
def get_place_admin(
    place_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> PlaceAdminRead:
    return admin_get_place_by_id(db, place_id=place_id)


@router.post(
    "/{place_id}/restore",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Restore a soft-deleted place",
    description=(
        "Idempotent — restoring an already-live place is a 204 no-op. "
        "Optional reason flows into the RESTORED audit event."
    ),
    responses={
        401: {
            "model": ErrorResponse,
            "description": "Missing or invalid X-User-Id header.",
        },
        403: {
            "model": ErrorResponse,
            "description": "Caller is authenticated but not an admin.",
        },
        404: {
            "model": ErrorResponse,
            "description": "No place with this id exists.",
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "PLACE_NOT_FOUND",
                            "message": "Place not found",
                        }
                    }
                }
            },
        },
        422: {
            "model": ErrorResponse,
            "description": "Reason failed validation (too short or too long).",
        },
    },
)
def restore_place(
    place_id: UUID,
    # Body optional so existing restore callers (no body) keep working.
    # When provided, the reason is surfaced in the event history.
    payload: PlaceRestoreRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> None:
    """Restore a soft-deleted place.

    Accepts an optional ``reason`` that's logged alongside the RESTORED
    event. Idempotent: restoring a live place is a no-op (no new event
    row, no error), regardless of reason.
    """
    admin_restore_place(
        db,
        place_id=place_id,
        actor_user_id=user.id,
        reason=payload.reason if payload else None,
    )
    return None


@router.patch(
    "/{place_id}",
    response_model=PlaceAdminRead,
    summary="Edit a place (canonical fields, admin-only)",
)
def patch_place(
    place_id: UUID,
    payload: PlaceAdminPatch,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> PlaceAdminRead:
    return admin_patch_place(db, place_id=place_id, patch=payload, actor_user_id=user.id)


@router.delete(
    "/{place_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a place",
    description=(
        "Marks the place deleted and records the optional reason on the "
        "DELETED audit event. The public `/places/{id}` endpoint will "
        "404 on it; admin views still surface it (with `is_deleted: "
        "true`). Use `/admin/places/{id}/restore` to undo."
    ),
    responses={
        401: {
            "model": ErrorResponse,
            "description": "Missing or invalid X-User-Id header.",
        },
        403: {
            "model": ErrorResponse,
            "description": "Caller is authenticated but not an admin.",
        },
        404: {
            "model": ErrorResponse,
            "description": "No place with this id exists.",
            "content": {
                "application/json": {
                    "example": {
                        "error": {
                            "code": "PLACE_NOT_FOUND",
                            "message": "Place not found",
                        }
                    }
                }
            },
        },
        422: {
            "model": ErrorResponse,
            "description": "Reason failed validation (too short or too long).",
        },
    },
)
def delete_place(
    place_id: UUID,
    # Body is optional so existing DELETE callers (without a body) keep
    # working. When provided, the reason is surfaced in the event history.
    payload: PlaceDeleteRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> None:
    """Soft-delete a place.

    Accepts an optional ``reason`` that's logged to the place's event
    history alongside the DELETED event. The reason is free text; the
    admin UI strongly encourages one but nothing enforces it server-side
    (keeps scripts and Bruno collections backward-compatible).

    Idempotent: deleting an already-deleted place is a no-op (no new
    event row, no error).
    """
    admin_soft_delete_place(
        db,
        place_id=place_id,
        actor_user_id=user.id,
        reason=payload.reason if payload else None,
    )
    return None
