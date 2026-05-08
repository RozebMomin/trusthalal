"""Cloud Vision SafeSearch — content-safety gate for photo uploads.

The pipeline runs every uploaded image through SafeSearch before
the bytes reach the storage bucket. SafeSearch returns five
likelihood scores (``adult``, ``violence``, ``racy``, ``medical``,
``spoof``); we reject on ``adult >= LIKELY`` or
``violence >= LIKELY``, allow everything else.

Why a Protocol + a real implementation?
---------------------------------------
Tests inject an in-memory fake (e.g. "always pass" or "always
fail") via ``app.dependency_overrides``. Production uses
``CloudVisionSafeSearchClient`` which calls Google Cloud Vision
with the same API key bound to ``GOOGLE_MAPS_API_KEY`` on Render —
the key has Vision API in its allow-list (see task #97 audit).

Why API key auth instead of a service account?
----------------------------------------------
Same key as Places + Places (New). One key, one env var, one
rotation point. Service accounts are the "right" answer for
production-grade infra and a future hardening pass should adopt
them; for now this matches the rest of the codebase's posture.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Optional, Protocol

from google.api_core.client_options import ClientOptions
from google.cloud.vision_v1 import (
    AnnotateImageRequest,
    Feature,
    Image as VisionImage,
    ImageAnnotatorClient,
    Likelihood,
)

from app.core.config import settings


# Reproduce the relevant likelihood ordering as a plain IntEnum so
# downstream comparisons (``score >= LIKELY``) read naturally and we
# don't have to import the proto enum at every call site.
class SafeSearchLikelihood(IntEnum):
    UNKNOWN = 0
    VERY_UNLIKELY = 1
    UNLIKELY = 2
    POSSIBLE = 3
    LIKELY = 4
    VERY_LIKELY = 5


@dataclass(frozen=True, slots=True)
class SafeSearchResult:
    """Five-axis likelihood scores returned by the Vision API.

    ``passes`` is the boolean shortcut the pipeline checks: True
    when neither the adult nor violence axis is at LIKELY+. The
    individual scores stay on the dataclass so tests can assert
    on borderline rejections / Sentry breadcrumbs can carry the
    full picture.
    """

    adult: SafeSearchLikelihood
    violence: SafeSearchLikelihood
    racy: SafeSearchLikelihood
    medical: SafeSearchLikelihood
    spoof: SafeSearchLikelihood

    @property
    def passes(self) -> bool:
        return (
            self.adult < SafeSearchLikelihood.LIKELY
            and self.violence < SafeSearchLikelihood.LIKELY
        )


class SafeSearchClient(Protocol):
    """Contract for SafeSearch implementations.

    Tests inject in-memory implementations; production uses
    ``CloudVisionSafeSearchClient``. Pure-bytes input keeps the
    contract testable without wiring Cloud Vision into the test
    harness.
    """

    def evaluate(self, data: bytes) -> SafeSearchResult: ...


class SafeSearchError(Exception):
    """Raised when SafeSearch can't reach Vision or the response
    shape is unexpected. The router translates this to a 503 so the
    client can show "content scan unavailable, try again" instead
    of a generic 500.
    """


@dataclass(frozen=True)
class CloudVisionSafeSearchClient:
    """Google Cloud Vision SafeSearch implementation.

    Constructed with the same API key the Places ingest uses. Each
    call is one HTTP round-trip (~300-800ms typical). The Vision
    SDK's ``ImageAnnotatorClient`` keeps an internal connection
    pool, so reusing the same client across requests is preferable
    — the factory below caches one as a singleton.
    """

    api_key: str

    def evaluate(self, data: bytes) -> SafeSearchResult:
        client = ImageAnnotatorClient(
            client_options=ClientOptions(api_key=self.api_key)
        )

        request = AnnotateImageRequest(
            image=VisionImage(content=data),
            features=[Feature(type_=Feature.Type.SAFE_SEARCH_DETECTION)],
        )

        try:
            response = client.annotate_image(request=request)
        except Exception as exc:
            # google-cloud-vision raises various subclasses of
            # google.api_core.exceptions.GoogleAPICallError. Wrap
            # them all so the router has a single typed exception
            # to catch.
            raise SafeSearchError(
                f"Cloud Vision SafeSearch call failed: {exc}"
            ) from exc

        if response.error and response.error.message:
            raise SafeSearchError(
                f"Cloud Vision SafeSearch returned error: "
                f"{response.error.message}"
            )

        annotations = response.safe_search_annotation
        if annotations is None:
            raise SafeSearchError(
                "Cloud Vision SafeSearch response had no annotations."
            )

        return SafeSearchResult(
            adult=_likelihood_from_proto(annotations.adult),
            violence=_likelihood_from_proto(annotations.violence),
            racy=_likelihood_from_proto(annotations.racy),
            medical=_likelihood_from_proto(annotations.medical),
            spoof=_likelihood_from_proto(annotations.spoof),
        )


def _likelihood_from_proto(value: Likelihood) -> SafeSearchLikelihood:
    """Map the proto enum value to our int-backed copy.

    Proto enums in google-cloud-vision share the same ordering
    UNKNOWN..VERY_LIKELY (0..5) as our IntEnum so the cast is
    direct, but going through a function means a future SDK rev
    that changes the ordering wouldn't silently break us.
    """
    return SafeSearchLikelihood(int(value))


# ---------------------------------------------------------------------------
# Factory + DI
# ---------------------------------------------------------------------------

_safesearch_client_singleton: SafeSearchClient | None = None


def get_safesearch_client() -> SafeSearchClient:
    """FastAPI dependency. Returns a configured SafeSearchClient.

    Reuses ``GOOGLE_MAPS_API_KEY`` — the key already has Cloud
    Vision in its allow-list (task #97 audit). Tests override this
    dependency to inject an in-memory fake.

    Raises ``SafeSearchError`` if the key isn't configured. The
    upload route surfaces that as a 503, which is the right
    posture: the photo isn't broken, the moderation infrastructure
    is, so retrying later may succeed.
    """
    global _safesearch_client_singleton

    if _safesearch_client_singleton is not None:
        return _safesearch_client_singleton

    api_key = settings.GOOGLE_MAPS_API_KEY
    if not api_key:
        raise SafeSearchError(
            "GOOGLE_MAPS_API_KEY is not configured; SafeSearch is unavailable."
        )

    _safesearch_client_singleton = CloudVisionSafeSearchClient(api_key=api_key)
    return _safesearch_client_singleton
