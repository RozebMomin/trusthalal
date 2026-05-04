"""Idempotent development seed.

Usage:
    python -m scripts.seed_dev                 # full fixture
    python -m scripts.seed_dev --users-only    # users only, empty catalog

Full mode creates a realistic minimum for exercising every API flow:

    * 4 users: admin, verifier, owner, consumer (deterministic emails)
    * 1 organization with `owner_user` as its OWNER_ADMIN member
    * 5 places across 2 cities, each with a Google place_id external id
    * 1 PlaceOwner link connecting the first place to the organization
    * 4 claims across statuses so the admin queue has variety:
        - first place:  VERIFIED (ZABIHA) with a certificate on file
        - second place: PENDING  (HALAL_CHICKEN_ONLY)
        - fourth place: REJECTED (PORK_FREE)    — for the Rejected filter
        - fifth place:  EXPIRED  (NO_ALCOHOL)   — for the Expired filter
    * 3 ownership requests across statuses:
        - third place:  SUBMITTED       (from the consumer user)
        - fourth place: NEEDS_EVIDENCE  (anonymous submission)
        - fifth place:  UNDER_REVIEW    (from the owner user)

Users-only mode (`--users-only`) creates just the 4 users and stops.
Useful after wiping the DB when you want the admin panel to work
(``NEXT_PUBLIC_DEV_ACTOR_ID`` needs a real admin row) but an otherwise
empty catalog — so you can exercise the Google ingest flow from a
clean slate.

Re-runnable: every upsert looks up by a natural key (email, external_id,
(place_id, claim_type)) before inserting. Prints a summary so you can copy
IDs straight into a request collection or README.

Requires DATABASE_URL to be set in the environment or via .env.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

# Register all models on Base.metadata before any query runs
import app.db.models  # noqa: F401

from app.db.session import SessionLocal
from app.modules.organizations.models import (
    Organization,
    OrganizationMember,
    PlaceOwner,
)
from app.modules.ownership_requests.enums import OwnershipRequestStatus
from app.modules.ownership_requests.models import PlaceOwnershipRequest
from app.modules.places.enums import ExternalIdProvider, PlaceEventType
from app.modules.places.models import Place, PlaceEvent, PlaceExternalId
from app.modules.users.enums import UserRole
from app.modules.users.models import User

from geoalchemy2.elements import WKTElement


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

USER_SPECS = [
    ("admin@trusthalal.dev", UserRole.ADMIN, "Amina Admin"),
    ("verifier@trusthalal.dev", UserRole.VERIFIER, "Viraaj Verifier"),
    ("owner@trusthalal.dev", UserRole.OWNER, "Omar Owner"),
    ("consumer@trusthalal.dev", UserRole.CONSUMER, "Celia Consumer"),
]


def upsert_user(db: Session, email: str, role: UserRole, display_name: str) -> User:
    norm = email.strip().lower()
    user = db.execute(
        select(User).where(func.lower(User.email) == norm)
    ).scalar_one_or_none()
    if user:
        changed = False
        if user.role != role.value:
            user.role = role.value
            changed = True
        if user.display_name != display_name:
            user.display_name = display_name
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if changed:
            db.add(user)
        return user

    user = User(
        email=norm,
        role=role.value,
        display_name=display_name,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


# ---------------------------------------------------------------------------
# Organizations & membership
# ---------------------------------------------------------------------------

ORG_NAME = "TrustHalal Seed Kitchens Co."


def upsert_org(db: Session, name: str, contact_email: str | None) -> Organization:
    org = db.execute(
        select(Organization).where(Organization.name == name)
    ).scalar_one_or_none()
    if org:
        return org

    org = Organization(name=name, contact_email=contact_email)
    db.add(org)
    db.flush()
    return org


def upsert_membership(
    db: Session, *, org: Organization, user: User, role: str, status: str = "ACTIVE"
) -> OrganizationMember:
    member = db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org.id,
            OrganizationMember.user_id == user.id,
        )
    ).scalar_one_or_none()

    if member:
        changed = False
        if member.role != role:
            member.role = role
            changed = True
        if member.status != status:
            member.status = status
            changed = True
        if changed:
            db.add(member)
        return member

    member = OrganizationMember(
        organization_id=org.id,
        user_id=user.id,
        role=role,
        status=status,
    )
    db.add(member)
    db.flush()
    return member


# ---------------------------------------------------------------------------
# Places
# ---------------------------------------------------------------------------

# Dict-shaped specs so we can grow the seed payload (city, region, etc.)
# without rippling positional-tuple changes through the call sites.
PLACE_SPECS: list[dict] = [
    {
        "name": "Al Noor Kabob House",
        "address": "123 Main St, Jersey City, NJ",
        "lat": 40.7178,
        "lng": -74.0431,
        "city": "Jersey City",
        "region": "New Jersey",
        "country_code": "US",
        "postal_code": "07302",
        "google_place_id": "ChIJseed0000000000000000001",
    },
    {
        "name": "Zabiha Express",
        "address": "500 Market St, Jersey City, NJ",
        "lat": 40.7195,
        "lng": -74.0460,
        "city": "Jersey City",
        "region": "New Jersey",
        "country_code": "US",
        "postal_code": "07302",
        "google_place_id": "ChIJseed0000000000000000002",
    },
    {
        "name": "Madina Grill",
        "address": "22 Journal Sq, Jersey City, NJ",
        "lat": 40.7321,
        "lng": -74.0634,
        "city": "Jersey City",
        "region": "New Jersey",
        "country_code": "US",
        "postal_code": "07306",
        "google_place_id": "ChIJseed0000000000000000003",
    },
    {
        "name": "Shahi Tandoor",
        "address": "900 Steinway St, Astoria, NY",
        "lat": 40.7631,
        "lng": -73.9154,
        "city": "Queens",  # Astoria is a neighborhood of Queens borough
        "region": "New York",
        "country_code": "US",
        "postal_code": "11103",
        "google_place_id": "ChIJseed0000000000000000004",
    },
    {
        "name": "Crescent Moon Cafe",
        "address": "42 7th Ave, Park Slope, NY",
        "lat": 40.6700,
        "lng": -73.9780,
        "city": "Brooklyn",  # Park Slope is a neighborhood of Brooklyn borough
        "region": "New York",
        "country_code": "US",
        "postal_code": "11215",
        "google_place_id": "ChIJseed0000000000000000005",
    },
]


def upsert_place(
    db: Session,
    *,
    name: str,
    address: str,
    lat: float,
    lng: float,
    google_place_id: str,
    city: str | None = None,
    region: str | None = None,
    country_code: str | None = None,
    postal_code: str | None = None,
    timezone: str | None = None,
) -> Place:
    # Look up by Google external id (globally unique per provider)
    existing_ext = db.execute(
        select(PlaceExternalId).where(
            PlaceExternalId.provider == ExternalIdProvider.GOOGLE.value,
            PlaceExternalId.external_id == google_place_id,
        )
    ).scalar_one_or_none()

    if existing_ext:
        return db.execute(
            select(Place).where(Place.id == existing_ext.place_id)
        ).scalar_one()

    geom = WKTElement(f"POINT({lng} {lat})", srid=4326)
    place = Place(
        name=name,
        address=address,
        lat=lat,
        lng=lng,
        geom=geom,
        city=city,
        region=region,
        country_code=country_code,
        postal_code=postal_code,
        timezone=timezone,
        # Seeded data is shaped like Google ingest (carries a GOOGLE external_id),
        # so mark GOOGLE as the canonical source even though we didn't hit the API.
        canonical_source=ExternalIdProvider.GOOGLE,
    )
    db.add(place)
    db.flush()

    db.add(
        PlaceExternalId(
            place_id=place.id,
            provider=ExternalIdProvider.GOOGLE.value,
            external_id=google_place_id,
        )
    )
    db.add(
        PlaceEvent(
            place_id=place.id,
            event_type=PlaceEventType.CREATED.value,
            message="Seeded by scripts/seed_dev.py",
        )
    )
    db.flush()
    return place


def upsert_place_owner(
    db: Session,
    *,
    place: Place,
    org: Organization,
    role: str = "PRIMARY",
    status: str = "ACTIVE",
) -> PlaceOwner:
    link = db.execute(
        select(PlaceOwner).where(
            PlaceOwner.place_id == place.id,
            PlaceOwner.organization_id == org.id,
        )
    ).scalar_one_or_none()
    if link:
        if link.status != status or link.role != role:
            link.status = status
            link.role = role
            db.add(link)
        return link

    link = PlaceOwner(
        place_id=place.id,
        organization_id=org.id,
        role=role,
        status=status,
    )
    db.add(link)
    db.flush()
    return link


# ---------------------------------------------------------------------------
# Halal claims + evidence — DEFERRED to Phase 2.
# ---------------------------------------------------------------------------
# The legacy claim seeding was removed alongside the legacy schema.
# Phase 2 of the halal-trust rebuild will add v2-equivalent helpers
# here once the new HalalClaim model has its router + repo built.


# ---------------------------------------------------------------------------
# Ownership request
# ---------------------------------------------------------------------------


def upsert_ownership_request(
    db: Session,
    *,
    place: Place,
    requester: User | None,
    contact_name: str,
    contact_email: str,
    message: str,
    contact_phone: str | None = None,
    status: OwnershipRequestStatus = OwnershipRequestStatus.SUBMITTED,
) -> PlaceOwnershipRequest:
    norm_email = contact_email.strip().lower()
    req = db.execute(
        select(PlaceOwnershipRequest).where(
            PlaceOwnershipRequest.place_id == place.id,
            func.lower(PlaceOwnershipRequest.contact_email) == norm_email,
        )
    ).scalar_one_or_none()
    if req:
        # Keep existing status on re-seed so an admin's manual transitions
        # aren't silently stomped back to the seed default.
        return req

    req = PlaceOwnershipRequest(
        place_id=place.id,
        requester_user_id=requester.id if requester else None,
        contact_name=contact_name,
        contact_email=norm_email,
        contact_phone=contact_phone,
        message=message,
        status=status.value,
    )
    db.add(req)
    db.flush()
    return req


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


def _print_kv(pairs: Iterable[tuple[str, object]]) -> None:
    width = max(len(k) for k, _ in pairs)
    for k, v in pairs:
        print(f"  {k.ljust(width)}  {v}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed the dev database. Default seeds the full fixture.",
    )
    parser.add_argument(
        "--users-only",
        action="store_true",
        help=(
            "Seed only the 4 dev users (admin/verifier/owner/consumer) and"
            " stop. Useful after wiping the DB when you want an empty"
            " catalog but still need an admin row for the panel to work."
        ),
    )
    return parser.parse_args()


def main(users_only: bool = False) -> None:
    db: Session = SessionLocal()
    try:
        # Users — always seeded, in both full and users-only modes.
        users = {
            email: upsert_user(db, email, role, name)
            for email, role, name in USER_SPECS
        }

        if users_only:
            # Short-circuit: commit just the users and print a focused
            # summary with the admin UUID prominently placed so it's easy
            # to copy into ``NEXT_PUBLIC_DEV_ACTOR_ID``.
            db.commit()
            print("\nSeed complete (users-only).")
            print("\nUsers:")
            _print_kv(
                (f"{u.role} {u.email}", str(u.id)) for u in users.values()
            )
            admin_user = users["admin@trusthalal.dev"]
            print(
                "\nAdmin UUID for NEXT_PUBLIC_DEV_ACTOR_ID:"
                f"\n  {admin_user.id}"
            )
            print(
                "\nTip: set X-User-Id to the admin UUID above (or POST"
                " /auth/dev-login) to authenticate."
            )
            return

        # Org + membership
        org = upsert_org(
            db, ORG_NAME, contact_email=users["owner@trusthalal.dev"].email
        )
        upsert_membership(
            db,
            org=org,
            user=users["owner@trusthalal.dev"],
            role="OWNER_ADMIN",
            status="ACTIVE",
        )

        # Places
        places = [upsert_place(db, **spec) for spec in PLACE_SPECS]

        # First place: owned by the seed org
        upsert_place_owner(
            db,
            place=places[0],
            org=org,
            role="PRIMARY",
            status="ACTIVE",
        )

        # Halal claim seeding lives in Phase 2 — this script will
        # gain v2 ``upsert_halal_claim`` helpers once the new model
        # is wired to a router. For now, places exist but have no
        # halal_profile until the owner submits and admin approves.

        # Third place: open ownership request (SUBMITTED)
        ownership_req = upsert_ownership_request(
            db,
            place=places[2],
            requester=users["consumer@trusthalal.dev"],
            contact_name="Celia Consumer",
            contact_email="consumer@trusthalal.dev",
            message="I am the GM at Madina Grill and would like to claim ownership.",
        )

        # Fourth place: request currently awaiting more evidence
        ownership_req_needs_evidence = upsert_ownership_request(
            db,
            place=places[3],
            requester=None,  # anonymous submission, exercises the null-requester branch
            contact_name="Hamza Hussain",
            contact_email="hamza.hussain@example.com",
            contact_phone="+1 718 555 0144",
            message=(
                "General manager at Shahi Tandoor. Happy to provide our "
                "certificate from ISNA."
            ),
            status=OwnershipRequestStatus.NEEDS_EVIDENCE,
        )

        # Fifth place: request an admin has picked up but not yet decided
        ownership_req_under_review = upsert_ownership_request(
            db,
            place=places[4],
            requester=users["owner@trusthalal.dev"],
            contact_name="Noor Khan",
            contact_email="noor.khan@example.com",
            contact_phone="+1 347 555 0181",
            message="Owner of Crescent Moon Cafe since 2019.",
            status=OwnershipRequestStatus.UNDER_REVIEW,
        )

        db.commit()

        # Summary
        print("\nSeed complete.")
        print("\nUsers:")
        _print_kv(
            (
                f"{u.role} {u.email}",
                str(u.id),
            )
            for u in users.values()
        )
        print("\nOrganization:")
        _print_kv([(org.name, str(org.id))])
        print("\nPlaces:")
        _print_kv((p.name, str(p.id)) for p in places)
        print("\nHighlights:")
        _print_kv(
            [
                ("verified_claim_id", str(verified_claim.id)),
                ("ownership_request_id (SUBMITTED)", str(ownership_req.id)),
                (
                    "ownership_request_id (NEEDS_EVIDENCE)",
                    str(ownership_req_needs_evidence.id),
                ),
                (
                    "ownership_request_id (UNDER_REVIEW)",
                    str(ownership_req_under_review.id),
                ),
            ]
        )
        print(
            "\nTip: set X-User-Id to one of the user UUIDs above (or POST /auth/dev-login) "
            "to authenticate."
        )

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    args = _parse_args()
    main(users_only=args.users_only)
