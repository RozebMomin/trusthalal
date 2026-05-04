"""Test-only factory helpers.

These build domain rows directly via SQLAlchemy models (not the HTTP layer),
so a test can set up prerequisites cheaply without making 5 API calls. All
writes go through ``db.flush()`` rather than ``db.commit()`` — the session
is already inside an outer transaction that rolls back at teardown, so
flushing is enough to make rows visible to subsequent SELECTs.

Unique-ish defaults (random suffixes on emails, place names, etc.) make it
safe to call the same factory twice in a single test without tripping unique
constraints.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass

from geoalchemy2.elements import WKTElement
from sqlalchemy.orm import Session

from app.modules.organizations.enums import OrganizationStatus
from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.ownership_requests.enums import OwnershipRequestStatus
from app.modules.ownership_requests.models import PlaceOwnershipRequest
from app.modules.places.models import Place
from app.modules.users.enums import UserRole
from app.modules.users.models import User


def _short() -> str:
    return uuid.uuid4().hex[:8]


@dataclass
class Factories:
    db: Session

    # ----- Users -----
    def user(
        self,
        *,
        role: UserRole | str = UserRole.CONSUMER,
        email: str | None = None,
        display_name: str | None = None,
        is_active: bool = True,
    ) -> User:
        u = User(
            role=role.value if isinstance(role, UserRole) else role,
            # example.com is IANA-reserved for documentation/testing and
            # passes Pydantic EmailStr's reserved-TLD filter (unlike .test
            # and .local which Pydantic >=2.12 rejects).
            email=email or f"user-{_short()}@example.com",
            display_name=display_name or f"Test User {_short()}",
            is_active=is_active,
        )
        self.db.add(u)
        self.db.flush()
        self.db.refresh(u)
        return u

    def admin(self, **kw) -> User:
        return self.user(role=UserRole.ADMIN, **kw)

    def owner(self, **kw) -> User:
        return self.user(role=UserRole.OWNER, **kw)

    def verifier(self, **kw) -> User:
        return self.user(role=UserRole.VERIFIER, **kw)

    def consumer(self, **kw) -> User:
        return self.user(role=UserRole.CONSUMER, **kw)

    # ----- Places -----
    def place(
        self,
        *,
        name: str | None = None,
        address: str | None = None,
        lat: float = 40.712800,
        lng: float = -74.006000,
    ) -> Place:
        p = Place(
            name=name or f"Test Place {_short()}",
            address=address or "123 Test St",
            lat=lat,
            lng=lng,
            geom=WKTElement(f"POINT({lng} {lat})", srid=4326),
        )
        self.db.add(p)
        self.db.flush()
        self.db.refresh(p)
        return p

    # ----- Organizations -----
    def organization(
        self,
        *,
        name: str | None = None,
        contact_email: str | None = None,
        status: OrganizationStatus | str = OrganizationStatus.VERIFIED,
        created_by: User | None = None,
    ) -> Organization:
        # Default to VERIFIED so existing tests that build orgs to
        # back claims keep passing without each one having to set
        # status explicitly. Tests that exercise the lifecycle pass
        # status=OrganizationStatus.DRAFT etc. directly.
        o = Organization(
            name=name or f"Test Org {_short()}",
            contact_email=contact_email,
            status=status.value if isinstance(status, OrganizationStatus) else status,
            created_by_user_id=(created_by.id if created_by else None),
        )
        self.db.add(o)
        self.db.flush()
        self.db.refresh(o)
        return o

    def org_for_user(
        self,
        *,
        user: User,
        name: str | None = None,
        status: OrganizationStatus | str = OrganizationStatus.VERIFIED,
    ) -> Organization:
        """Create an org with ``user`` as an ACTIVE OWNER_ADMIN member.

        Convenience wrapper for tests that need a "user X has an org"
        precondition without ceremonially calling factories.organization()
        + factories.org_member() back to back. Mirrors the auto-
        membership behavior of the /me/organizations create endpoint.
        """
        org = self.organization(name=name, status=status, created_by=user)
        self.org_member(organization=org, user=user)
        return org

    def place_owner_link(
        self,
        *,
        place: Place,
        organization: Organization,
        role: str = "PRIMARY",
        status: str = "ACTIVE",
    ) -> PlaceOwner:
        link = PlaceOwner(
            place_id=place.id,
            organization_id=organization.id,
            role=role,
            status=status,
        )
        self.db.add(link)
        self.db.flush()
        self.db.refresh(link)
        return link

    def org_member(
        self,
        *,
        organization: Organization,
        user: User,
        role: str = "OWNER_ADMIN",
        status: str = "ACTIVE",
    ) -> OrganizationMember:
        m = OrganizationMember(
            organization_id=organization.id,
            user_id=user.id,
            role=role,
            status=status,
        )
        self.db.add(m)
        self.db.flush()
        self.db.refresh(m)
        return m

    def managed_place(
        self,
        *,
        owner: User,
        place_name: str | None = None,
    ) -> tuple[Place, Organization]:
        """Create a place + org where ``owner`` is an active OWNER_ADMIN,
        and the org is the PlaceOwner.

        Returns (place, organization).
        """
        place = self.place(name=place_name)
        org = self.organization()
        self.place_owner_link(place=place, organization=org)
        self.org_member(organization=org, user=owner)
        return place, org

    # ----- Ownership requests -----
    def ownership_request(
        self,
        *,
        place: Place,
        requester: User | None = None,
        organization: Organization | None = None,
        contact_name: str = "Jane Doe",
        contact_email: str | None = None,
        contact_phone: str | None = "+1-555-0100",
        message: str | None = "I own this restaurant",
        status: OwnershipRequestStatus = OwnershipRequestStatus.SUBMITTED,
    ) -> PlaceOwnershipRequest:
        # ``organization`` is the slice-5b coupling: claims now carry
        # organization_id at submission time. Tests that exercise the
        # legacy (anonymous public submission) path leave it None.
        r = PlaceOwnershipRequest(
            place_id=place.id,
            requester_user_id=(requester.id if requester else None),
            organization_id=(organization.id if organization else None),
            contact_name=contact_name,
            contact_email=contact_email or f"req-{_short()}@example.com",
            contact_phone=contact_phone,
            message=message,
            status=status.value,
        )
        self.db.add(r)
        self.db.flush()
        self.db.refresh(r)
        return r

    # ----- Helpers for backdating -----
    # The legacy ``make_claim_expire_in`` helper was removed alongside
    # the legacy halal_claims schema. Phase 2 adds equivalent helpers
    # for the new HalalClaim model.
