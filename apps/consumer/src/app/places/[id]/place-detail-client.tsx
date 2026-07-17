"use client";

/**
 * Client view for /places/[id] — refreshed for the aesthetic pass.
 *
 * Renders, top to bottom:
 *
 *   1. Back-to-search link.
 *   2. Hero banner — full-bleed photo with overlayed name, cuisine
 *      chips, and primary halal trust pill (``PlaceHero``).
 *   3. Address strip (with MapPin icon) right under the hero so the
 *      "where" is one glance away from the "what".
 *   4. Preference-match banner — when the visitor has saved filters
 *      and this place hits them.
 *   5. Trust summary card — ``PlaceTrustSummary`` consolidates what
 *      used to be seven separate panels into one scannable block.
 *      Falls back to ``PlaceNoTrustSummary`` when the place hasn't
 *      been claimed yet.
 *   6. Photo gallery — thumbnail grid + lightbox for any photo
 *      beyond the hero.
 *   7. Dispute section — auth-gated CTA + the visitor's existing
 *      reports for this place.
 *
 * Wrapped by a server component (page.tsx) that provides
 * generateMetadata + JSON-LD; the placeId is passed down explicitly
 * so this view doesn't depend on ``useParams``.
 */

import { ChevronDown, ChevronLeft, ChevronUp, Clock, ExternalLink, Flag, Globe, MapPin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FavoriteToggle } from "@/components/favorite-toggle";
import { FileDisputeDialog } from "@/components/file-dispute-dialog";
import { NearbyPlaces } from "@/components/nearby-places";
import { PlaceHero } from "@/components/place-hero";
import {
  PlacePhotoGallery,
  PlacePhotoLightbox,
} from "@/components/place-photo-gallery";
import {
  PlaceNoTrustSummary,
  PlaceTrustSummary,
} from "@/components/place-trust-summary";
import { PreferenceMatchBanner } from "@/components/preference-match-banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  type ConsumerDisputeReporter,
  type DisputeStatus,
  type DisputedAttribute,
  type PlaceDetail,
  type PlacePhotoRead,
  isConsumerAudience,
  useCurrentUser,
  useMyDisputes,
  usePlaceDetail,
} from "@/lib/api/hooks";
import { useMyPreferences } from "@/lib/api/preferences";
import { matchProfileToPreferences } from "@/lib/preferences/match";

const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: "Open — awaiting review",
  OWNER_RECONCILING: "Owner is responding",
  ADMIN_REVIEWING: "Trust Halal is reviewing",
  RESOLVED_UPHELD: "Resolved — your report was upheld",
  RESOLVED_DISMISSED: "Resolved — report dismissed",
  WITHDRAWN: "Withdrawn",
};

const DISPUTED_ATTRIBUTE_LABELS: Record<DisputedAttribute, string> = {
  PORK_SERVED: "Pork is served",
  ALCOHOL_PRESENT: "Alcohol is served",
  MENU_POSTURE_INCORRECT: "Menu posture is wrong",
  SLAUGHTER_METHOD_INCORRECT: "Slaughter method is wrong",
  CERTIFICATION_INVALID: "Certificate is invalid or expired",
  PLACE_CLOSED: "The restaurant has closed",
  OTHER: "Other",
};

// Statuses where the dispute is still in flight from the consumer's
// point of view. We use this to gate the "you already have an open
// report" hint on the file-a-dispute button.
const ACTIVE_DISPUTE_STATUSES: DisputeStatus[] = [
  "OPEN",
  "OWNER_RECONCILING",
  "ADMIN_REVIEWING",
];

