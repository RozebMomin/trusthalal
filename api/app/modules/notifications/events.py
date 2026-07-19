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
        push_title="Your report was reviewed",
        push_body=(
            f"Trust Halal upheld your report about {place_name}."
            if upheld
            else f"Trust Halal reviewed your report about {place_name}."
        ),
        push_data={"path": f"/places/{place_id}"},
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
            push_title="Now Trust Halal Verified",
            push_body=f"{place_name} — a place you saved — was verified in person.",
            push_data={"path": f"/places/{place_id}"},
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
        push_title=(
            "You're a Trust Halal verifier"
            if approved
            else "Verifier application update"
        ),
        push_body=(
            "You're approved — file your first verification visit."
            if approved
            else "We couldn't approve your verifier application this time."
        ),
        # Approved verifiers land on the Verify tab; everyone else on Profile,
        # where the application status lives.
        push_data={"path": "/verify" if approved else "/profile"},
    )


def notify_verifier_status_changed(
    background: BackgroundTasks,
    db: Session,
    *,
    user_id: UUID,
    status: str,
    note: str | None = None,
) -> None:
    """Tell a verifier their access was revoked / suspended / reinstated."""
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user is None or not user.email:
        return
    revoked = status == "REVOKED"
    suspended = status == "SUSPENDED"
    reinstated = status == "ACTIVE"
    if revoked:
        subject = "Your Trust Halal verifier access was removed"
    elif suspended:
        subject = "Your Trust Halal verifier access is paused"
    else:
        subject = "Your Trust Halal verifier access is active again"
    notify(
        background,
        db=db,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        category=NotificationCategory.VERIFIER,
        subject=subject,
        template="verifier_status_changed",
        context={
            "preheader": subject,
            "revoked": revoked,
            "suspended": suspended,
            "reinstated": reinstated,
            "note": note or "",
            "site_url": settings.CONSUMER_ORIGIN.rstrip("/"),
        },
        push_title=subject,
        push_body=(
            "Your verifier access was removed."
            if revoked
            else "Your verifier access is paused."
            if suspended
            else "You can file verification visits again."
        ),
        push_data={"path": "/verify"},
    )


def notify_verifier_visit_decided(
    background: BackgroundTasks,
    db: Session,
    *,
    verifier_user_id: UUID,
    place_id: UUID,
    accepted: bool,
    decision_note: str | None,
    visit_id: UUID | None = None,
) -> None:
    """Tell the verifier whether their submitted visit was accepted.

    ``visit_id`` is optional only for backwards compatibility — pass it so the
    push can deep-link straight to the visit detail screen instead of dumping
    the verifier on the tab.
    """
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
        push_title=(
            "Visit accepted" if accepted else "Update on your visit"
        ),
        push_body=(
            f"Your verification of {place_name} is live — thank you."
            if accepted
            else f"Your visit to {place_name} wasn't accepted. Tap for details."
        ),
        push_data={
            "path": f"/visit/{visit_id}" if visit_id is not None else "/verify"
        },
    )


# ---------------------------------------------------------------------------
# Owner onboarding — business verification + restaurant ownership claims.
#
# These two gates are hand-reviewed and block the owner's next step, so a
# silent decision strands them: the get-verified flow literally promises
# "we'll email you the moment the ball's back in your court".
# ---------------------------------------------------------------------------


def org_member_users(db: Session, organization_id: UUID) -> list[User]:
    """Active members of an organization — the people who should hear about a
    verification decision on it."""
    rows = (
        db.execute(
            select(User)
            .join(OrganizationMember, OrganizationMember.user_id == User.id)
            .where(OrganizationMember.organization_id == organization_id)
            .where(OrganizationMember.status == "ACTIVE")
            .where(User.is_active.is_(True))
            .distinct()
        )
        .scalars()
        .all()
    )
    return list(rows)


