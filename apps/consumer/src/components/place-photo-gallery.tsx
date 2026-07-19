/**
 * Photo gallery for the place detail page.
 *
 * Shape:
 *
 *   - The hero is already shown by ``PlaceHero``, so it's excluded here.
 *     If the place has nothing but its hero, the gallery renders an empty
 *     state rather than disappearing, so the page rhythm holds.
 *   - Up to 5 thumbnails (2 columns mobile, 3 desktop). The last visible
 *     tile flips to a "+N more" overlay when there are extras.
 *   - Tapping a thumbnail opens a lightbox spanning *every* photo,
 *     hero included, so a visitor can page back to it.
 *
 * ## Addressing photos by id, not by position
 *
 * This component previously did `photos.slice(1)` — assuming the hero was
 * always index 0 — and passed array offsets to the lightbox, which then did
 * its own `+1` arithmetic to compensate. Two coupled index maps, both
 * positional, both silently wrong the moment the array is filtered or
 * reordered (which grouping by provenance does).
 *
 * Everything now addresses photos by **id**. The lightbox is told which
 * photo to open and which list to page through, and derives position
 * itself. Filtering the grid can't desynchronise anything, because there
 * are no offsets to keep in sync.
 */
"use client";

import { ChevronLeft, ChevronRight, Flag, ImageIcon, Store, X } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { PhotoAttribution, PlacePhotoRead } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

import { ReportPhotoDialog } from "./report-photo-dialog";

/** Which side of the house a photo came from.
 *
 *  Two buckets, not four: readers want "the restaurant" vs "diners", and
 *  folding GOOGLE in with OWNER and REVIEW in with DINER is what they
 *  actually mean. Four tabs where two will do is furniture. */
function isOwnerSide(photo: PlacePhotoRead): boolean {
  return photo.attribution === "OWNER" || photo.attribution === "GOOGLE";
}

type PhotoTab = "all" | "owner" | "diner";

/** Below this, tabs are furniture — you can see every photo at once. */
const TABS_MIN_PHOTOS = 6;

/** Human labels for provenance.
 *
 *  Keyed off `attribution`, not `source`. The old map keyed off `source` and
 *  had no entry for GOOGLE, so backfilled photos — which exist in production
 *  — rendered an empty chip. */
const ATTRIBUTION_LABEL: Record<PhotoAttribution, string> = {
  OWNER: "From the restaurant",
  DINER: "From a diner",
  REVIEW: "From a review",
  GOOGLE: "From Google",
};

// 5 visible thumbnails leaves a grid that doesn't dwarf the rest of the
// page. Anything past that gets the "+N more" overlay on the last tile.
const MAX_VISIBLE_THUMBNAILS = 5;

