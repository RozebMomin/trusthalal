"use client";

/**
 * Owner portal — single-place detail page.
 *
 * The architectural separation we made in this branch:
 *
 *   * /my-halal-claims/[id]    →  ONLY halal-related — questionnaire,
 *                                 evidence attachments, submit state.
 *   * /my-places/[id]          →  EVERYTHING ELSE about a place that
 *                                 the owner manages — cuisine tags,
 *                                 photos (incl. hero selection), and
 *                                 a list of any halal claims attached
 *                                 to this place.
 *
 * Why split: claim editor was creeping into "edit anything about
 * the place" territory (cuisine, photos), which conflated two
 * different lifecycles. Halal claims are short-lived per-submission
 * artifacts that go through review; place metadata is long-lived
 * and edited continuously. Separate pages keep the mental model
 * clean and let each page focus on its own primary action.
 *
 * Disputes + activity history sections are deferred — they need
 * owner-facing API surfaces that don't exist yet (consumer
 * disputes filed against this place, place-level event timeline).
 * Stub-now-ship-later was rejected by the user; we'll add them in
 * a follow-up PR once the API exists.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  HalalClaimStatusBadge,
  halalClaimStatusDescription,
} from "@/components/halal-claim-status-badge";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type Cuisine,
  type MyHalalClaimRead,
  type PlaceDetail,
  type PlacePhotoRead,
  CUISINE_LABELS,
  CUISINE_OPTIONS,
  useDeletePlacePhoto,
  useMyHalalClaims,
  usePatchMyOwnedPlace,
  usePatchPlacePhoto,
  usePlaceDetail,
  usePlacePhotos,
  useUploadPlacePhoto,
} from "@/lib/api/hooks";

export default function MyPlaceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: place, isLoading, isError, error } = usePlaceDetail(id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (isError) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Link
          href="/my-places"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← All places
        </Link>
        <p
          role="alert"
          className="rounded-md border bg-card px-4 py-3 text-sm text-destructive"
        >
          {status === 404
            ? "We couldn't find that place."
            : "Couldn't load this place. Try refreshing."}
        </p>
      </div>
    );
  }
  if (!place) return null;
  return <PlaceDetailBody place={place} />;
}

function PlaceDetailBody({ place }: { place: PlaceDetail }) {
  const addressLine =
    [place.address, place.city, place.country_code]
      .filter(Boolean)
      .join(" · ") || "No address on file";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <Link
          href="/my-places"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← All places
        </Link>
        <div className="flex flex-wrap items-start gap-4">
          <PlaceHeroThumb url={place.hero_photo_url} />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">
              {place.name}
            </h1>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {addressLine}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              Place {place.id.slice(0, 8)}
            </p>
            <p className="mt-3 text-xs">
              <a
                href={`/places/${place.id}`}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:underline"
              >
                View public page ↗
              </a>
            </p>
          </div>
        </div>
      </header>

      <CuisineSection place={place} />
      <PhotosSection placeId={place.id} />
      <HalalClaimsForPlaceSection placeId={place.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero thumbnail in the page header — small enough to be glanceable
// without dominating the layout. Falls back to a neutral placeholder
// when no hero is set so the layout doesn't shift after the first
// upload.
// ---------------------------------------------------------------------------
function PlaceHeroThumb({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div
        aria-hidden
        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground"
      >
        No hero
      </div>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt=""
      aria-hidden
      className="h-20 w-20 shrink-0 rounded-md border object-cover"
    />
  );
}

// ---------------------------------------------------------------------------
// Cuisine section — moved verbatim from the claim editor in the
// PR-A.5 architectural split. Same hook, same UX, just a different
// home. Place metadata, not claim metadata.
// ---------------------------------------------------------------------------
function CuisineSection({ place }: { place: PlaceDetail }) {
  const initial = React.useMemo<Cuisine[]>(
    () => place.cuisine_types ?? [],
    [place.cuisine_types],
  );
  const [selected, setSelected] = React.useState<Cuisine[]>(initial);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSelected(initial);
  }, [initial]);

  const patch = usePatchMyOwnedPlace();

  const dirty = React.useMemo(() => {
    if (selected.length !== initial.length) return true;
    const a = new Set(initial);
    return selected.some((c) => !a.has(c));
  }, [selected, initial]);

  function toggle(c: Cuisine) {
    setError(null);
    setSelected((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  async function onSave() {
    setError(null);
    try {
      await patch.mutateAsync({
        placeId: place.id,
        patch: { cuisine_types: selected },
      });
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't save cuisine tags",
      });
      setError(description);
    }
  }

  function onCancel() {
    setSelected(initial);
    setError(null);
  }

  return (
    <section className="space-y-4 rounded-md border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Cuisine tags</h2>
        <p className="text-sm text-muted-foreground">
          Pick the cuisines this place serves. Diners filter restaurants
          by cuisine on the consumer site, so accurate tags help the
          right people find you.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {CUISINE_OPTIONS.map((c) => {
          const isOn = selected.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              aria-pressed={isOn}
              className={
                isOn
                  ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors"
                  : "rounded-full border border-input bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              }
            >
              {CUISINE_LABELS[c]}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onSave}
          disabled={!dirty || patch.isPending}
        >
          {patch.isPending ? "Saving…" : "Save cuisines"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={!dirty || patch.isPending}
        >
          Cancel
        </Button>
        <p className="text-xs text-muted-foreground">
          {selected.length === 0
            ? "No cuisines selected"
            : `${selected.length} selected`}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Photos section — moved from the claim editor. Same hooks, same
// UX. Always editable (not gated by anything claim-status-related
// since photos are place metadata).
// ---------------------------------------------------------------------------
const PHOTO_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const PHOTO_ALLOWED_HUMAN = "JPEG, PNG, WebP, HEIC";
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

function PhotosSection({ placeId }: { placeId: string }) {
  const photosQuery = usePlacePhotos(placeId);
  const upload = useUploadPlacePhoto();
  const patch = usePatchPlacePhoto();
  const remove = useDeletePlacePhoto();

  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const photos = photosQuery.data ?? [];
  const heroId = photos.find((p) => p.is_hero)?.id ?? null;

  function onPickFile() {
    fileInputRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    if (!PHOTO_ALLOWED_MIME.has(file.type)) {
      setError(`Allowed photo types: ${PHOTO_ALLOWED_HUMAN}.`);
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setError(
        `Photos must be ${Math.floor(PHOTO_MAX_BYTES / (1024 * 1024))} MB or smaller.`,
      );
      return;
    }

    try {
      await upload.mutateAsync({ placeId, file });
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.code === "PLACE_PHOTO_INAPPROPRIATE_CONTENT") {
        setError(
          "This photo doesn't meet our content guidelines. Please choose a different photo.",
        );
        return;
      }
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't upload that photo",
      });
      setError(description);
    }
  }

  async function onSetHero(photo: PlacePhotoRead) {
    setError(null);
    try {
      await patch.mutateAsync({
        placeId,
        photoId: photo.id,
        patch: { is_hero: true },
      });
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't set the hero photo",
      });
      setError(description);
    }
  }

  async function onDelete(photo: PlacePhotoRead) {
    setError(null);
    if (
      !window.confirm(
        photo.is_hero
          ? "Delete the hero photo? Your place will have no cover image until you pick a new one."
          : "Delete this photo? This cannot be undone from here.",
      )
    ) {
      return;
    }
    try {
      await remove.mutateAsync({ placeId, photoId: photo.id });
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't delete that photo",
      });
      setError(description);
    }
  }

  return (
    <section className="space-y-4 rounded-md border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Photos</h2>
        <p className="text-sm text-muted-foreground">
          Upload photos of your restaurant. Pick one to be the cover image
          diners see in search results and at the top of your place page.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onPickFile} disabled={upload.isPending}>
          {upload.isPending ? "Uploading…" : "Upload photo"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {PHOTO_ALLOWED_HUMAN} · up to{" "}
          {Math.floor(PHOTO_MAX_BYTES / (1024 * 1024))} MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={Array.from(PHOTO_ALLOWED_MIME).join(",")}
          onChange={onFileChange}
          className="hidden"
          aria-hidden
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {photosQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading photos…</p>
      ) : photos.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No photos yet. Add one so diners know what to expect.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              isHero={photo.id === heroId}
              busy={patch.isPending || remove.isPending}
              onSetHero={() => onSetHero(photo)}
              onDelete={() => onDelete(photo)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PhotoCard({
  photo,
  isHero,
  busy,
  onSetHero,
  onDelete,
}: {
  photo: PlacePhotoRead;
  isHero: boolean;
  busy: boolean;
  onSetHero: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={
        "group relative overflow-hidden rounded-md border bg-muted " +
        (isHero ? "ring-2 ring-primary" : "")
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.caption ?? "Place photo"}
        className="aspect-square w-full object-cover"
        loading="lazy"
      />
      {isHero && (
        <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
          Hero
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {!isHero && (
          <button
            type="button"
            onClick={onSetHero}
            disabled={busy}
            className="rounded-full bg-background/90 px-2 py-1 text-xs font-medium text-foreground hover:bg-background disabled:opacity-60"
          >
            Set as hero
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="ml-auto rounded-full bg-destructive/90 px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive disabled:opacity-60"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Halal claims for this place — connective tissue between place
// management and claim management. Lists every claim the caller has
// on this place, with status badges and links into the claim editor.
//
// Filters the unified `/me/halal-claims` list client-side rather
// than calling a place-scoped server endpoint. The list is small
// (an owner has at most a handful of claims per place across the
// claim's lifecycle), so client-side filtering keeps the API
// surface minimal.
// ---------------------------------------------------------------------------
function HalalClaimsForPlaceSection({ placeId }: { placeId: string }) {
  const claimsQuery = useMyHalalClaims();
  const claims = (claimsQuery.data ?? []).filter(
    (c: MyHalalClaimRead) => c.place_id === placeId,
  );

  return (
    <section className="space-y-4 rounded-md border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Halal claims</h2>
        <p className="text-sm text-muted-foreground">
          The halal questionnaire submissions you&rsquo;ve filed for this
          place. Open one to edit, attach evidence, or submit for review.
        </p>
      </div>

      {claimsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading claims…</p>
      ) : claims.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No halal claims yet for this place.{" "}
          <Link
            href={`/my-halal-claims/new?place_id=${placeId}`}
            className="underline-offset-4 hover:underline"
          >
            Start one
          </Link>
          .
        </div>
      ) : (
        <ul className="space-y-2">
          {claims.map((c) => (
            <li key={c.id}>
              <Link
                href={`/my-halal-claims/${c.id}`}
                className="block rounded-md border bg-background px-4 py-3 transition hover:border-foreground/40 hover:bg-accent/20"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">
                      {c.id.slice(0, 8)}
                    </p>
                    <p className="text-sm">
                      {halalClaimStatusDescription(c.status)}
                    </p>
                  </div>
                  <HalalClaimStatusBadge status={c.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