def notify_organization_decided(
    background: BackgroundTasks,
    db: Session,
    *,
    organization,
    verified: bool,
    closed_claims: int = 0,
) -> None:
    """Tell the owner(s) behind a business that verification passed or failed.

    Rejection carries the admin's reason and the count of ownership claims the
    rejection cascade closed, so the owner isn't left wondering why their
    in-flight claims vanished. Falls back to the org's creator when no active
    membership rows exist yet.
    """
    recipients = org_member_users(db, organization.id)
    if not recipients and organization.created_by_user_id is not None:
        creator = db.execute(
            select(User).where(User.id == organization.created_by_user_id)
        ).scalar_one_or_none()
        if creator is not None:
            recipients = [creator]

    base = settings.OWNER_PORTAL_ORIGIN.rstrip("/")
    name = organization.name

    if verified:
        subject = f"{name} is verified on Trust Halal"
        template = "organization_verified"
        context = {
            "preheader": f"{name} is verified — you can claim your restaurant now.",
            "business_name": name,
            "portal_url": f"{base}/get-verified/claim",
        }
    else:
        subject = f"About your business verification for {name}"
        template = "organization_rejected"
        context = {
            "preheader": f"We couldn't verify {name} on Trust Halal.",
            "business_name": name,
            "decision_note": organization.decision_note or "",
            "closed_claims": closed_claims,
            "portal_url": f"{base}/get-verified/business?new=1",
        }

    for user in recipients:
        if not user.email:
            continue
        notify(
            background,
            db=db,
            user_id=user.id,
            email=user.email,
            display_name=user.display_name,
            category=NotificationCategory.CLAIM_DECISION,
            subject=subject,
            template=template,
            context=context,
        )


def notify_ownership_claim_decided(
    background: BackgroundTasks,
    db: Session,
    *,
    claim,
    template: str,
    subject_tpl: str,
    portal_path: str = "/my-claims",
) -> None:
    """Email the requester about an ownership-claim decision.

    ``subject_tpl`` is formatted with ``place``. Silently skips when the claim
    was filed without a known requester (admin-recorded intake) or the user has
    no email on file.
    """
    if claim.requester_user_id is None:
        return
    user = db.execute(
        select(User).where(User.id == claim.requester_user_id)
    ).scalar_one_or_none()
    if user is None or not user.email:
        return

    place_name = place_name_for(db, claim.place_id)
    subject = subject_tpl.format(place=place_name)
    notify(
        background,
        db=db,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        category=NotificationCategory.CLAIM_DECISION,
        subject=subject,
        template=template,
        context={
            "preheader": subject,
            "place_name": place_name,
            "decision_note": claim.decision_note or "",
            "portal_url": f"{settings.OWNER_PORTAL_ORIGIN.rstrip('/')}{portal_path}",
        },
    )


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------
# Split across two categories deliberately (see NotificationCategory): REVIEW
# is opt-outable engagement volume, REVIEW_MODERATION is transactional and
# mandatory on email. Push payloads are attached only where the event is
# genuinely worth a buzz.


def _review_excerpt(body: str, limit: int = 140) -> str:
    body = " ".join(body.split())
    return body if len(body) <= limit else body[:limit] + "…"


def notify_review_posted(
    background: BackgroundTasks, db: Session, *, review
) -> None:
    """Tell the owners of a claimed place that a new review landed.

    Silently no-ops on unclaimed places — ``owner_users_for_place`` returns
    empty, which is correct: there's nobody to tell. That's also why the
    consumer page shows a "claim this restaurant to respond" prompt there.
    """
    recipients = owner_users_for_place(db, review.place_id)
    if not recipients:
        return

    place_name = place_name_for(db, review.place_id)
    inbox_url = f"{settings.OWNER_PORTAL_ORIGIN.rstrip('/')}/my-reviews"
    stars = "★" * int(review.rating) + "☆" * (5 - int(review.rating))

    for user in recipients:
        if not user.email:
            continue
        notify(
            background,
            db=db,
            user_id=user.id,
            email=user.email,
            display_name=user.display_name,
            category=NotificationCategory.REVIEW,
            subject=f"New {review.rating}-star review for {place_name}",
            template="review_posted_owner",
            context={
                "preheader": f"Someone reviewed {place_name}.",
                "place_name": place_name,
                "rating": int(review.rating),
                "stars": stars,
                "excerpt": _review_excerpt(review.body),
                "inbox_url": inbox_url,
            },
            push_title=f"New review for {place_name}",
            push_body=f"{stars} — {_review_excerpt(review.body, 80)}",
            push_data={"path": "/my-reviews"},
        )


