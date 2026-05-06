"""Owner-portal-facing repository helpers for the Organization
self-service flow.

Distinct from ``app/modules/admin/organizations/repo.py``: the admin
repo creates orgs at VERIFIED status (admin trusts itself) and freely
edits any field; this one starts orgs at DRAFT, scopes every read to
the caller's memberships, and gates writes on the verification
status.

Membership model: creating an org auto-inserts the creator as an
``OWNER_ADMIN`` member. Lookups go through the OrganizationMember
join so future multi-member support (a partner LLC, a chain) works
without endpoint changes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from app.modules.organizations.enums import OrganizationStatus
from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
)
from app.modules.organizations.schemas import (
    MyOrganizationCreate,
    MyOrganizationPatch,
)


# Statuses a member can still edit. After admin sign-off the row is
# audit-immutable so reviewer notes don't get yanked out from under
# the verification record.
_EDITABLE_STATUSES = (
    OrganizationStatus.DRAFT.value,
    OrganizationStatus.UNDER_REVIEW.value,
)


def _clean_str(value: str | None) -> str | None:
    """Trim whitespace and collapse the empty string to None.

    Used for the org address fields so a user clearing an input box
    (which yields ``""`` from a form) is treated the same as
    "remove this field" — the column ends up NULL instead of holding
    an empty string. Symmetric with how the place address fields
    handle the same shape.
    """
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def list_organizations_for_user(
    db: Session, *, user_id: UUID
) -> list[Organization]:
    """Every org the user is an ACTIVE member of, newest-first.

    REMOVED memberships are filtered out — those are historical
    audit context, not "the user's current orgs." Powers the owner
    portal's /me/organizations list.
    """
    stmt = (
        select(Organization)
        .join(
            OrganizationMember,
            OrganizationMember.organization_id == Organization.id,
        )
        .where(OrganizationMember.user_id == user_id)
        .where(OrganizationMember.status == "ACTIVE")
        .order_by(Organization.created_at.desc())
    )
    return list(db.execute(stmt).scalars().all())


def get_organization_for_user(
    db: Session, *, organization_id: UUID, user_id: UUID
) -> Organization:
    """Look up an org and verify the caller is an ACTIVE member.

    Splits cleanly into:
      * 404 OWNER_ORGANIZATION_NOT_FOUND — UUID doesn't exist.
      * 403 OWNER_ORGANIZATION_FORBIDDEN — exists but caller isn't a
        member. Same posture as the claim's ownership guard: keeps
        the error grid consistent across owner-facing surfaces.
    """
    org = db.execute(
        select(Organization).where(Organization.id == organization_id)
    ).scalar_one_or_none()
    if org is None:
        raise NotFoundError(
            "OWNER_ORGANIZATION_NOT_FOUND",
            "Organization not found",
        )

    is_member = db.execute(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user_id,
            OrganizationMember.status == "ACTIVE",
        )
    ).scalar_one_or_none()
    if is_member is None:
        raise ForbiddenError(
            "OWNER_ORGANIZATION_FORBIDDEN",
            "You don't have access to this organization.",
        )

    return org


def create_organization_for_user(
    db: Session, *, user_id: UUID, payload: MyOrganizationCreate
) -> Organization:
    """Create a new DRAFT organization and join the creator as
    OWNER_ADMIN in one transaction.

    Same name uniqueness posture as the admin path: not enforced.
    Two unrelated owners can both have orgs called "Khan Halal LLC"
    — they're disambiguated by id, not by name. If that becomes a
    support-ticket pattern we can add a soft warning at the UI level.
    """
    org = Organization(
        name=payload.name.strip(),
        contact_email=(
            str(payload.contact_email).lower() if payload.contact_email else None
        ),
        # Address fields are pass-through. Strip whitespace so a stray
        # newline pasted from a clipboard doesn't end up in the DB.
        # ``country_code`` upper-cased to match the ISO-3166-1 norm we
        # apply on places.
        address=_clean_str(payload.address),
        city=_clean_str(payload.city),
        region=_clean_str(payload.region),
        country_code=(
            payload.country_code.upper() if payload.country_code else None
        ),
        postal_code=_clean_str(payload.postal_code),
        status=OrganizationStatus.DRAFT.value,
        created_by_user_id=user_id,
    )
    db.add(org)
    db.flush()  # need org.id for the membership row

    db.add(
        OrganizationMember(
            organization_id=org.id,
            user_id=user_id,
            role="OWNER_ADMIN",
            status="ACTIVE",
        )
    )
    db.commit()
    db.refresh(org)
    return org


def patch_organization_for_user(
    db: Session,
    *,
    organization_id: UUID,
    user_id: UUID,
    patch: MyOrganizationPatch,
) -> Organization:
    """Partial update. Allowed only while the org is DRAFT or
    UNDER_REVIEW; once VERIFIED / REJECTED, the row is locked.

    ``model_dump(exclude_unset=True)`` distinguishes "absent"
    (don't touch) from "explicit null" (clear). Mirrors the admin
    patch's contract.
    """
    org = get_organization_for_user(
        db, organization_id=organization_id, user_id=user_id
    )

    if org.status not in _EDITABLE_STATUSES:
        raise ConflictError(
            "OWNER_ORGANIZATION_NOT_EDITABLE",
            f"Organizations with status {org.status} can no longer be edited. "
            "Contact Trust Halal support if you need a change.",
        )

    data = patch.model_dump(exclude_unset=True)
    changed = False

    if "name" in data and data["name"] is not None:
        new_name = data["name"].strip()
        if new_name != org.name:
            org.name = new_name
            changed = True

    if "contact_email" in data:
        raw = data["contact_email"]
        new_email = str(raw).lower() if raw is not None else None
        if new_email != org.contact_email:
            org.contact_email = new_email
            changed = True

    # Address fields all share the same null-vs-absent contract. Loop
    # so adding more later (e.g. lat/lng) is one column-name addition,
    # not five copy-pasted blocks.
    for column in ("address", "city", "region", "postal_code"):
        if column in data:
            new_val = _clean_str(data[column])
            if new_val != getattr(org, column):
                setattr(org, column, new_val)
                changed = True

    if "country_code" in data:
        raw = data["country_code"]
        new_country = raw.upper() if raw else None
        if new_country != org.country_code:
            org.country_code = new_country
            changed = True

    if not changed:
        # Same code as the admin path — clients can branch identically.
        raise ConflictError("NO_FIELDS", "No changes detected")

    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def submit_organization_for_review(
    db: Session, *, organization_id: UUID, user_id: UUID
) -> Organization:
    """Move a DRAFT org into UNDER_REVIEW.

    Pre-conditions:
      * Caller is an ACTIVE member of the org (covered by the
        ``get_organization_for_user`` lookup).
      * Org is currently in DRAFT (UNDER_REVIEW resubmits become a
        no-op via the same code; VERIFIED / REJECTED reject with a
        409).
      * At least one attachment uploaded — admin staff can't verify
        a business entity from name alone.

    On success records ``submitted_at`` so the admin queue can sort
    longest-waiting first.
    """
    org = get_organization_for_user(
        db, organization_id=organization_id, user_id=user_id
    )

    if org.status == OrganizationStatus.UNDER_REVIEW.value:
        # Idempotent: already submitted, just return.
        return org

    if org.status != OrganizationStatus.DRAFT.value:
        raise ConflictError(
            "OWNER_ORGANIZATION_NOT_SUBMITTABLE",
            f"Only DRAFT organizations can be submitted for review. "
            f"This one is currently {org.status}.",
        )

    if not org.attachments:
        raise BadRequestError(
            "OWNER_ORGANIZATION_EVIDENCE_REQUIRED",
            "Attach at least one supporting document "
            "(e.g. articles of organization or business filing) "
            "before submitting for review.",
        )

    org.status = OrganizationStatus.UNDER_REVIEW.value
    org.submitted_at = datetime.now(timezone.utc)
    db.add(org)
    db.commit()
    db.refresh(org)
    return org
