"""Enums for diner reviews, owner replies, and reports.

Naming note: "review" is already heavily overloaded in this codebase to mean
*staff adjudication* — ``UNDER_REVIEW``, ``reviewed_by_user_id``, the admin
review queues. Everything here is deliberately named to avoid colliding with
that sense. The moderation states are ``PUBLISHED | HIDDEN | REMOVED``, not
``UNDER_REVIEW``, and the admin surface is called "reported reviews".
"""
from enum import StrEnum


class PlaceReviewStatus(StrEnum):
    """Visibility state of a review or an owner reply.

    ``PUBLISHED`` is the default — reviews go live immediately and are
    moderated on report, rather than waiting in a pre-publish queue. A
    cold-start platform can't afford a moderation bottleneck between a diner
    writing something and anyone seeing it.

    ``HIDDEN`` is reversible: the content drops out of public reads but the
    author can still see and edit it, and an admin can put it back. Use it
    when something is probably wrong but not certainly.

    ``REMOVED`` is terminal. The author is told why (the moderation note is
    written *to them*, not as an internal memo) and the place's aggregate
    rating recomputes without it.
    """

    PUBLISHED = "PUBLISHED"
    HIDDEN = "HIDDEN"
    REMOVED = "REMOVED"


#: Statuses that appear in public reads and count toward a place's rating.
VISIBLE_REVIEW_STATUSES: tuple[str, ...] = (PlaceReviewStatus.PUBLISHED,)


class ReviewReportReason(StrEnum):
    """Why someone flagged a review or reply.

    ``FALSE_INFO`` is the load-bearing one and the hardest to action: whether
    a factual claim about a restaurant is false is a question about the world,
    not about the text, so it always lands on a human. ``CONFLICT_OF_INTEREST``
    covers the competitor-review case that a halal-trust platform attracts
    specifically.
    """

    SPAM = "SPAM"
    OFF_TOPIC = "OFF_TOPIC"
    HARASSMENT = "HARASSMENT"
    FALSE_INFO = "FALSE_INFO"
    CONFLICT_OF_INTEREST = "CONFLICT_OF_INTEREST"
    OTHER = "OTHER"


class ReviewReportStatus(StrEnum):
    OPEN = "OPEN"
    UPHELD = "UPHELD"
    DISMISSED = "DISMISSED"


class ReviewSort(StrEnum):
    """Ordering for the public review list.

    No "most helpful" — there are no helpful votes, and adding a sort option
    backed by nothing is worse than three honest ones.
    """

    RECENT = "recent"
    RATING_HIGH = "rating_high"
    RATING_LOW = "rating_low"


class ModerationAction(StrEnum):
    """What an admin does to the content when resolving a report.

    Kept separate from the verdict on the report itself: "this report was
    valid" and "therefore the review comes down" are different facts. A
    report can be upheld while the content stays up (e.g. the reporter was
    right that it's heated, but it's still a legitimate account).
    """

    NONE = "NONE"
    HIDE = "HIDE"
    REMOVE = "REMOVE"