export function PlaceDetailClient({ placeId }: { placeId: string }) {
  const place = usePlaceDetail(placeId);
  const { data: me } = useCurrentUser();
  const isAuthenticated = Boolean(me);

  // Only fetch /me/disputes when the caller is signed in. The hook
  // would 401 otherwise and we don't want to rate-limit anonymous
  // page loads.
  const myDisputes = useMyDisputes({ enabled: isAuthenticated });

  // Saved preferences (server-of-record for signed-in consumers,
  // localStorage for anonymous). Drives the "matches your preferences"
  // banner when at least one filter is set.
  const prefsQuery = useMyPreferences({ isAuthenticated });
  const matchResult = React.useMemo(
    () =>
      matchProfileToPreferences(
        place.data?.halal_profile ?? null,
        prefsQuery.data ?? {
          min_validation_tier: null,
          min_menu_posture: null,
          no_pork: null,
          no_alcohol_served: null,
          has_certification: null,
          updated_at: null,
        },
      ),
    [place.data?.halal_profile, prefsQuery.data],
  );

  const [disputeDialogOpen, setDisputeDialogOpen] = React.useState(false);
  const [heroExpanded, setHeroExpanded] = React.useState(false);

  // Photos + start index for expanding the hero into the shared
  // lightbox. The hero is the is_hero photo in ``photos``; if the
  // convenience ``hero_photo_url`` is set but somehow isn't in the
  // array, synthesize a front slide so the header stays expandable.
  const heroLightbox = React.useMemo<{
    photos: PlacePhotoRead[];
    startIndex: number;
  } | null>(() => {
    const d = place.data;
    if (!d || !d.hero_photo_url) return null;
    const idx = d.photos.findIndex((p) => p.is_hero);
    if (idx >= 0) return { photos: d.photos, startIndex: idx };
    const synthetic: PlacePhotoRead = {
      id: "__hero__",
      place_id: d.id,
      url: d.hero_photo_url,
      source: "OWNER",
      width_px: null,
      height_px: null,
      caption: null,
      is_hero: true,
      uploaded_by_display_name: null,
      created_at: new Date(0).toISOString(),
    };
    return { photos: [synthetic, ...d.photos], startIndex: 0 };
  }, [place.data]);

  const disputesForThisPlace = React.useMemo<ConsumerDisputeReporter[]>(
    () =>
      (myDisputes.data ?? []).filter((d) => d.place_id === placeId),
    [myDisputes.data, placeId],
  );

  const hasActiveDispute = disputesForThisPlace.some((d) =>
    ACTIVE_DISPUTE_STATUSES.includes(d.status),
  );

  const router = useRouter();

  // Guarantee the page opens at the top. Without this, entering from
  // a scrolled results list can land the viewport mid-page (the
  // async-loaded content shifts heights after Next's own scroll
  // reset, leaving the header + back link out of view).
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [placeId]);

  /**
   * Back-link handler. The link's static ``href="/"`` is the
   * fallback for users who arrived via deep-link / fresh tab — but
   * for the common case (search → result-card click → detail),
   * we want to restore the search page WITH all the user's filters
   * + query intact, not blow them away with a fresh "/".
   *
   * ``router.back()`` walks the browser history one step, which
   * naturally restores the search URL (q, lat/lng/radius, cuisine
   * chips, etc. all live in the URL on the search page). The
   * ``window.history.length > 1`` guard is the "is there anywhere
   * to go back to?" check — true when the user navigated within
   * the SPA, false on a fresh tab where the detail page is the
   * only entry. We let the Link's default navigation to ``/``
   * carry that case.
   */
  function handleBackClick(e: React.MouseEvent) {
    if (
      typeof window !== "undefined" &&
      window.history.length > 1
    ) {
      e.preventDefault();
      router.back();
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/"
        onClick={handleBackClick}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back to search
      </Link>

      {place.isLoading && <PlaceLoading />}

      {place.error && <PlaceError error={place.error as Error} />}

      {place.data && (
        <>
          <PlaceHero
            place={place.data}
            onExpand={heroLightbox ? () => setHeroExpanded(true) : undefined}
          />

          {/* Address + quick actions row. Address sits left, the
              save-to-favorites toggle sits right so the heart is
              reachable without scrolling past the trust card.
              Wraps gracefully on narrow widths. */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <PlaceAddressLine place={place.data} />
            <FavoriteToggle
              place={{
                id: place.data.id,
                name: place.data.name,
                address: place.data.address,
                lat: place.data.lat,
                lng: place.data.lng,
                city: place.data.city,
                region: place.data.region,
                country_code: place.data.country_code,
                cuisine_types: place.data.cuisine_types,
                hero_photo_url: place.data.hero_photo_url,
                halal_profile: place.data.halal_profile,
              }}
              variant="inline"
            />
          </div>

          <PreferenceMatchBanner result={matchResult} />

          {place.data.halal_profile ? (
            <PlaceTrustSummary profile={place.data.halal_profile} />
          ) : (
            <PlaceNoTrustSummary />
          )}

          <PlaceHoursCard place={place.data} />

          <PlacePhotoGallery
            photos={place.data.photos}
            placeName={place.data.name}
          />

          <DisputeSection
            placeId={placeId}
            placeName={place.data.name}
            me={me ?? null}
            disputes={disputesForThisPlace}
            hasActiveDispute={hasActiveDispute}
            onOpenDialog={() => setDisputeDialogOpen(true)}
          />

          <NearbyPlaces place={place.data} />

          <FileDisputeDialog
            placeId={placeId}
            placeName={place.data.name}
            open={disputeDialogOpen}
            onOpenChange={setDisputeDialogOpen}
          />

          {heroExpanded && heroLightbox && (
            <PlacePhotoLightbox
              photos={heroLightbox.photos}
              placeName={place.data.name}
              startIndex={heroLightbox.startIndex}
              onClose={() => setHeroExpanded(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function PlaceAddressLine({ place }: { place: PlaceDetail }) {
  const addressParts = [
    place.address,
    [place.city, place.region].filter(Boolean).join(", "),
    place.country_code,
  ].filter(Boolean);

  if (addressParts.length === 0) return null;

  // Tappable address → Google Maps directions. Coordinates are the
  // destination (more reliable than free-text address matching);
  // the visible text stays the human-readable address. Getting to
  // the restaurant is the single most common action on this page,
  // so it shouldn't require copy-pasting an address.
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;

  return (
    <div className="flex flex-col gap-1.5">
      <a
        href={directionsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-start gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span className="break-words underline-offset-2 group-hover:underline">
          {addressParts.join(" · ")}
        </span>
      </a>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/10"
        >
          Get directions
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        {place.website_url && (
          <a
            href={
              place.website_url.startsWith("http")
                ? place.website_url
                : `https://${place.website_url}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/10"
          >
            <Globe className="h-3 w-3" aria-hidden />
            Visit website
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Google-sourced opening hours — a calm card with an Open/Closed status
// line over the full week, expanded by default. A quiet "from Google" line
// sets freshness. Renders nothing when the place has no hours on file.
// ---------------------------------------------------------------------------
// Weekday index Monday=0 .. Sunday=6 (matches Google's Monday-first
// weekday_text) for "now" in the given IANA timezone. Falls back to the
// browser's local day when tz is missing or unrecognized.
function weekdayIndexInTz(tz: string | null): number {
  const now = new Date();
  if (tz) {
    try {
      const wd = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
      }).format(now);
      const map: Record<string, number> = {
        Mon: 0,
        Tue: 1,
        Wed: 2,
        Thu: 3,
        Fri: 4,
        Sat: 5,
        Sun: 6,
      };
      if (wd in map) return map[wd];
    } catch {
      // Unknown tz string — fall through to browser-local.
    }
  }
  return (now.getDay() + 6) % 7;
}

function PlaceHoursCard({ place }: { place: PlaceDetail }) {
  const week = place.opening_hours_weekday_text ?? null;
  const hasHours = Boolean(week && week.length > 0);
  const [open, setOpen] = React.useState(true);
  if (!hasHours || !week) return null;

  // Google's weekdayDescriptions are Monday-first. Compute "today" in
  // the PLACE's timezone, not the visitor's browser — otherwise a diner
  // in a different timezone (or near midnight) sees the wrong day
  // highlighted. Falls back to browser-local when tz is unknown. The
  // open/closed status itself is already computed server-side against
  // the place timezone, so this only aligns the weekly-list highlight.
  const todayIdx = weekdayIndexInTz(place.timezone);
  const splitLine = (line: string): [string, string] => {
    const m = line.match(/^(.*?):\s(.+)$/);
    return m ? [m[1], m[2]] : [line, ""];
  };
  const todayTime = week[todayIdx] ? splitLine(week[todayIdx])[1] : null;
  const status =
    place.open_now == null ? null : place.open_now ? "Open now" : "Closed";
  const synced = place.google_synced_at
    ? new Date(place.google_synced_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <Clock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="text-sm">
            {status ? (
              <span
                className={cn(
                  "font-semibold",
                  place.open_now ? "text-primary" : "text-muted-foreground",
                )}
              >
                {status}
              </span>
            ) : (
              <span className="font-semibold">Hours</span>
            )}
            {todayTime && (
              <span className="text-muted-foreground">{` · Today ${todayTime}`}</span>
            )}
          </span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>

      {open && (
        <ul className="mt-3 space-y-1.5 pl-[26px]">
          {week.map((line, i) => {
            const [day, time] = splitLine(line);
            const isToday = i === todayIdx;
            return (
              <li
                key={i}
                className={cn(
                  "flex justify-between text-sm",
                  isToday
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <span>{isToday ? "Today" : day}</span>
                <span>{time}</span>
              </li>
            );
          })}
        </ul>
      )}

      {synced && (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Ratings &amp; hours from Google · updated {synced}
        </p>
      )}
    </section>
  );
}

function DisputeSection({
  placeId,
  placeName,
  me,
  disputes,
  hasActiveDispute,
  onOpenDialog,
}: {
  placeId: string;
  placeName: string;
  me: ReturnType<typeof useCurrentUser>["data"] | null;
  disputes: ConsumerDisputeReporter[];
  hasActiveDispute: boolean;
  onOpenDialog: () => void;
}) {
  const isAnonymous = me === null;
  // Verifiers file disputes on the diner surface like any consumer
  // (the API gates on auth, not the CONSUMER role). Only OWNER / ADMIN
  // get the quiet "wrong audience" note.
  const isConsumer = isConsumerAudience(me?.role);

  // Staff / owner accounts get a quiet section — they shouldn't be
  // filing consumer disputes from the public site.
  const wrongAudience = me !== null && !isConsumer;

  return (
    <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">
            Spot something wrong?
          </h2>
          <p className="text-sm text-muted-foreground">
            Report inaccuracies in {placeName}&rsquo;s halal profile
            and we&rsquo;ll review it.
          </p>
        </div>

        {isAnonymous && (
          <Link
            href={`/login?next=/places/${placeId}`}
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <Flag className="h-4 w-4" /> Sign in to report
          </Link>
        )}

        {isConsumer && !hasActiveDispute && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenDialog}
            className="gap-2"
          >
            <Flag className="h-4 w-4" /> Report an issue
          </Button>
        )}

        {isConsumer && hasActiveDispute && (
          <span className="inline-flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-3 py-1.5 text-xs text-muted-foreground">
            You have an open report for this place.
          </span>
        )}

        {wrongAudience && (
          <span className="inline-flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-3 py-1.5 text-xs text-muted-foreground">
            Disputes are filed by signed-in consumers.
          </span>
        )}
      </div>

      {disputes.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your reports for this place
          </h3>
          <ul className="space-y-2">
            {disputes.map((d) => (
              <li
                key={d.id}
                className="rounded-md border bg-background p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {DISPUTED_ATTRIBUTE_LABELS[d.disputed_attribute] ??
                      d.disputed_attribute}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {DISPUTE_STATUS_LABELS[d.status] ?? d.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 text-muted-foreground">
                  {d.description}
                </p>
                {d.admin_decision_note && (
                  <p className="mt-2 rounded-md bg-muted p-2 text-xs">
                    <strong>Admin note:</strong>{" "}
                    {d.admin_decision_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Loading + error states
// ---------------------------------------------------------------------------

function PlaceLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="aspect-[16/9] w-full rounded-xl sm:aspect-[5/2]" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

function PlaceError({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  if (isApi && error.status === 404) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-base font-semibold">Place not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This restaurant may have been removed, or the link might be
          out of date.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm underline"
        >
          Go back to search
        </Link>
      </div>
    );
  }
  const friendly = isApi
    ? error.message
    : "Couldn't load this place. Please try again in a moment.";
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1">{friendly}</p>
    </div>
  );
}
