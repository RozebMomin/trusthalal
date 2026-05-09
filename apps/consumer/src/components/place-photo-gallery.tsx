/**
 * Photo gallery for the place detail page.
 *
 * Shape:
 *
 *   - Hero is already shown by ``PlaceHero`` so this gallery starts at
 *     the second photo. If the place only has the one hero shot, the
 *     gallery doesn't render at all.
 *   - Up to 5 thumbnails visible (grid: 2 columns mobile, 3 columns
 *     desktop). The 5th thumbnail flips to a "+N more" overlay when
 *     there are extra photos beyond what fits in the grid.
 *   - Tapping any thumbnail opens a lightbox that lets the visitor
 *     page through every photo (hero included) with arrow keys, the
 *     prev/next buttons, or a fling on touch devices.
 *   - Each lightbox slide carries an attribution chip ("Owner upload"
 *     vs. "Customer upload") and an optional caption.
 *
 * Photo URLs land directly from the API (Supabase public bucket). No
 * image-optimization layer in front of them yet, so we render plain
 * <img> with eager-load on the lightbox view and lazy-load on the
 * thumbnails — the gallery sits below the fold.
 */
"use client";

import {
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  X,
} from "lucide-react";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlacePhotoRead, PlacePhotoSource } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<PlacePhotoSource, string> = {
  OWNER: "Owner upload",
  CONSUMER: "Customer upload",
};

// 5 visible thumbnails leaves us a 2x3 (mobile) / 3x2 (desktop) grid
// that doesn't dwarf the rest of the page. Anything past index 4 gets
// the "+N more" overlay on the last visible thumbnail.
const MAX_VISIBLE_THUMBNAILS = 5;

export function PlacePhotoGallery({
  photos,
  placeName,
}: {
  photos: PlacePhotoRead[];
  placeName: string;
}) {
  // Hooks first — the early-return for "no extra photos" comes after
  // the state declaration so React's rules-of-hooks invariant holds.
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  // Render nothing when there's at most a single photo. The hero
  // takes care of the only-photo-present case visually; a one-tile
  // gallery would feel like a layout glitch.
  if (photos.length <= 1) {
    return null;
  }

  // The hero is already shown above; the gallery's "first" tile is
  // the second photo in the photos array. We still let the lightbox
  // scroll back to the hero so the visitor can see the full set.
  const heroLessPhotos = photos.slice(1);
  const visible = heroLessPhotos.slice(0, MAX_VISIBLE_THUMBNAILS);
  const hiddenCount = heroLessPhotos.length - visible.length;

  return (
    <section
      aria-labelledby="photo-gallery-heading"
      className="space-y-3"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2
          id="photo-gallery-heading"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <ImageIcon
            className="h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          Photos
          <span className="text-sm font-normal text-muted-foreground">
            ({photos.length})
          </span>
        </h2>
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map((photo, idx) => {
          const isLastVisible =
            idx === visible.length - 1 && hiddenCount > 0;
          // The lightbox indexes against the FULL photos array
          // (including hero), so add 1 to skip the hero.
          const lightboxIndex = idx + 1;
          return (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => setOpenIndex(lightboxIndex)}
                className={cn(
                  "group relative block aspect-square w-full overflow-hidden rounded-lg border bg-muted",
                  "transition hover:border-foreground/30 hover:shadow-sm",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                aria-label={
                  isLastVisible
                    ? `View all ${photos.length} photos`
                    : `View photo ${lightboxIndex + 1} of ${photos.length}`
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={
                    photo.caption
                      ? photo.caption
                      : `${placeName} — photo ${lightboxIndex + 1}`
                  }
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
                {isLastVisible && hiddenCount > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-0 flex items-center justify-center",
                      "bg-black/55 text-base font-semibold text-white",
                    )}
                  >
                    +{hiddenCount} more
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {openIndex !== null && (
        <Lightbox
          photos={photos}
          placeName={placeName}
          startIndex={openIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lightbox — full-bleed photo with prev/next controls. Built on the
// shared Dialog primitive but with a pointer-events-pass-through so
// the photo can fill the screen rather than sit inside the dialog
// chrome.
// ---------------------------------------------------------------------------

function Lightbox({
  photos,
  placeName,
  startIndex,
  onClose,
}: {
  photos: PlacePhotoRead[];
  placeName: string;
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = React.useState(startIndex);

  // Clamp on prop change — defensive for the edge case where the
  // start index exceeds bounds (shouldn't happen, but cheap to belt
  // and suspender).
  React.useEffect(() => {
    if (startIndex >= photos.length) {
      setIndex(photos.length - 1);
    } else if (startIndex < 0) {
      setIndex(0);
    } else {
      setIndex(startIndex);
    }
  }, [startIndex, photos.length]);

  const goPrev = React.useCallback(() => {
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);
  const goNext = React.useCallback(() => {
    setIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  // Keyboard navigation. The Dialog primitive already handles Esc to
  // close; we add Left / Right on top.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  const photo = photos[index];

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        // Override the default modal sizing so the photo can fill
        // most of the viewport. Hide the default close button — we
        // render a custom one with a more contrast-friendly tone.
        className={cn(
          "w-[calc(100%-1rem)] max-w-5xl max-h-[95dvh]",
          "overflow-hidden border-0 bg-black p-0 sm:p-0",
          "[&>button]:hidden",
        )}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          {photo?.caption
            ? `${placeName} — ${photo.caption}`
            : `${placeName} — photo ${index + 1} of ${photos.length}`}
        </DialogTitle>

        <div className="relative flex h-[80dvh] w-full items-center justify-center">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={photo.url}
              alt={
                photo.caption
                  ? photo.caption
                  : `${placeName} — photo ${index + 1}`
              }
              loading="eager"
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
          )}

          {/* Prev / Next */}
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous photo"
                className={cn(
                  "absolute left-3 top-1/2 -translate-y-1/2",
                  "rounded-full bg-black/60 p-2 text-white",
                  "transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white",
                )}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="Next photo"
                className={cn(
                  "absolute right-3 top-1/2 -translate-y-1/2",
                  "rounded-full bg-black/60 p-2 text-white",
                  "transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white",
                )}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          {/* Custom close — we hid the default Dialog X above. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photo viewer"
            className={cn(
              "absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white",
              "transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Caption / attribution strip below the photo. */}
        {photo && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-black/90 px-4 py-3 text-xs text-white/85">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white/15 px-2 py-0.5 font-medium">
                {SOURCE_LABEL[photo.source]}
              </span>
              {photo.uploaded_by_display_name && (
                <span className="text-white/70">
                  by {photo.uploaded_by_display_name}
                </span>
              )}
              {photo.is_hero && (
                <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/80">
                  Hero
                </span>
              )}
            </div>

            <span className="text-white/70">
              {index + 1} / {photos.length}
            </span>
          </div>
        )}

        {photo?.caption && (
          <p className="bg-black/90 px-4 pb-4 text-sm text-white/95">
            {photo.caption}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Re-export so test files / story files can import the lightbox alone
// without coupling to the gallery layout.
export { Lightbox as PlacePhotoLightbox };