def notify_review_replied(
    background: BackgroundTasks, db: Session, *, review, reply
) -> None:
    """Tell the diner that the restaurant answered them.

    This is the payoff moment for a reviewer — someone read what they wrote
    and responded — so it's worth a push as well as an email.
    """
    author = db.execute(
        select(User).where(User.id == review.author_user_id)
    ).scalar_one_or_none()
    if author is None or not author.email:
        return

    place_name = place_name_for(db, review.place_id)
    place_url = f"{settings.CONSUMER_ORIGIN.rstrip('/')}/places/{review.place_id}"

    notify(
        background,
        db=db,
        user_id=author.id,
        email=author.email,
        display_name=author.display_name,
        category=NotificationCategory.REVIEW,
        subject=f"{place_name} replied to your review",
        template="review_replied_author",
        context={
            "preheader": f"{place_name} responded to what you wrote.",
            "place_name": place_name,
            "reply_excerpt": _review_excerpt(reply.body, 300),
            "place_url": place_url,
        },
        push_title=f"{place_name} replied",
        push_body=_review_excerpt(reply.body, 80),
        push_data={"path": f"/places/{review.place_id}"},
    )


def notify_review_moderated(
    background: BackgroundTasks,
    db: Session,
    *,
    review,
    status,
    note: str | None,
    targeted_reply: bool = False,
) -> None:
    """Tell an author their content was hidden or removed, and why.

    Mandatory category: this is the one message a moderated user is owed, and
    the note is rendered verbatim because it was written *to* them. No push —
    a buzzing phone is the wrong register for "we took your words down"; the
    email carries the reasoning and the appeal path.

    When the reply was the target, the recipient is the owner who wrote it,
    not the diner. Owners get the same treatment and the same explanation.
    """
    if targeted_reply and review.reply is not None:
        recipient_id = review.reply.author_user_id
        what = "your reply"
    else:
        recipient_id = review.author_user_id
        what = "your review"

    if recipient_id is None:
        return

    user = db.execute(
        select(User).where(User.id == recipient_id)
    ).scalar_one_or_none()
    if user is None or not user.email:
        return

    place_name = place_name_for(db, review.place_id)
    removed = str(status) == "REMOVED"

    notify(
        background,
        db=db,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        category=NotificationCategory.REVIEW_MODERATION,
        subject=(
            f"We removed {what} of {place_name}"
            if removed
            else f"We've hidden {what} of {place_name}"
        ),
        template="review_moderated_author",
        context={
            "preheader": f"About {what} of {place_name}.",
            "place_name": place_name,
            "what": what,
            "removed": removed,
            "reason": (note or "").strip(),
            # Where to go if they believe the underlying claim is true and
            # worth investigating. We point; they decide. Filing on their
            # behalf would put our name on their accusation.
            "dispute_url": (
                f"{settings.CONSUMER_ORIGIN.rstrip('/')}/places/{review.place_id}"
            ),
        },
    )


def notify_review_report_resolved(
    background: BackgroundTasks, db: Session, *, review, decision
) -> None:
    """Close the loop with everyone who reported this content.

    Reporters who hear nothing stop reporting, and the report queue is the
    primary defence for text on this platform — so it's worth the emails.
    """
    from app.modules.reviews.models import PlaceReviewReport  # local: cycle

    reports = db.execute(
        select(PlaceReviewReport).where(PlaceReviewReport.review_id == review.id)
    ).scalars().all()
    if not reports:
        return

    place_name = place_name_for(db, review.place_id)
    upheld = str(decision) == "UPHELD"
    seen: set = set()

    for report in reports:
        if report.reporter_user_id in seen:
            continue
        seen.add(report.reporter_user_id)

        user = db.execute(
            select(User).where(User.id == report.reporter_user_id)
        ).scalar_one_or_none()
        if user is None or not user.email:
            continue

        notify(
            background,
            db=db,
            user_id=user.id,
            email=user.email,
            display_name=user.display_name,
            category=NotificationCategory.REVIEW,
            subject=f"We reviewed your report about {place_name}",
            template="review_report_resolved_reporter",
            context={
                "preheader": f"Outcome of your report about {place_name}.",
                "place_name": place_name,
                "upheld": upheld,
                "place_url": (
                    f"{settings.CONSUMER_ORIGIN.rstrip('/')}/places/{review.place_id}"
                ),
            },
        )
