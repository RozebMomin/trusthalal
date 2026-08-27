"""Admin-side repo for verification-visit review.

Owns the queue list, single-row read, and the two terminal
transitions:

  * ACCEPT — admin agrees with the visit. Promotes the place's
             halal_profile.validation_tier to TRUST_HALAL_VERIFIED if
             a profile exists and isn't already at the top tier.
             Always refreshes the profile's last_verified_at to the
             visit's visited_at (the visit IS the verification, even
             if the tier was already verified). Writes a
             ``VERIFIER_VISIT_ACCEPTED`` row to halal_profile_events
             AND a cross-write to place_events.
  * REJECT — admin disagrees / insufficient evidence. No profile
             change. Cross-writes a place_event so the audit trail
             captures it.

Acceptance only makes sense when the place HAS a HalalProfile. A
verifier can't promote thin air; a place with no profile means no
owner has filed an approved halal claim yet, and the verifier is in
front of the wrong workflow. We surface ``VERIFICATION_VISIT_NO_PROFILE``
so admin can either reject the visit (if the verifier was off-base)
or wait for an owner claim.

The whole acceptance path runs in one transaction. Rejection is
trivially atomic.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from app.core.analytics import track
from app.core.exceptions import ConflictError, NotFoundError
from app.core.storage import StorageClient, StorageError
from app.modules.halal_profiles.enums import (
    AlcoholPolicy,
    HalalProfileEventType,
    MenuPosture,
    SlaughterMethod,
    ValidationTier,
    ZabihahStatus,
)
from app.modules.halal_profiles.models import HalalProfile, HalalProfileEvent
from app.modules.places.enums import (
    HERO_ELIGIBLE_SOURCES,
    PlaceEventType,
    PlacePhotoSource,
)
from app.modules.places.models import Place, PlaceMeatVerification, PlacePhoto
from app.modules.places.photos.repo import has_active_hero_for_place
from app.modules.places.photos.processor import ImageProcessingError, process_image
from app.modules.places.repo import log_place_event
from app.modules.suppliers.enums import LinkSource, SourcingEvidence
from app.modules.suppliers.models import PlaceSupplierLink
from app.modules.suppliers.repo import (
    fill_profile_method_from_supplier,
    match_supplier_product,
)
from app.modules.users.models import User
from app.modules.verifiers.enums import VerificationVisitStatus
from app.modules.verifiers.models import VerificationVisit, VerificationVisitNote
from app.modules.verifiers.schemas import (
    VerificationVisitDecision,
    VisitNoteRead,
)

logger = logging.getLogger(__name__)


# Statuses an admin can act on. Once ACCEPTED / REJECTED / WITHDRAWN,
# the row is terminal.
_DECIDABLE_STATUSES: tuple[str, ...] = (
    VerificationVisitStatus.SUBMITTED.value,
    VerificationVisitStatus.UNDER_REVIEW.value,
)


def admin_list_visit_notes(db: Session, *, visit_id: UUID) -> list[VisitNoteRead]:
    """The visit's admin note log, newest first, with each author resolved."""
    admin_get_visit(db, visit_id=visit_id)  # 404 if the visit is missing
    rows = db.execute(
        select(VerificationVisitNote, User.display_name, User.email)
        .outerjoin(User, User.id == VerificationVisitNote.author_user_id)
        .where(VerificationVisitNote.visit_id == visit_id)
        .order_by(VerificationVisitNote.created_at.desc())
    ).all()
    return [
        VisitNoteRead(
            id=note.id,
            body=note.body,
            created_at=note.created_at,
            author_name=display_name,
            author_email=email,
        )
        for note, display_name, email in rows
    ]


