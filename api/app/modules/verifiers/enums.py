"""Enums for the verifier (community moderator) system.

Verifiers are vetted community members — typically food influencers,
mosque-affiliated reviewers, or active platform users — who do
in-the-field verification of restaurants. Their site visits feed
into the validation_tier on halal_profiles.

Onboarding paths (both admin-gated):
  * Public application → admin reviews → approved becomes invite
  * Direct admin invite → user accepts via the existing invite flow
"""
from enum import StrEnum


class VerifierApplicationStatus(StrEnum):
    PENDING = "PENDING"
    """Submitted, awaiting admin review."""

    APPROVED = "APPROVED"
    """Admin approved; an invite/user-creation flow has been kicked
    off downstream. Terminal state for the application row."""

    REJECTED = "REJECTED"
    """Admin declined the application. Reason is surfaced to the
    applicant."""

    WITHDRAWN = "WITHDRAWN"
    """Applicant withdrew before a decision was made."""


class VerifierProfileStatus(StrEnum):
    ACTIVE = "ACTIVE"
    """Currently a verifier in good standing. Can submit visits."""

    SUSPENDED = "SUSPENDED"
    """Temporarily paused — e.g. while admin reviews a quality concern.
    Verifier can still see their dashboard but can't submit new visits."""

    REVOKED = "REVOKED"
    """Permanent removal. Past visits remain in the audit trail; no
    new ones accepted."""


class VisitDisclosure(StrEnum):
    """Was the verifier compensated or comped for this visit?

    Influencer angle: a verifier may also be a food creator who
    receives free meals or partnerships. We don't bar comped visits,
    but they MUST be disclosed so admin can weigh accordingly.
    """

    SELF_FUNDED = "SELF_FUNDED"
    """Verifier paid out of pocket. Default."""

    MEAL_COMPED = "MEAL_COMPED"
    """The restaurant comped the visit (free meal, no payment)."""

    PAID_PARTNERSHIP = "PAID_PARTNERSHIP"
    """The visit is part of a paid sponsorship arrangement (rare;
    flagged for extra scrutiny)."""

    OTHER_DISCLOSURE = "OTHER_DISCLOSURE"
    """Anything else worth declaring — explained in the visit's
    disclosure_note."""


class VerificationVisitStatus(StrEnum):
    SUBMITTED = "SUBMITTED"
    """Verifier submitted; awaiting admin review."""

    UNDER_REVIEW = "UNDER_REVIEW"
    """Admin actively reviewing."""

    ACCEPTED = "ACCEPTED"
    """Admin accepted the visit. May trigger a profile update or
    validation-tier promotion."""

    REJECTED = "REJECTED"
    """Admin rejected the visit (e.g. insufficient evidence,
    conflict of interest disclosed too late)."""

    WITHDRAWN = "WITHDRAWN"
    """Verifier pulled the visit before admin acted. Lets verifiers
    retract a misfired submission without leaving SUBMITTED rows in
    the queue. The column uses ``sa.Enum(native_enum=False)`` so
    adding values is a code-only change — no DB migration needed."""
