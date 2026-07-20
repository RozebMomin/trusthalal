"""Verdict thresholds, and the domain vocabulary that must survive them.

These exercise ``_classify`` directly rather than the HTTP client: the
thresholds are the part with judgement in them, and pinning them needs no
network. What Cloud NL actually scores for a given sentence is the vendor's
business and changes without notice — what we do with a score is ours.
"""
from __future__ import annotations

from app.core.text_moderation import (
    ModerationVerdict,
    _classify,
    rejection_message,
)


def test_slaughter_vocabulary_does_not_block():
    """The bug this file exists for.

    "Amazing place. Serves up zabihah!" — five stars, no complaint, the most
    important word in our vocabulary used approvingly — was refused as
    violent content. The model is not wrong that zabihah is slaughter; the
    category is just mismatched to a platform whose entire subject is how an
    animal was killed. Scores near certainty here and it still has to post.
    """
    for category in ("Violent", "Death, Harm & Tragedy"):
        result = _classify({category: 0.99})
        assert result.verdict == ModerationVerdict.ALLOW, (
            f"{category} at 0.99 blocked a review; halal vocabulary scores "
            "high on both of these by construction"
        )


def test_person_directed_harm_still_blocks():
    """The other half. Dropping the topic categories must not turn the gate
    off — nobody has to read slurs to find a restaurant."""
    for category in ("Profanity", "Insult", "Derogatory", "Sexual",
                     "Firearms & Weapons"):
        assert _classify({category: 0.95}).verdict == ModerationVerdict.BLOCK, category


def test_a_furious_but_clean_complaint_is_allowed_or_warned_never_blocked():
    """Anger is legitimate here. Someone served non-halal food is entitled to
    be furious; the product dies if that reads as a rule violation."""
    verdict = _classify({"Toxic": 0.72, "Violent": 0.40}).verdict
    assert verdict in (ModerationVerdict.WARN, ModerationVerdict.ALLOW)
    assert verdict != ModerationVerdict.BLOCK


def test_block_reports_the_worst_blocking_category_not_the_worst_overall():
    """The user is told which category tripped. Naming a category we no
    longer act on would explain a block by pointing at something that did not
    cause it."""
    result = _classify({"Violent": 0.99, "Profanity": 0.85})
    assert result.verdict == ModerationVerdict.BLOCK
    assert result.category == "Profanity"


def test_rejection_message_does_not_repeat_the_banner_heading():
    """Both clients print 'This can't be posted as written' as the heading and
    this string underneath. Opening with the same sentence said it twice."""
    msg = rejection_message(_classify({"Profanity": 0.95}))
    assert not msg.startswith("This can't be posted as written")
    assert "Strong criticism is welcome" in msg
    # And the clients must not append that sentence themselves.
    assert msg.count("Strong criticism is welcome") == 1
