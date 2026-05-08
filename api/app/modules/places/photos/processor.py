"""Image-processing pipeline for owner + consumer place photo uploads.

What the pipeline does, in order:

  1. Decode the upload bytes via Pillow. HEIC files require
     ``pillow-heif`` to be registered first — that happens at module
     import time so callers don't have to think about it.
  2. Auto-rotate based on EXIF Orientation. Phones often write the
     image in sensor-native orientation and put a "rotate 90deg"
     hint in EXIF; without applying it, photos taken in portrait
     mode show up sideways on the gallery.
  3. Strip ALL EXIF. Phone-shot images embed GPS coordinates of the
     capture location, which would leak the consumer's home or
     real-time position. Mandatory for privacy.
  4. Convert HEIC → JPEG. Browsers don't render HEIC natively, so a
     stored HEIC blob would render as a broken image on the consumer
     site. JPEG quality 90 keeps file size reasonable while staying
     visually lossless for restaurant photos.
  5. Extract final dimensions for the DB row. Used by the consumer
     UI's responsive layout (avoids layout shift while loading).

I/O-free contract: takes bytes in, returns bytes out + metadata.
The actual storage write + DB row creation are owned by the upload
router so this module stays unit-testable without infrastructure.

Pillow + pillow-heif are imported at module load. If either is
missing, the import fails loudly at app startup rather than at
first upload — same posture as the Google Places client.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional

from PIL import Image, ImageOps

# pillow-heif registers HEIC/HEIF openers on Pillow's plugin
# registry as a side effect of ``register_heif_opener()``. The
# ``import`` alone isn't enough — the explicit call is part of the
# pillow-heif API.
import pillow_heif

pillow_heif.register_heif_opener()


# Browsers + Supabase Storage all serve JPEG, PNG, and WebP cleanly.
# HEIC gets converted to JPEG before write so consumers can render
# it. We keep the original Content-Type for stored JPEG/PNG/WebP so
# Supabase serves them with the right MIME type without a guess.
JPEG_QUALITY = 90

# Max dimension on either edge — anything larger gets downsized so
# we don't store 8K phone photos as-is. 2048 is plenty for a hero
# banner on a 4K monitor and keeps stored sizes under ~1 MB for
# typical content.
MAX_DIMENSION_PX = 2048


@dataclass(frozen=True, slots=True)
class ProcessedImage:
    """Output of ``process_image``. All fields populated unless
    Pillow itself failed to read the input — caller raises in that
    case before constructing one of these.
    """

    bytes_: bytes
    content_type: str  # "image/jpeg" | "image/png" | "image/webp"
    extension: str  # "jpg" | "png" | "webp"
    width_px: int
    height_px: int


class ImageProcessingError(Exception):
    """Raised when the input bytes can't be decoded as an image, or
    when output encoding fails. Routers catch this and return a 422
    with a generic "couldn't read your photo" message — we don't
    leak the underlying Pillow error to the client.
    """


def process_image(data: bytes, *, source_content_type: str) -> ProcessedImage:
    """Run the full pipeline on ``data`` and return the processed
    bytes + metadata.

    ``source_content_type`` is the MIME type from the multipart
    upload — only used to decide whether the input is HEIC and
    therefore needs format conversion. Pillow itself is the source
    of truth for the actual decode; if Pillow disagrees with the
    declared MIME we trust Pillow.
    """
    declared = (source_content_type or "").lower().strip()
    is_heic = declared in {"image/heic", "image/heif"}

    try:
        with Image.open(io.BytesIO(data)) as img:
            # exif_transpose applies any EXIF Orientation flag and
            # then the returned image has it stripped. This is the
            # idiomatic Pillow way to fix the iPhone-portrait-shows-
            # sideways problem.
            img = ImageOps.exif_transpose(img)

            # Downsize if either dimension is over the cap. ``thumbnail``
            # mutates in place and preserves aspect ratio. LANCZOS is
            # the slowest-but-best resampling filter; for one-off
            # uploads the cost doesn't matter.
            if max(img.size) > MAX_DIMENSION_PX:
                img.thumbnail(
                    (MAX_DIMENSION_PX, MAX_DIMENSION_PX),
                    resample=Image.Resampling.LANCZOS,
                )

            # Re-encode without EXIF. We construct a fresh Image
            # instance from the pixel data so any residual metadata
            # gets dropped — Pillow's EXIF stripping is otherwise
            # surprisingly leaky when re-encoding the same Image.
            stripped = Image.new(
                # ``RGB`` for JPEG output, ``RGBA`` for PNG/WebP
                # transparency. The branch below picks the right
                # mode per output format.
                _final_mode(img, prefer_rgb=is_heic),
                img.size,
            )
            stripped.paste(img, (0, 0))

            output_buffer = io.BytesIO()
            content_type, extension = _output_format(declared, is_heic)

            # PIL's ``save`` accepts a format code, not a MIME type.
            # Map content_type → format up here.
            pil_format = _content_type_to_pil_format(content_type)

            save_kwargs: dict = {"format": pil_format}
            if pil_format == "JPEG":
                save_kwargs["quality"] = JPEG_QUALITY
                # ``optimize`` lets Pillow pick a slightly smaller
                # entropy-coded representation. Adds a few hundred
                # ms to encoding; worth it for a one-off upload.
                save_kwargs["optimize"] = True
            elif pil_format == "WEBP":
                save_kwargs["quality"] = JPEG_QUALITY
                # ``method=6`` is WebP's slowest/highest-quality
                # encoding mode. Same reasoning as JPEG optimize.
                save_kwargs["method"] = 6

            stripped.save(output_buffer, **save_kwargs)

            return ProcessedImage(
                bytes_=output_buffer.getvalue(),
                content_type=content_type,
                extension=extension,
                width_px=stripped.size[0],
                height_px=stripped.size[1],
            )
    except ImageProcessingError:
        raise
    except Exception as exc:
        # Pillow can throw a wide variety of errors (UnidentifiedImageError,
        # OSError on truncated reads, ValueError, etc.). Wrap them all
        # in a single typed exception the router can handle uniformly.
        raise ImageProcessingError(
            f"Could not decode or re-encode image: {exc}"
        ) from exc


def _final_mode(img: Image.Image, *, prefer_rgb: bool) -> str:
    """Pick the Pillow image mode for the stripped buffer.

    HEIC inputs always go to RGB (we'll JPEG-encode them and JPEG
    doesn't support alpha). PNG/WebP keep their alpha channel. JPEG
    inputs stay RGB.
    """
    if prefer_rgb:
        return "RGB"
    if img.mode in {"RGBA", "LA"}:
        return "RGBA"
    if img.mode == "P" and "transparency" in img.info:
        # Palette mode with transparency — promote to RGBA so the
        # transparent pixels survive re-encoding.
        return "RGBA"
    return "RGB"


def _output_format(
    declared_content_type: str, is_heic: bool
) -> tuple[str, str]:
    """Decide what to write to storage.

    HEIC inputs always come out as JPEG (we don't store HEIC; browsers
    can't render it). JPEG/PNG/WebP inputs are preserved verbatim.
    Anything else (e.g. an image type Pillow could decode but we
    don't want to store) falls through to JPEG — defensive default.
    """
    if is_heic:
        return ("image/jpeg", "jpg")
    if declared_content_type == "image/png":
        return ("image/png", "png")
    if declared_content_type == "image/webp":
        return ("image/webp", "webp")
    return ("image/jpeg", "jpg")


def _content_type_to_pil_format(content_type: str) -> str:
    if content_type == "image/png":
        return "PNG"
    if content_type == "image/webp":
        return "WEBP"
    return "JPEG"
