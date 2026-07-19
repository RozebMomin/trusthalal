"""Text moderation — content-safety gate for user-written review text.

A deliberate mirror of ``places/photos/safesearch.py``: Protocol + real
implementation + cached singleton factory + typed error, so tests inject an
in-memory fake through ``app.dependency_overrides`` exactly the same way. If
you're changing one, look at the other.

Provider
--------
Google Cloud Natural Language ``moderateText``. Chosen because it's the same
GCP project and the same API-key posture as Cloud Vision — one key, one
rotation point, one vendor. Explicitly *not* Perspective API: Google is
retiring that after 2026 and stopped accepting new quota requests in
February 2026, so building on it would mean a forced migration within months.

What this can and cannot do
---------------------------
It detects **profanity, insults, harassment, sexual and violent content**.
It does **not** detect defamation, and nothing can: defamation is a false
statement of fact, so whether

    "They served me pork and told me it was lamb."

is defamatory depends entirely on whether it happened. The two cases are
byte-identical. That judgment belongs to the report queue and a human, and a
filter claiming to catch it would be worse than none because it would create
false confidence.

The corollary matters just as much: **tune permissive.** On a halal-trust
platform, "I asked and the manager admitted the chicken isn't zabihah" is the
single most valuable review anyone can write. A filter tuned hard enough to
catch "defamatory-sounding" text destroys the feature's reason to exist, and
does it silently — a wrongly-blocked review produces no queue entry, no
signal, and a user who quietly stops writing. Hence the conservative default
thresholds and the logging of every BLOCK with its scores.

Failure posture
---------------
**Fail closed**, matching the photo pipeline: if the API is unreachable after
retries, the submit is refused with a 503. One rule across both content
pipelines — no answer from the scanner means no publish. The cost (a lost
draft) is mitigated at the caller: retries happen here, and the client keeps
the draft locally and shows "that's on us, not your review".
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Optional, Protocol

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_ENDPOINT = "https://language.googleapis.com/v2/documents:moderateText"

# Categories we act on. Cloud NL returns a longer list (including things like
# "Religion & Belief" and "Politics") which are *topics*, not harms — acting
# on those would mean blocking reviews for mentioning halal, which on this
# platform is every review.
_BLOCKING_CATEGORIES: frozenset[str] = frozenset(
    {
        "Profanity",
        "Insult",
        "Derogatory",
        "Sexual",
        "Violent",
        "Death, Harm & Tragedy",
        "Firearms & Weapons",
    }
)

# Scored but never blocking on its own. Anger is legitimate — a diner who
# found pork in their food is entitled to be furious; they're not entitled to
# slurs. Toxicity drives the soft WARN only.
_WARN_CATEGORIES: frozenset[str] = frozenset({"Toxic"})

_MAX_CHARS = 20_000
_TIMEOUT_SECONDS = 6.0
_RETRIES = 2


class ModerationVerdict(StrEnum):
    ALLOW = "ALLOW"
    WARN = "WARN"
    BLOCK = "BLOCK"


@dataclass(frozen=True, slots=True)
class ModerationResult:
    verdict: ModerationVerdict
    #: Highest-scoring blocking category, when the verdict is BLOCK. This is
    #: what the user is told ("contains profanity"), so it has to be a human
    #: word, not an internal code.
    category: Optional[str] = None
    confidence: float = 0.0
    #: Every category → score, kept for the BLOCK audit log. Calibration is
    #: impossible without seeing what actually tripped.
    scores: dict[str, float] = field(default_factory=dict)

    @property
    def blocked(self) -> bool:
        return self.verdict == ModerationVerdict.BLOCK


class TextModerationClient(Protocol):
    """Contract for moderation implementations.

    Pure text in, verdict out — keeps the contract testable without wiring
    Cloud NL into the test harness.
    """

    def evaluate(self, text: str) -> ModerationResult: ...


class TextModerationError(Exception):
    """Raised when the moderation API can't be reached or answers oddly.

    The router translates this to a 503 so the client can say "we couldn't
    run our content check, that's on us" instead of implying we judged the
    content — which would be both false and infuriating.
    """


def _classify(scores: dict[str, float]) -> ModerationResult:
    """Turn raw category scores into a verdict.

    Split out from the client so the thresholds are testable without any
    network, and so a fake can reuse the exact same logic.
    """
    block_threshold = settings.TEXT_MODERATION_BLOCK_THRESHOLD
    warn_threshold = settings.TEXT_MODERATION_WARN_THRESHOLD

    worst_name: Optional[str] = None
    worst_score = 0.0
    for name, score in scores.items():
        if name in _BLOCKING_CATEGORIES and score > worst_score:
            worst_name, worst_score = name, score

    if worst_name is not None and worst_score >= block_threshold:
        return ModerationResult(
            verdict=ModerationVerdict.BLOCK,
            category=worst_name,
            confidence=worst_score,
            scores=scores,
        )

    warn_score = max(
        (s for n, s in scores.items() if n in _WARN_CATEGORIES), default=0.0
    )
    if warn_score >= warn_threshold:
        return ModerationResult(
            verdict=ModerationVerdict.WARN, confidence=warn_score, scores=scores
        )

    return ModerationResult(verdict=ModerationVerdict.ALLOW, scores=scores)


@dataclass(frozen=True)
class CloudNaturalLanguageClient:
    """Google Cloud Natural Language ``moderateText`` implementation.

    Raw ``httpx`` rather than the SDK, matching ``SupabaseStorageClient`` —
    one HTTP call with an API key doesn't justify another dependency.
    """

    api_key: str

    def evaluate(self, text: str) -> ModerationResult:
        payload = {
            "document": {
                "type": "PLAIN_TEXT",
                # Truncated rather than rejected: our own body cap is 5000,
                # so hitting this means something upstream changed, and
                # scanning the first 20k is still the right call.
                "content": text[:_MAX_CHARS],
            }
        }

        last_exc: Exception | None = None
        for attempt in range(_RETRIES + 1):
            try:
                resp = httpx.post(
                    _ENDPOINT,
                    params={"key": self.api_key},
                    json=payload,
                    timeout=_TIMEOUT_SECONDS,
                )
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as exc:  # httpx.HTTPError + JSON decode
                last_exc = exc
                if attempt < _RETRIES:
                    # Most Cloud API blips are shorter than this, so the user
                    # never learns one happened. Fail-closed only bites when
                    # the outage is real.
                    time.sleep(1.0 * (attempt + 1))
                    continue
                raise TextModerationError(
                    f"Cloud Natural Language moderateText failed: {exc}"
                ) from last_exc

        categories = data.get("moderationCategories")
        if categories is None:
            raise TextModerationError(
                "moderateText response had no moderationCategories."
            )

        scores = {
            c.get("name", ""): float(c.get("confidence", 0.0)) for c in categories
        }
        result = _classify(scores)

        if result.blocked:
            # Log every block with its scores. Calibration depends on being
            # able to read the first couple hundred of these — and a
            # wrongly-blocked halal complaint leaves no other trace.
            logger.warning(
                "text_moderation blocked: category=%s confidence=%.2f scores=%s",
                result.category,
                result.confidence,
                result.scores,
            )
        return result


@dataclass
class AllowAllTextModerationClient:
    """No-op client used when moderation isn't configured.

    Deliberately allow-all rather than fail-closed, and *only* reachable when
    ``TEXT_MODERATION_ENABLED`` is false. Fail-closed on an unconfigured key
    would mean a fresh local checkout can't post a review at all, which makes
    the feature undevelopable. Production sets the flag on; there's a startup
    warning below when it's off.
    """

    def evaluate(self, text: str) -> ModerationResult:  # noqa: ARG002
        return ModerationResult(verdict=ModerationVerdict.ALLOW)


#: Human-facing labels. The user is told which category tripped, so it has to
#: read like something a person wrote, not an API constant.
_CATEGORY_LABELS: dict[str, str] = {
    "Profanity": "profanity",
    "Insult": "insults",
    "Derogatory": "demeaning language",
    "Sexual": "sexual content",
    "Violent": "violent content",
    "Death, Harm & Tragedy": "violent content",
    "Firearms & Weapons": "weapons content",
}


def warning_message(result: ModerationResult) -> str:
    """The nudge shown when text is heated but publishable.

    Deliberately not a telling-off, and deliberately not about rules. It
    gives a reason grounded in what the reader wants — a review that says
    what happened is more useful than one that says how it felt — because
    "this violates our guidelines" is both untrue here and the fastest way
    to make someone dig in.

    Anger is legitimate on this platform. Someone who was served
    non-halal food is entitled to be furious, and this must never read as
    "calm down" — only as "the specifics will land harder."
    """
    del result  # scores don't change the wording; kept for symmetry
    return (
        "This reads pretty heated. Reviews that describe what happened — "
        "what you asked, what you were told, what you saw — tend to be more "
        "useful to other diners than how it felt. Post it as-is if that's "
        "what you meant to say."
    )


def rejection_message(result: ModerationResult) -> str:
    """The message shown when text is refused.

    Names the category and offers the fix. Never a bare "your review was
    rejected" — the goal is an edit, not a wounded user. The last sentence is
    load-bearing: strong criticism is exactly what this platform is for, and
    a user who reads the block as "no complaints allowed" is a user lost.
    """
    label = _CATEGORY_LABELS.get(result.category or "", "language we don't allow")
    return (
        f"This can't be posted as written — it contains {label}. "
        "Edit the wording and try again. Strong criticism is welcome; "
        "we just need it kept civil."
    )


# ---------------------------------------------------------------------------
# Factory + DI
# ---------------------------------------------------------------------------

_client_singleton: TextModerationClient | None = None


def get_text_moderation_client() -> TextModerationClient:
    """FastAPI dependency. Returns a configured moderation client.

    Reuses ``GOOGLE_MAPS_API_KEY`` — the same key Vision and Places use. The
    Natural Language API has to be enabled on the project and added to that
    key's allow-list, the same one-time step Vision needed.

    Tests override this dependency to inject a fake.
    """
    global _client_singleton

    if _client_singleton is not None:
        return _client_singleton

    if not settings.TEXT_MODERATION_ENABLED:
        logger.warning(
            "TEXT_MODERATION_ENABLED is false — review text is NOT being "
            "screened. This should only ever be the case in local dev."
        )
        _client_singleton = AllowAllTextModerationClient()
        return _client_singleton

    api_key = settings.GOOGLE_MAPS_API_KEY
    if not api_key:
        # Fail loudly at first use rather than silently allowing everything.
        # Moderation being enabled but keyless is a deployment mistake, and
        # quietly degrading to allow-all is how that mistake survives.
        raise TextModerationError(
            "TEXT_MODERATION_ENABLED is true but GOOGLE_MAPS_API_KEY is not "
            "configured; refusing to run unscreened."
        )

    _client_singleton = CloudNaturalLanguageClient(api_key=api_key)
    return _client_singleton


def reset_client_cache() -> None:
    """Test hook — drops the singleton so a fake can take its place."""
    global _client_singleton
    _client_singleton = None
