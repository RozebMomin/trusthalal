from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.admin.organizations.schemas import (
    MemberAdminCreate,
    OrganizationAdminCreate,
    OrganizationAdminPatch,
)
from app.modules.organizations.enums import OrganizationStatus
from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.places.models import Place
from app.modules.users.models import User


def admin_create_organization(db: Session, payload: OrganizationAdminCreate) -> Organization:
    # Admin-created orgs start at VERIFIED — Trust Halal staff is
    # implicitly trusting itself. The owner-self-service path
    # (slice 5a) is the one that starts at DRAFT.
    org = Organization(
        name=payload.name.strip(),
        contact_email=(str(payload.contact_email).lower() if payload.contact_email else None),
        status=OrganizationStatus.VERIFIED.value,
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def admin_list_organizations(
    db: Session,
    *,
    q: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Organization]:
    """List orgs for the admin browse.

    ``status`` filter accepts any value of OrganizationStatus
    (DRAFT / UNDER_REVIEW / VERIFIED / REJECTED). When set, the
    endpoint becomes a focused queue ("show me everything
    UNDER_REVIEW"); otherwise it returns the full catalog newest-
    first.
    """
    stmt = select(Organization)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(func.lower(Organization.name).like(like))
    if status:
        stmt = stmt.where(Organization.status == status)
    stmt = stmt.order_by(Organization.created_at.desc()).limit(limit).offset(offset)
    return list(db.execute(stmt).scalars().all())


def admin_verify_organization(
    db: Session,
    *,
    org_id: UUID,
    note: str | None,
    actor_user_id: UUID,
) -> Organization:
    """Move an UNDER_REVIEW org → VERIFIED.

    Idempotent on already-VERIFIED is a 409 (NOT_REVIEWABLE) rather
    than a no-op — explicit errors surface stale tabs / double-
    click race conditions to the caller instead of silently
    pretending the action happened.
    """
    org = admin_get_organization(db, org_id)
    if org.status != OrganizationStatus.UNDER_REVIEW.value:
        raise ConflictError(
            "ORGANIZATION_NOT_REVIEWABLE",
            f"Only UNDER_REVIEW organizations can be verified. "
            f"This one is currently {org.status}.",
        )

    org.status = OrganizationStatus.VERIFIED.value
    org.decided_at = datetime.now(timezone.utc)
    org.decided_by_user_id = actor_user_id
    org.decision_note = note.strip() if note else None
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def admin_reject_organization(
    db: Session,
    *,
    org_id: UUID,
    reason: str,
    actor_user_id: UUID,
) -> Organization:
    """Move an UNDER_REVIEW org → REJECTED with a required reason.

    ``reason`` is enforced at the schema layer (min_length=3) so this
    repo helper trusts the input. Same NOT_REVIEWABLE guard as
    verify.
    """
    org = admin_get_organization(db, org_id)
    if org.status != OrganizationStatus.UNDER_REVIEW.value:
        raise ConflictError(
            "ORGANIZATION_NOT_REVIEWABLE",
            f"Only UNDER_REVIEW organizations can be rejected. "
            f"This one is currently {org.status}.",
        )

    org.status = OrganizationStatus.REJECTED.value
    org.decided_at = datetime.now(timezone.utc)
    org.decided_by_user_id = actor_user_id
    org.decision_note = reason.strip()
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def admin_get_organization(db: Session, org_id: UUID) -> Organization:
    org = db.execute(
        select(Organization).where(Organization.id == org_id)
    ).scalar_one_or_none()
    if not org:
        raise NotFoundError("ORGANIZATION_NOT_FOUND", "Organization not found")
    return org


def admin_patch_organization(
    db: Session, *, org_id: UUID, patch: OrganizationAdminPatch
) -> Organization:
    """Partial update for an organization.

    Uses ``model_dump(exclude_unset=True)`` so omitted fields are treated
    as "don't touch." A deliberately-null contact_email clears the field;
    an absent one leaves it alone.
    """
    org = admin_get_organization(db, org_id)
    data = patch.model_dump(exclude_unset=True)

    changed = False
    if "name" in data and data["name"] is not None:
        new_name = data["name"].strip()
        if new_name != org.name:
            org.name = new_name
            changed = True

    if "contact_email" in data:
        # EmailStr objects stringify into the canonical form; normalize
        # to lowercase so lookups are case-stable even if someone
        # typed "Foo@Example.com".
        raw = data["contact_email"]
        new_email = str(raw).lower() if raw is not None else None
        if new_email != org.contact_email:
            org.contact_email = new_email
            changed = True

    if not changed:
        raise ConflictError("NO_FIELDS", "No changes detected")

    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def admin_list_members(db: Session, org_id: UUID) -> list[OrganizationMember]:
    admin_get_organization(db, org_id)  # 404 if missing
    stmt = (
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == org_id)
        .order_by(OrganizationMember.created_at.asc())
    )
    return list(db.execute(stmt).scalars().all())


