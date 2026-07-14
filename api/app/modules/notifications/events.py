"""Recipient resolution + fan-out helpers for product notifications.

Keeps the "who do we email for this event" logic in one place so the router
hooks stay thin. All lookups are synchronous (inside the request); only the
email send itself is backgrounded by ``notify``.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.notifications import NotificationCategory, notify
from app.modules.favorites.models import ConsumerFavorite
from app.modules.halal_profiles.models import HalalProfile
from app.modules.organizations.models import OrganizationMember, PlaceOwner
from app.modules.places.models import Place
from app.modules.users.models import User

_VERIFIED_TIER = "TRUST_HALAL_VERIFIED"


def place_is_verified(db: Session, place_id: UUID) -> bool:
    """Whether the place currently holds a live Trust Halal Verified profile.

    Callers capture this BEFORE a mutation that might verify the place, so the
    saver fan-out only fires on a genuine transition into verified."""
    tier = db.execute(
        select(HalalProfile.validation_tier)
        .where(HalalProfile.place_id == place_id)
        .where(HalalProfile.revoked_at.is_(None))
    ).scalar_one_or_none()
    return str(tier) == _VERIFIED_TIER if tier is not None else False


def place_name_for(db: Session, place_id: UUID) -> str:
    name = db.execute(
        select(Place.name).where(Place.id == place_id)
    ).scalar_one_or_none()
    return name or "your place"


def owner_users_for_place(db: Session, place_id: UUID) -> list[User]:
    """Active owner-side users for a place (OWNER_ADMIN / MANAGER on an
    active owning org). Empty when the place is unclaimed. Mirrors the
    join in ``organizations.deps.assert_can_manage_place``.
    """
    rows = db.execute(
        select(User)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .join(
            PlaceOwner,
            PlaceOwner.organization_id == OrganizationMember.organization_id,
        )
        .where(PlaceOwner.place_id == place_id)
        .where(PlaceOwner.status.in_(["ACTIVE", "VERIFIED"]))
        .where(OrganizationMember.status == "ACTIVE")
        .where(OrganizationMember.role.in_(["OWNER_ADMIN", "MANAGER"]))
        .where(User.is_active.is_(True))
        .distinct()
    ).scalars().all()
    return list(rows)


def notify_dispute_filed(
    background: BackgroundTasks, db: Session, *, place_id: UUID
) -> None:
    """Tell the place's owner(s) a diner flagged their halal profile."""
    place_name = place_name_for(db, place_id)
    portal_url = f"{settings.OWNER_PORTAL_ORIGIN.rstrip('/')}/my-places/{place_id}"
    for owner in owner_users_for_place(db, place_id):
        if not owner.email:
            continue
        notify(
            background,
            db=db,
            user_id=owner.id,
            email=owner.email,
            display_name=owner.display_name,
            category=NotificationCategory.DISPUTE,
            subject=f"A diner reported an issue with {place_name}",
            template="dispute_filed_owner",
            context={
                "preheader": f"Someone flagged {place_name}'s halal profile.",
                "place_name": place_name,
                "portal_url": portal_url,
            },
        )


def notify_dispute_resolved(
    background: BackgroundTasks,
    db: Session,
    *,
    reporter_user_id: UUID | None,
    place_id: UUID,
    upheld: bool,
) -> None:
    """Tell the consumer who reported it how their dispute was resolved."""
    if reporter_user_id is None:
        return
    reporter = db.execute(
        select(User).where(User.id == reporter_user_id)
    ).scalar_one_or_none()
    if reporter is None or not reporter.email:
        return
    place_name = place_name_for(db, place_id)
    place_url = f"{settings.CONSUMER_ORIGIN.rstrip('/')}/places/{place_id}"
    notify(
        background,
        db=db,
        user_id=reporter.id,
        email=reporter.email,
        display_name=reporter.display_name,
        category=NotificationCategory.DISPUTE,
        subject=f"Your report about {place_name} was reviewed",
        template="dispute_resolved_reporter",
        context={
            "preheader": f"Trust Halal reviewed your report about {place_name}.",
            "place_name": place_name,
            "place_url": place_url,
            "upheld": upheld,
        },
    )