def admin_add_visit_note(
    db: Session, *, visit_id: UUID, author_user_id: UUID, body: str
) -> VisitNoteRead:
    """Append one admin note to a visit's log."""
    admin_get_visit(db, visit_id=visit_id)  # 404 if the visit is missing
    note = VerificationVisitNote(
        visit_id=visit_id, author_user_id=author_user_id, body=body.strip()
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    author = db.get(User, author_user_id)
    return VisitNoteRead(
        id=note.id,
        body=note.body,
        created_at=note.created_at,
        author_name=author.display_name if author else None,
        author_email=author.email if author else None,
    )


def admin_get_visit(db: Session, *, visit_id: UUID) -> VerificationVisit:
    row = db.execute(
        select(VerificationVisit).where(VerificationVisit.id == visit_id)
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "VERIFICATION_VISIT_NOT_FOUND",
            "Verification visit not found.",
        )
    return row


def admin_list_visits(
    db: Session,
    *,
    status: VerificationVisitStatus | None,
    place_id: UUID | None,
    verifier_user_id: UUID | None,
    limit: int,
    offset: int,
) -> Sequence[VerificationVisit]:
    """Newest-first queue with optional filters.

    Status filter is the most common — admin defaults to SUBMITTED
    to focus on actionable rows. Place + verifier filters support
    "show me everything for this place" and "show me everything
    from this verifier" pivots.
    """
    stmt = select(VerificationVisit).order_by(
        VerificationVisit.submitted_at.desc()
    )
    if status is not None:
        stmt = stmt.where(VerificationVisit.status == status.value)
    if place_id is not None:
        stmt = stmt.where(VerificationVisit.place_id == place_id)
    if verifier_user_id is not None:
        stmt = stmt.where(
            VerificationVisit.verifier_user_id == verifier_user_id
        )
    stmt = stmt.limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def admin_mark_under_review(
    db: Session, *, visit_id: UUID, decided_by_user_id: UUID
) -> VerificationVisit:
    """Move a SUBMITTED visit to UNDER_REVIEW.

    Idempotent against already-UNDER_REVIEW. Anything else (decided
    or withdrawn) gets a 409. Used by the admin UI to claim a row
    so other admins know it's being looked at.
    """
    visit = admin_get_visit(db, visit_id=visit_id)
    if visit.status == VerificationVisitStatus.UNDER_REVIEW.value:
        return visit
    if visit.status != VerificationVisitStatus.SUBMITTED.value:
        raise ConflictError(
            "VERIFICATION_VISIT_NOT_DECIDABLE",
            (
                f"Visit is in status {visit.status}; only SUBMITTED "
                "visits can be claimed for review."
            ),
        )
    visit.status = VerificationVisitStatus.UNDER_REVIEW.value
    db.commit()
    db.refresh(visit)
    return visit


def admin_decide_visit(
    db: Session,
    *,
    visit_id: UUID,
    payload: VerificationVisitDecision,
    decided_by_user_id: UUID,
    evidence_storage: StorageClient | None = None,
    photos_storage: StorageClient | None = None,
    certs_storage: StorageClient | None = None,
) -> VerificationVisit:
    """Apply an admin decision (ACCEPTED or REJECTED).

    All effects run inside one transaction so the visit, profile,
    profile-event, and place-events flip atomically. On acceptance, the
    optional storage clients let the verifier's tagged photos publish
    (Menu/Meal → gallery, Cert → profile cert); when unset the publish is
    skipped (best-effort).
    """
    decision = payload.decision

    if decision not in (
        VerificationVisitStatus.ACCEPTED,
        VerificationVisitStatus.REJECTED,
    ):
        raise ConflictError(
            "VERIFICATION_VISIT_INVALID_DECISION",
            "Decision must be ACCEPTED or REJECTED.",
        )

    if decision == VerificationVisitStatus.REJECTED and not (
        payload.decision_note and payload.decision_note.strip()
    ):
        raise ConflictError(
            "VERIFICATION_VISIT_REJECT_NOTE_REQUIRED",
            "Rejecting a visit requires a decision_note.",
        )

    visit = admin_get_visit(db, visit_id=visit_id)
    if visit.status not in _DECIDABLE_STATUSES:
        raise ConflictError(
            "VERIFICATION_VISIT_NOT_DECIDABLE",
            (
                f"Visit is in status {visit.status}; only SUBMITTED or "
                "UNDER_REVIEW visits can be decided."
            ),
        )

    now = datetime.now(timezone.utc)

    if decision == VerificationVisitStatus.ACCEPTED:
        _apply_acceptance(
            db,
            visit=visit,
            decided_by_user_id=decided_by_user_id,
            now=now,
            evidence_storage=evidence_storage,
            photos_storage=photos_storage,
            certs_storage=certs_storage,
        )
    else:
        _apply_rejection(
            db,
            visit=visit,
            decided_by_user_id=decided_by_user_id,
            decision_note=payload.decision_note,
        )

    visit.status = decision.value
    visit.decided_at = now
    visit.decided_by_user_id = decided_by_user_id
    visit.decision_note = payload.decision_note

    db.commit()
    db.refresh(visit)
    return visit


# Verifier finding → profile slaughter column. The verifier records the
# observable method (hand vs machine) so it maps 1:1 to the neutral profile
# vocabulary. ZABIHAH/NOT_ZABIHAH are legacy values from older visits, folded
# onto the observable equivalents. UNSURE means the protein IS served but the
# method couldn't be confirmed on the spot → NOT_DISCLOSED (NOT the same as
# NOT_SERVED, which means the place doesn't carry it at all).
# Poultry (chicken/turkey/duck): the hand/machine axis. ZABIHAH/NOT_ZABIHAH
# would only arrive here for a poultry line from a stale client; fold them onto
# the observable equivalent. UNSURE (served, method unconfirmed) → NOT_DISCLOSED.
_FINDING_TO_SLAUGHTER = {
    "HAND_CUT": SlaughterMethod.HAND_CUT,
    "MACHINE_CUT": SlaughterMethod.MACHINE_CUT,
    "ZABIHAH": SlaughterMethod.HAND_CUT,
    "NOT_ZABIHAH": SlaughterMethod.MACHINE_CUT,
    "NOT_SERVED": SlaughterMethod.NOT_SERVED,
    "UNSURE": SlaughterMethod.NOT_DISCLOSED,
}

# Red meat (beef/lamb/goat): the zabihah attribution axis. Handles both the new
# capture vocab (ZABIHAH/NOT_ZABIHAH) and the transitional hand/machine one a
# not-yet-updated client still sends — any prior positive method reads as
# ZABIHAH (locked backfill rule), so a red-meat finding never loses its signal.
_FINDING_TO_ZABIHAH = {
    "ZABIHAH": ZabihahStatus.ZABIHAH,
    "HAND_CUT": ZabihahStatus.ZABIHAH,
    "MACHINE_CUT": ZabihahStatus.ZABIHAH,
    "NOT_ZABIHAH": ZabihahStatus.NOT_ZABIHAH,
    "NOT_SERVED": ZabihahStatus.NOT_SERVED,
    "UNSURE": ZabihahStatus.UNSURE,
}
# The label the verifier flow writes the "menu fully halal" answer under.
_MENU_CHECK_KEY = "Menu is fully halal"
_CERT_CHECK_KEY = "Halal cert visible on premises"
_ALCOHOL_CHECK_KEY = "Alcohol on premises"


# Poultry meats → their slaughter column; red meats → their zabihah column.
# Which axis a meat uses is fixed by species (see the two mapping tables above).
_POULTRY_COLUMNS = (("CHICKEN", "chicken_slaughter"),)
_REDMEAT_COLUMNS = (
    ("BEEF", "beef_zabihah"),
    ("LAMB", "lamb_zabihah"),
    ("GOAT", "goat_zabihah"),
)

# Amenity observation code → profile column.
_AMENITY_COLUMNS = (
    ("PRAYER_SPACE", "prayer_space"),
    ("WUDU", "wudu"),
    ("BIDET", "bidet"),
    ("BABY_CHANGING", "baby_changing"),
)


def _apply_amenities(db: Session, *, place_id: uuid.UUID, obs: dict) -> None:
    """Roll the visit's amenity observations onto the PLACE (amenities live on
    the place now, not the profile). Only sets the ones the visit actually
    recorded (latest-wins; a visit that skipped an amenity doesn't wipe a prior
    reading)."""
    amenities = obs.get("amenities") or {}
    to_set = {col: amenities.get(code) for code, col in _AMENITY_COLUMNS if amenities.get(code)}
    if not to_set:
        return
    place = db.get(Place, place_id)
    if place is None:
        return
    for col, val in to_set.items():
        setattr(place, col, val)


# Each "_opt" helper returns None when the visit didn't record that field, so
# a refresh can update *only* what was observed and leave the rest intact
# (a visit that only touched chicken must not wipe a previously-recorded beef).
def _menu_posture_opt(checks: dict, menu_partial: dict | None) -> MenuPosture | None:
    ans = checks.get(_MENU_CHECK_KEY)
    if ans == "YES":
        return MenuPosture.FULLY_HALAL
    if ans == "PARTIAL":
        scope = (menu_partial or {}).get("scope")
        if scope == "ON_REQUEST":
            return MenuPosture.HALAL_UPON_REQUEST
        return MenuPosture.HALAL_OPTIONS_ADVERTISED
    return None


def _alcohol_opt(checks: dict) -> AlcoholPolicy | None:
    ans = checks.get(_ALCOHOL_CHECK_KEY)
    if ans == "YES":
        return AlcoholPolicy.FULL_BAR
    if ans == "PARTIAL":
        return AlcoholPolicy.BEER_AND_WINE_ONLY
    if ans == "NO":
        return AlcoholPolicy.NONE
    return None


def _cert_opt(checks: dict) -> bool | None:
    ans = checks.get(_CERT_CHECK_KEY)
    return None if ans is None else ans == "YES"


def _finding_of(meat_checks: dict, key: str) -> str | None:
    mc = meat_checks.get(key)
    if not isinstance(mc, dict):
        return None
    return mc.get("finding")


def _meat_slaughter_opt(meat_checks: dict, key: str) -> str | None:
    """Poultry: finding → SlaughterMethod value, or None if unrecorded."""
    finding = _finding_of(meat_checks, key)
    if finding is None:
        return None
    return _FINDING_TO_SLAUGHTER.get(finding, SlaughterMethod.NOT_SERVED).value


def _meat_zabihah_opt(meat_checks: dict, key: str) -> str | None:
    """Red meat: finding → ZabihahStatus value, or None if unrecorded."""
    finding = _finding_of(meat_checks, key)
    if finding is None:
        return None
    return _FINDING_TO_ZABIHAH.get(finding, ZabihahStatus.UNSURE).value


def _bootstrap_profile_from_visit(
    db: Session,
    *,
    visit: VerificationVisit,
    decided_by_user_id: UUID,
) -> HalalProfile:
    """Create a halal profile for a place that had none, from the visit's
    observations. Community-verification path: a verifier confirming a place
    in person is enough to establish its profile (there may be no owner). No
    ``source_claim_id`` — the absence of a claim is what marks it
    verifier-established; the trust history's VERIFIER_VISIT row carries the
    who/when. Unrecorded fields fall back to sensible defaults.
    """
    obs = visit.observations or {}
    checks = obs.get("checks") or {}
    meat_checks = obs.get("meat_checks") or {}

    profile = HalalProfile(
        place_id=visit.place_id,
        source_claim_id=None,
        validation_tier=ValidationTier.TRUST_HALAL_VERIFIED.value,
        menu_posture=(
            _menu_posture_opt(checks, obs.get("menu_partial"))
            or MenuPosture.HALAL_OPTIONS_ADVERTISED
        ).value,
        alcohol_policy=(_alcohol_opt(checks) or AlcoholPolicy.NONE).value,
        chicken_slaughter=_meat_slaughter_opt(meat_checks, "CHICKEN")
        or SlaughterMethod.NOT_SERVED.value,
        # Red meat lands on the zabihah axis; the retained *_slaughter columns
        # keep their NOT_SERVED server-default (unread).
        beef_zabihah=_meat_zabihah_opt(meat_checks, "BEEF") or ZabihahStatus.NOT_SERVED.value,
        lamb_zabihah=_meat_zabihah_opt(meat_checks, "LAMB") or ZabihahStatus.NOT_SERVED.value,
        goat_zabihah=_meat_zabihah_opt(meat_checks, "GOAT") or ZabihahStatus.NOT_SERVED.value,
        has_certification=bool(_cert_opt(checks)),
        last_verified_at=visit.visited_at,
    )
    _apply_amenities(db, place_id=visit.place_id, obs=obs)
    db.add(profile)
    db.flush()  # assign profile.id for the event below
    db.add(
        HalalProfileEvent(
            profile_id=profile.id,
            event_type=HalalProfileEventType.CREATED.value,
            actor_user_id=decided_by_user_id,
            related_claim_id=None,
            description="Profile established from an accepted verifier visit.",
        )
    )
    return profile


def _refresh_profile_from_visit(profile: HalalProfile, visit: VerificationVisit) -> None:
    """Re-apply a verifier's fresh observations onto an existing
    *verifier-established* profile — only the fields the visit actually
    recorded, so a partial visit can't wipe earlier findings. Owner-claim
    profiles are never touched here (a visit confirms the owner's data, it
    doesn't overwrite it)."""
    obs = visit.observations or {}
    checks = obs.get("checks") or {}
    meat_checks = obs.get("meat_checks") or {}

    mp = _menu_posture_opt(checks, obs.get("menu_partial"))
    if mp is not None:
        profile.menu_posture = mp.value
    al = _alcohol_opt(checks)
    if al is not None:
        profile.alcohol_policy = al.value
    cert = _cert_opt(checks)
    if cert is not None:
        profile.has_certification = cert
    for key, attr in _POULTRY_COLUMNS:
        v = _meat_slaughter_opt(meat_checks, key)
        if v is not None:
            setattr(profile, attr, v)
    for key, attr in _REDMEAT_COLUMNS:
        v = _meat_zabihah_opt(meat_checks, key)
        if v is not None:
            setattr(profile, attr, v)
    db = object_session(profile)
    if db is not None:
        _apply_amenities(db, place_id=profile.place_id, obs=obs)


def _stamp_meat_verifications(db: Session, *, visit: VerificationVisit) -> None:
    """Upsert a per-meat verification (place, meat) → verified_at + verifier for
    each meat the verifier gave a DEFINITIVE finding on. UNSURE (looked but
    couldn't confirm) and NOT_SERVED don't count — only meats actually
    confirmed in person. Latest visit wins."""
    obs = visit.observations or {}
    meat_checks = obs.get("meat_checks") or {}
    for meat_key, mc in meat_checks.items():
        if not isinstance(mc, dict):
            continue
        finding = mc.get("finding")
        if finding in (None, "UNSURE", "NOT_SERVED"):
            continue
        existing = db.execute(
            select(PlaceMeatVerification).where(
                PlaceMeatVerification.place_id == visit.place_id,
                PlaceMeatVerification.meat_type == str(meat_key),
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                PlaceMeatVerification(
                    place_id=visit.place_id,
                    meat_type=str(meat_key),
                    verified_at=visit.visited_at,
                    verifier_user_id=visit.verifier_user_id,
                )
            )
        else:
            existing.verified_at = visit.visited_at
            existing.verifier_user_id = visit.verifier_user_id


def _resolve_verifier_suppliers(
    db: Session, *, visit: VerificationVisit, profile: HalalProfile
) -> None:
    """Turn a verifier's free-text suppliers into real provenance.

    A meat can now name several suppliers (parity with the owner's per-product
    sourcing). For EACH named supplier under a meat — the multi-row ``products``
    list plus the legacy single ``supplier_name`` — that matches the registry
    unambiguously, create a VERIFIER_CONFIRMED sourcing link. Multiple links per
    meat are expected. For a meat the verifier left UNSURE, also fill the profile
    column from the first matched supplier's method (gap-fill only — it never
    overrides an explicit hand/machine finding).
    """
    obs = visit.observations or {}
    meat_checks = obs.get("meat_checks") or {}
    for meat_key, _attr in (*_POULTRY_COLUMNS, *_REDMEAT_COLUMNS):
        mc = meat_checks.get(meat_key)
        if not isinstance(mc, dict):
            continue

        # Collect every supplier the verifier named for this meat: the per-
        # product rows first, then the legacy single field.
        names: list[str] = []
        for p in mc.get("products") or []:
            if isinstance(p, dict) and p.get("supplier_name"):
                names.append(p["supplier_name"])
        if mc.get("supplier_name"):
            names.append(mc["supplier_name"])

        is_unsure = mc.get("finding") == "UNSURE"
        filled = False
        seen_products: set = set()
        for supplier_name in names:
            product = match_supplier_product(db, name=supplier_name, meat_type=meat_key)
            if product is None or product.id in seen_products:
                continue
            seen_products.add(product.id)
            # Idempotent: don't stack a second live link to the same product line.
            existing = db.execute(
                select(PlaceSupplierLink).where(
                    PlaceSupplierLink.place_id == visit.place_id,
                    PlaceSupplierLink.supplier_product_id == product.id,
                    PlaceSupplierLink.ended_at.is_(None),
                )
            ).scalar_one_or_none()
            if existing is None:
                db.add(
                    PlaceSupplierLink(
                        place_id=visit.place_id,
                        supplier_product_id=product.id,
                        meat_type=str(meat_key),
                        evidence_tier=SourcingEvidence.VERIFIER_CONFIRMED.value,
                        source=LinkSource.VERIFIER_VISIT.value,
                        source_visit_id=visit.id,
                        note=f"Auto-linked from verifier visit (supplier: {supplier_name}).",
                    )
                )
            # Gap-fill the profile column once, only for an UNSURE meat.
            if is_unsure and not filled:
                fill_profile_method_from_supplier(
                    db,
                    place_id=visit.place_id,
                    meat_type=meat_key,
                    method=str(product.slaughter_method),
                )
                filled = True


# Photo-tag captions the verifier flow writes (see mobile PHOTO_TAGS).
_GALLERY_TAGS = {"menu", "meal"}
_CERT_TAG = "cert"


def _ext_from(filename: str, content_type: str) -> str:
    ext = os.path.splitext(filename or "")[1].lstrip(".").lower()
    if ext:
        return ext
    return {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/heic": "heic",
        "image/heif": "heif",
        "application/pdf": "pdf",
    }.get((content_type or "").lower(), "jpg")


def _copy_attachment_to_gallery(
    db: Session,
    *,
    att,
    place_id: uuid.UUID,
    uploaded_by_user_id,
    evidence_storage: StorageClient,
    photos_storage: StorageClient,
    hero_taken: bool,
) -> tuple[PlacePhoto, bool]:
    """Copy one visit attachment from the private evidence bucket into the
    public place-photos gallery as a VERIFIER photo. Returns the new photo and
    whether it was made the hero (the first gallery photo on a place with no
    hero). Raises on a storage failure — callers decide whether to swallow it."""
    body = evidence_storage.download_bytes(att.storage_path)
    # Run the same pipeline the owner/consumer upload route uses: HEIC→JPEG
    # (iPhone photos are HEIC, which Supabase rejects and browsers can't
    # render), EXIF strip (privacy — phone photos carry GPS), auto-rotate, and
    # downsize. Uploading the raw attachment bytes here was what 400'd the
    # place-photos write.
    processed = process_image(body, source_content_type=att.content_type or "")
    photo_id = uuid.uuid4()
    dest = f"{place_id}/{photo_id}.{processed.extension}"
    photos_storage.upload_bytes(dest, processed.bytes_, content_type=processed.content_type)
    make_hero = not hero_taken
    photo = PlacePhoto(
        id=photo_id,
        place_id=place_id,
        uploaded_by_user_id=uploaded_by_user_id,
        source=PlacePhotoSource.VERIFIER.value,
        storage_path=dest,
        content_type=processed.content_type,
        size_bytes=len(processed.bytes_),
        width_px=processed.width_px,
        height_px=processed.height_px,
        is_hero=make_hero and PlacePhotoSource.VERIFIER in HERO_ELIGIBLE_SOURCES,
    )
    db.add(photo)
    return photo, make_hero


def admin_publish_visit_attachment(
    db: Session,
    *,
    visit_id: UUID,
    attachment_id: UUID,
    evidence_storage: StorageClient | None,
    photos_storage: StorageClient | None,
) -> PlacePhoto:
    """Manually publish a single visit photo into the place gallery.

    A recovery hatch for when the automatic publish-on-accept didn't run (e.g.
    an accept that errored before reaching the copy). Admin picks a specific
    image attachment; it's copied into the public place-photos gallery as a
    VERIFIER photo (becoming the hero if the place has none). Idempotency isn't
    enforced — publishing twice makes two gallery photos — so the UI guards
    against a double tap.
    """
    if evidence_storage is None or photos_storage is None:
        raise ConflictError(
            "PLACE_PHOTOS_STORAGE_UNCONFIGURED",
            "Place-photos storage isn't configured, so photos can't be published.",
        )
    visit = admin_get_visit(db, visit_id=visit_id)
    att = next((a for a in visit.attachments if a.id == attachment_id), None)
    if att is None:
        raise NotFoundError(
            "VERIFICATION_VISIT_ATTACHMENT_NOT_FOUND",
            "Attachment not found on this visit.",
        )
    if not (att.content_type or "").lower().startswith("image/"):
        raise ConflictError(
            "VERIFICATION_VISIT_ATTACHMENT_NOT_IMAGE",
            "Only image attachments can be added to the place gallery.",
        )
    hero_taken = has_active_hero_for_place(db, place_id=visit.place_id)
    try:
        photo, _ = _copy_attachment_to_gallery(
            db,
            att=att,
            place_id=visit.place_id,
            uploaded_by_user_id=visit.verifier_user_id,
            evidence_storage=evidence_storage,
            photos_storage=photos_storage,
            hero_taken=hero_taken,
        )
    except ImageProcessingError as exc:
        raise ConflictError(
            "PLACE_PHOTO_UNREADABLE",
            f"Couldn't read that image. ({exc})",
        )
    except StorageError as exc:
        raise ConflictError(
            "PLACE_PHOTO_PUBLISH_FAILED",
            f"Couldn't publish the photo. ({exc})",
        )
    db.commit()
    db.refresh(photo)
    return photo


def _publish_visit_photos(
    db: Session,
    *,
    visit: VerificationVisit,
    profile: HalalProfile,
    evidence_storage: StorageClient | None,
    photos_storage: StorageClient | None,
    certs_storage: StorageClient | None,
) -> None:
    """On acceptance, copy the verifier's tagged photos out of the private
    evidence bucket:

      * Menu / Meal → public place-photos gallery (a VERIFIER PlacePhoto).
      * Cert → the profile's certificate document (public certs bucket).

    Best-effort throughout: a storage hiccup on one file is logged and
    skipped, never failing the acceptance. Needs ``evidence_storage`` to read
    the source; each destination is independently optional.
    """
    if evidence_storage is None:
        return

    attachments = list(visit.attachments)
    if not attachments:
        return

    place_id = visit.place_id
    hero_taken = has_active_hero_for_place(db, place_id=place_id)
    latest_cert = None  # keep only the newest cert if several were attached

    for att in attachments:
        tag = (att.caption or "").strip().lower()

        # Diagnostic: a gallery-worthy photo that can't publish because the
        # place-photos bucket isn't configured would otherwise fail silently.
        if tag in _GALLERY_TAGS and photos_storage is None:
            logger.warning(
                "Skipping gallery publish of visit attachment %s (tag=%s): "
                "place-photos storage not configured (SUPABASE_PHOTOS_BUCKET).",
                att.id,
                tag,
            )

        if tag in _GALLERY_TAGS and photos_storage is not None:
            try:
                _, made_hero = _copy_attachment_to_gallery(
                    db,
                    att=att,
                    place_id=place_id,
                    uploaded_by_user_id=visit.verifier_user_id,
                    evidence_storage=evidence_storage,
                    photos_storage=photos_storage,
                    hero_taken=hero_taken,
                )
                if made_hero:
                    hero_taken = True
            except Exception:  # noqa: BLE001 — best-effort publish
                logger.warning(
                    "verifier photo publish failed; skipping",
                    extra={"visit_id": str(visit.id), "attachment_id": str(att.id)},
                    exc_info=True,
                )

        elif tag == _CERT_TAG:
            latest_cert = att  # newest wins (attachments are visit-ordered)

    if latest_cert is not None and certs_storage is not None:
        try:
            body = evidence_storage.download_bytes(latest_cert.storage_path)
            ext = _ext_from(latest_cert.original_filename, latest_cert.content_type)
            dest = f"{profile.id}.{ext}"
            try:
                certs_storage.upload_bytes(dest, body, content_type=latest_cert.content_type)
            except Exception:  # noqa: BLE001 — path may already exist; replace
                certs_storage.delete_object(dest)
                certs_storage.upload_bytes(dest, body, content_type=latest_cert.content_type)
            profile.certificate_url = certs_storage.public_url(dest)
            profile.certificate_content_type = latest_cert.content_type
            profile.has_certification = True
        except Exception:  # noqa: BLE001 — best-effort publish
            logger.warning(
                "verifier cert publish failed; skipping",
                extra={"visit_id": str(visit.id)},
                exc_info=True,
            )


def _apply_acceptance(
    db: Session,
    *,
    visit: VerificationVisit,
    decided_by_user_id: UUID,
    now: datetime,
    evidence_storage: StorageClient | None = None,
    photos_storage: StorageClient | None = None,
    certs_storage: StorageClient | None = None,
) -> None:
    """Promote (or establish) the place's profile + write the audit events.

    If the place already has a non-revoked profile, the visit elevates it to
    TRUST_HALAL_VERIFIED and refreshes last_verified_at. If it has none, the
    visit *establishes* one from its observations — community verification
    doesn't wait on an owner claim.
    """
    profile = db.execute(
        select(HalalProfile).where(
            HalalProfile.place_id == visit.place_id,
            HalalProfile.revoked_at.is_(None),
        )
    ).scalar_one_or_none()

    bootstrapped = False
    if profile is None:
        profile = _bootstrap_profile_from_visit(
            db, visit=visit, decided_by_user_id=decided_by_user_id
        )
        bootstrapped = True
    elif profile.source_claim_id is None:
        # Verifier-established profile (no owner claim behind it): let this
        # fresh visit update the observed data — per-meat method, menu posture,
        # alcohol, cert — so re-verifying actually improves the profile instead
        # of only bumping the timestamp. Owner-claim profiles are left as-is.
        _refresh_profile_from_visit(profile, visit)

    # Verifier-established places: resolve any UNSURE meat whose named supplier
    # is in the registry into a real sourcing link + a filled method column.
    if profile.source_claim_id is None:
        _resolve_verifier_suppliers(db, visit=visit, profile=profile)

    previous_tier = profile.validation_tier

    # Always refresh last_verified_at — the visit confirms the
    # current data even if the tier was already at the top.
    profile.last_verified_at = visit.visited_at

    # Per-meat verification recency: stamp each meat the verifier actually
    # confirmed, so the trust profile can say "Beef · verified in person Aug 25"
    # rather than implying the whole kitchen was checked.
    _stamp_meat_verifications(db, visit=visit)

    if bootstrapped:
        description = (
            f"Verifier visit accepted (visit_id={visit.id}); profile "
            f"established at {ValidationTier.TRUST_HALAL_VERIFIED.value} from "
            "the visit."
        )
    elif profile.validation_tier != ValidationTier.TRUST_HALAL_VERIFIED.value:
        profile.validation_tier = ValidationTier.TRUST_HALAL_VERIFIED.value
        description = (
            f"Verifier visit accepted (visit_id={visit.id}); tier "
            f"promoted {previous_tier} → "
            f"{ValidationTier.TRUST_HALAL_VERIFIED.value}."
        )
    else:
        description = (
            f"Verifier visit accepted (visit_id={visit.id}); "
            "last_verified_at refreshed (tier already at top)."
        )

    db.add(
        HalalProfileEvent(
            profile_id=profile.id,
            event_type=HalalProfileEventType.VERIFIER_VISIT_ACCEPTED.value,
            # Attribute the VISITING verifier (the friend who did the visit) —
            # the consumer/mobile timeline resolves this actor into the "Verified
            # by … · <name>" line. NOT decided_by_user_id, which is the admin who
            # merely approved it.
            actor_user_id=visit.verifier_user_id,
            related_claim_id=None,  # the visit isn't a claim
            description=description,
        )
    )

    log_place_event(
        db,
        place_id=visit.place_id,
        event_type=PlaceEventType.VERIFIER_VISIT_ACCEPTED,
        actor_user_id=decided_by_user_id,
        message=description,
    )
    track(
        "verifier_visit_filed",
        distinct_id=visit.verifier_user_id,
        properties={"place_id": str(visit.place_id), "visit_id": str(visit.id)},
    )

    # Publish the verifier's tagged photos: Menu/Meal → public gallery, Cert →
    # profile certificate. Best-effort — never fails the acceptance.
    _publish_visit_photos(
        db,
        visit=visit,
        profile=profile,
        evidence_storage=evidence_storage,
        photos_storage=photos_storage,
        certs_storage=certs_storage,
    )


def _apply_rejection(
    db: Session,
    *,
    visit: VerificationVisit,
    decided_by_user_id: UUID,
    decision_note: str | None,
) -> None:
    """Cross-write a place-event so the place's audit trail captures
    the rejection. No profile changes."""
    log_place_event(
        db,
        place_id=visit.place_id,
        event_type=PlaceEventType.VERIFIER_VISIT_REJECTED,
        actor_user_id=decided_by_user_id,
        message=(
            f"Verifier visit rejected (visit_id={visit.id})"
            + (f": {decision_note}" if decision_note else ".")
        ),
    )