def admin_add_member(
    db: Session, *, org_id: UUID, payload: MemberAdminCreate
) -> OrganizationMember:
    admin_get_organization(db, org_id)  # 404 if missing

    user = db.execute(select(User).where(User.id == payload.user_id)).scalar_one_or_none()
    if not user:
        raise NotFoundError("USER_NOT_FOUND", "User not found")

    existing = db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == payload.user_id,
        )
    ).scalar_one_or_none()

    if existing:
        # Re-activate if currently deactivated, else 409.
        if existing.status != "ACTIVE":
            existing.status = "ACTIVE"
            existing.role = payload.role
            db.add(existing)
            db.commit()
            db.refresh(existing)
            return existing
        raise ConflictError(
            "ORGANIZATION_MEMBER_EXISTS",
            "User is already a member of this organization",
        )

    member = OrganizationMember(
        organization_id=org_id,
        user_id=payload.user_id,
        role=payload.role,
        status="ACTIVE",
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def admin_deactivate_member(
    db: Session, *, org_id: UUID, user_id: UUID
) -> OrganizationMember:
    member = db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == user_id,
        )
    ).scalar_one_or_none()

    if not member:
        raise NotFoundError(
            "ORGANIZATION_MEMBER_NOT_FOUND", "Member not found in this organization"
        )

    # ``organization_members.status`` is CHECK-constrained to
    # ('ACTIVE','INVITED','REMOVED'); REMOVED is the legitimate
    # "no longer a member" state. Using anything else would 500 the
    # request with a CheckViolation.
    member.status = "REMOVED"
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def admin_list_user_memberships(
    db: Session, *, user_id: UUID
) -> list[tuple[OrganizationMember, Organization]]:
    """Return a user's org memberships + the owning orgs in one query.

    Powers the "Organizations" section on the admin user detail page.
    Includes REMOVED memberships too — seeing historical orgs is useful
    context when triaging a support case ("this user was in Acme until
    last month, now they say they can't access it").

    Soft-filter responsibility stays on the caller: the UI decides
    whether to hide REMOVED rows or badge them.
    """
    # Bail with 404 if the user doesn't exist so the caller can return
    # a clean error rather than an empty list that looks like "no orgs."
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user:
        raise NotFoundError("USER_NOT_FOUND", "User not found")

    stmt = (
        select(OrganizationMember, Organization)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(OrganizationMember.user_id == user_id)
        # Oldest-first: matches the "when did this relationship begin"
        # mental model. If admins ever want most-recent-first, swap here.
        .order_by(OrganizationMember.created_at.asc())
    )
    return list(db.execute(stmt).all())


def admin_list_org_places(
    db: Session, *, org_id: UUID
) -> list[tuple[PlaceOwner, Place]]:
    """Return an org's place-owner links + the places themselves.

    Powers the "Places" section on the admin org detail page. Ordered
    ACTIVE-first (so "places the org runs today" shows up before
    historical REVOKED relationships), with place name as the
    tiebreaker for stable rendering when multiple rows share a status.

    Includes soft-deleted places — admins need to see them here so an
    accidental delete is discoverable from the owning org's page, not
    just from the orphaned /places list.

    Raises NotFoundError if the org doesn't exist; callers surface
    404 from the matching error code.
    """
    # Canonical 404 so an empty list can be distinguished from
    # "unknown org id" — a linting subtlety that matters when this
    # endpoint is exposed via a bookmark or shared URL.
    admin_get_organization(db, org_id)

    active_first = case((PlaceOwner.status == "ACTIVE", 0), else_=1)

    stmt = (
        select(PlaceOwner, Place)
        .join(Place, Place.id == PlaceOwner.place_id)
        .where(PlaceOwner.organization_id == org_id)
        .order_by(active_first, Place.name.asc())
    )
    return list(db.execute(stmt).all())