def notify_place_verified_savers(
    background: BackgroundTasks, db: Session, *, place_id: UUID
) -> int:
    """Fan out to every consumer who favorited a place that just became
    Trust Halal Verified. Opt-outable (PLACE_VERIFIED). Returns the number
    of recipients scheduled.

    Callers should only invoke this on a genuine transition INTO verified
    (see the ``was_verified`` guards at the call sites) so re-approvals
    don't re-spam savers.
    """
    place_name = place_name_for(db, place_id)
    place_url = f"{settings.CONSUMER_ORIGIN.rstrip('/')}/places/{place_id}"
    savers = db.execute(
        select(User)
        .join(ConsumerFavorite, ConsumerFavorite.user_id == User.id)
        .where(ConsumerFavorite.place_id == place_id)
        .where(User.is_active.is_(True))
    ).scalars().all()
    sent = 0
    for saver in savers:
        if not saver.email:
            continue
        if notify(
            background,
            db=db,
            user_id=saver.id,
            email=saver.email,
            display_name=saver.display_name,
            category=NotificationCategory.PLACE_VERIFIED,
            subject=f"{place_name} is now Trust Halal Verified",
            template="place_verified_saver",
            context={
                "preheader": f"A place you saved, {place_name}, is now verified.",
                "place_name": place_name,
                "place_url": place_url,
            },
        ):
            sent += 1
    return sent


def notify_verifier_application_decided(
    background: BackgroundTasks,
    db: Session,
    *,
    applicant_user_id: UUID | None,
    applicant_email: str | None,
    approved: bool,
    decision_note: str | None,
) -> None:
    """Tell an applicant their verifier application was approved/rejected.

    Prefers the linked user's email; falls back to the email on the
    application (rejected non-users). Uses the user id when present, else the
    email-less path is skipped (nothing to address)."""
    email = applicant_email
    display_name = None
    distinct_id = applicant_user_id
    if applicant_user_id is not None:
        user = db.execute(
            select(User).where(User.id == applicant_user_id)
        ).scalar_one_or_none()
        if user is not None:
            email = user.email or email
            display_name = user.display_name
    if not email:
        return
    site_url = settings.CONSUMER_ORIGIN.rstrip("/")
    notify(
        background,
        db=db,
        user_id=distinct_id or UUID(int=0),
        email=email,
        display_name=display_name,
        category=NotificationCategory.VERIFIER,
        subject=(
            "You're a Trust Halal verifier"
            if approved
            else "An update on your verifier application"
        ),
        template="verifier_application_decided",
        context={
            "preheader": (
                "Your verifier application was approved."
                if approved
                else "An update on your verifier application."
            ),
            "approved": approved,
            "decision_note": decision_note or "",
            "site_url": site_url,
        },
    )


def notify_verifier_visit_decided(
    background: BackgroundTasks,
    db: Session,
    *,
    verifier_user_id: UUID,
    place_id: UUID,
    accepted: bool,
    decision_note: str | None,
) -> None:
    """Tell the verifier whether their submitted visit was accepted."""
    verifier = db.execute(
        select(User).where(User.id == verifier_user_id)
    ).scalar_one_or_none()
    if verifier is None or not verifier.email:
        return
    place_name = place_name_for(db, place_id)
    place_url = f"{settings.CONSUMER_ORIGIN.rstrip('/')}/places/{place_id}"
    notify(
        background,
        db=db,
        user_id=verifier.id,
        email=verifier.email,
        display_name=verifier.display_name,
        category=NotificationCategory.VERIFIER,
        subject=(
            f"Your visit to {place_name} was accepted"
            if accepted
            else f"An update on your visit to {place_name}"
        ),
        template="verifier_visit_decided",
        context={
            "preheader": (
                f"Your verification visit to {place_name} was accepted."
                if accepted
                else f"An update on your verification visit to {place_name}."
            ),
            "accepted": accepted,
            "place_name": place_name,
            "place_url": place_url,
            "decision_note": decision_note or "",
        },
    )