export function PlacePhotoGallery({
  photos,
  placeName,
  placeId,
}: {
  photos: PlacePhotoRead[];
  placeName: string;
  placeId: string;
}) {
  // Hooks before any early return, so the rules-of-hooks invariant holds.
  const [openPhotoId, setOpenPhotoId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<PhotoTab>("all");
  const [reportPhotoId, setReportPhotoId] = React.useState<string | null>(null);

  // Exclude the hero by its flag rather than by position. `slice(1)` was
  // only correct because the API happens to sort hero-first; that coupling
  // is invisible from here and breaks silently if the order ever changes.
  const galleryPhotos = React.useMemo(
    () => photos.filter((p) => !p.is_hero),
    [photos],
  );

  // Counts come from the unfiltered set so the labels stay put when you
  // switch tabs. A count that changes when you click a filter isn't a
  // count, it's a search result.
  const counts = React.useMemo(() => {
    const owner = galleryPhotos.filter(isOwnerSide).length;
    return {
      all: galleryPhotos.length,
      owner,
      diner: galleryPhotos.length - owner,
    };
  }, [galleryPhotos]);

  const filtered = React.useMemo(() => {
    if (tab === "owner") return galleryPhotos.filter(isOwnerSide);
    if (tab === "diner") return galleryPhotos.filter((p) => !isOwnerSide(p));
    return galleryPhotos;
  }, [galleryPhotos, tab]);

  // Tabs only earn their space once there are enough photos to scan, and
  // only when both sides are actually represented — a "By diners (0)" tab
  // is a dead end dressed as a choice.
  const showTabs =
    galleryPhotos.length >= TABS_MIN_PHOTOS &&
    counts.owner > 0 &&
    counts.diner > 0;

  const visible = filtered.slice(0, MAX_VISIBLE_THUMBNAILS);
  const hiddenCount = filtered.length - visible.length;

  const reportTarget = photos.find((p) => p.id === reportPhotoId) ?? null;

  return (
    <section aria-labelledby="photo-gallery-heading" className="space-y-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2
          id="photo-gallery-heading"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
          Photos
          {photos.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({photos.length})
            </span>
          )}
        </h2>
      </header>

      {showTabs && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter photos">
          {(
            [
              ["all", "All", counts.all],
              ["owner", "By the restaurant", counts.owner],
              ["diner", "By diners", counts.diner],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === key
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {label}{" "}
              <span className={tab === key ? "opacity-70" : "opacity-60"}>
                {count}
              </span>
            </button>
          ))}
        </div>
      )}

      {galleryPhotos.length === 0 && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {photos.length === 0
            ? "No photos yet."
            : "Only the cover photo is on file so far."}{" "}
          Owners can add more from the owner portal.
        </div>
      )}

      {galleryPhotos.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visible.map((photo, idx) => {
            const isLastVisible =
              idx === visible.length - 1 && hiddenCount > 0;
            return (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => setOpenPhotoId(photo.id)}
                  className={cn(
                    "group relative block aspect-square w-full overflow-hidden rounded-lg border bg-muted",
                    "transition hover:border-foreground/30 hover:shadow-sm",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  aria-label={
                    isLastVisible
                      ? `View all ${photos.length} photos`
                      : `View photo: ${ATTRIBUTION_LABEL[photo.attribution]}${
                          photo.caption ? ` — ${photo.caption}` : ""
                        }`
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={photo.caption ?? `${placeName} — photo`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                  {/* Provenance on the grid itself, not only in the
                      lightbox. The grid is what people actually scan; an
                      anonymous wall of thumbnails is precisely the problem
                      this feature exists to fix. */}
                  {!isLastVisible && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute bottom-1 left-1 flex items-center gap-1 rounded-full",
                        "bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white",
                      )}
                    >
                      {isOwnerSide(photo) ? (
                        <>
                          <Store className="h-2.5 w-2.5" />
                          Restaurant
                        </>
                      ) : (
                        <>
                          {photo.uploaded_by_display_name?.charAt(0).toUpperCase() ??
                            "D"}
                          <span className="sr-only">Diner photo</span>
                          {photo.attribution === "REVIEW" ? "Review" : "Diner"}
                        </>
                      )}
                    </span>
                  )}
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
      )}

      {openPhotoId !== null && (
        <Lightbox
          photos={photos}
          placeName={placeName}
          startPhotoId={openPhotoId}
          onClose={() => setOpenPhotoId(null)}
          onReport={(id) => {
            setOpenPhotoId(null);
            setReportPhotoId(id);
          }}
        />
      )}

      {reportTarget && (
        <ReportPhotoDialog
          placeId={placeId}
          photo={reportTarget}
          open
          onOpenChange={(next) => {
            if (!next) setReportPhotoId(null);
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lightbox — full-bleed photo with prev/next controls.
//
// Takes the id of the photo to open rather than its index. Position is
// derived here and nowhere else, so a caller can pass any subset of photos
// in any order without arithmetic on either side.
// ---------------------------------------------------------------------------

function Lightbox({
  photos,
  placeName,
  startPhotoId,
  onClose,
  onReport,
}: {
  photos: PlacePhotoRead[];
  placeName: string;
  startPhotoId: string;
  onClose: () => void;
  onReport?: (photoId: string) => void;
}) {
  const startIndex = React.useMemo(() => {
    const i = photos.findIndex((p) => p.id === startPhotoId);
    // -1 would mean the caller passed an id that isn't in this list. Opening
    // at the first photo is a better failure than a blank modal.
    return i >= 0 ? i : 0;
  }, [photos, startPhotoId]);

  const [index, setIndex] = React.useState(startIndex);

  React.useEffect(() => {
    setIndex(startIndex);
  }, [startIndex]);

  const goPrev = React.useCallback(() => {
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);
  const goNext = React.useCallback(() => {
    setIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  // Dialog handles Esc; we add Left / Right on top.
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
              alt={photo.caption ?? `${placeName} — photo ${index + 1}`}
              loading="eager"
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
          )}

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

        {/* Attribution strip. */}
        {photo && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-black/90 px-4 py-3 text-xs text-white/85">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white/15 px-2 py-0.5 font-medium">
                {ATTRIBUTION_LABEL[photo.attribution]}
              </span>
              {photo.uploaded_by_display_name && (
                <span className="text-white/70">
                  by {photo.uploaded_by_display_name}
                </span>
              )}
              {photo.attribution === "REVIEW" && photo.review_rating != null && (
                <span className="text-white/70">
                  · {photo.review_rating}★ review
                </span>
              )}
              {photo.is_hero && (
                <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/80">
                  Cover
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Reporting is the only lever anyone has over someone else's
                  photo — including the restaurant, which cannot delete it. */}
              {onReport && photo.id !== "__hero__" && !isOwnerSide(photo) && (
                <button
                  type="button"
                  onClick={() => onReport(photo.id)}
                  className="flex items-center gap-1 text-white/70 transition hover:text-white"
                >
                  <Flag className="h-3 w-3" />
                  Report
                </button>
              )}
              <span className="text-white/70">
                {index + 1} / {photos.length}
              </span>
            </div>
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

// Re-export so test / story files can import the lightbox alone.
export { Lightbox as PlacePhotoLightbox };
