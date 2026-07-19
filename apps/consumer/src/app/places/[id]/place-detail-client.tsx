"use client";

/**
 * Client view for /places/[id].
 *
 * ## The shape, and why
 *
 * This was eight stacked cards of identical visual weight in a 768px column
 * at every screen size. Everything was legible and nothing was answered: a
 * diner arrives asking "can I eat here?", and finding out took as much work
 * as finding the opening hours.
 *
 * Now the page splits into **the answer** and **everything else**:
 *
 *   * Left (`lg` and up, sticky): the halal verdict, the actions you'd take
 *     next, and the small print. This column is why the page exists, so on a
 *     wide screen it stays put while the rest scrolls past it.
 *   * Right: photos, reviews, hours, nearby — the browsing material.
 *
 * Below `lg` it collapses to one column in that same order, which is the
 * reordering on its own. Phones get the priority change without the grid.
 *
 * ## Two things worth not undoing
 *
 * **Google's rating is not in the hero.** It used to sit beside the name at
 * full size, making somebody else's score the first and largest number on a
 * page about our verification. It lives in the reviews block now, beside
 * Trust Halal's own and the same size as it.
 *
 * **Report and claim are two lines of text, not two cards.** For a signed-out
 * visitor — most first-time traffic — those cards were large boxes whose only
 * affordance was "sign in". They were out-weighing the photos.
 *
 * Wrapped by a server component (page.tsx) that provides generateMetadata +
 * JSON-LD; the placeId is passed down explicitly so this view doesn't depend
 * on ``useParams``.
 */

import { ChevronDown, ChevronLeft, ChevronUp, Clock, ExternalLink, Flag, Globe, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FavoriteToggle } from "@/components/favorite-toggle";
import { FileDisputeDialog } from "@/components/file-dispute-dialog";
import { NearbyPlaces } from "@/components/nearby-places";
import { PlaceReviews } from "@/components/place-reviews";
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

  // Photos + the id to open when the hero is expanded into the shared
  // lightbox.
  //
  // When ``hero_photo_url`` is set but no photo in the array carries
  // ``is_hero`` (a cover that came from somewhere the photos list doesn't
  // cover), we synthesize a front slide so the header stays expandable.
  // That slide previously hardcoded ``source: "OWNER"`` — asserting the
  // restaurant supplied a photo whose provenance we don't actually know,
  // on the one surface whose entire job is honest provenance. It's now
  // GOOGLE/GOOGLE, which is what an unattributed cover on this platform in
  // practice is: the listing photo from the ingest.
  const heroLightbox = React.useMemo<{
    photos: PlacePhotoRead[];
    startPhotoId: string;
  } | null>(() => {
    const d = place.data;
    if (!d || !d.hero_photo_url) return null;
    const hero = d.photos.find((p) => p.is_hero);
    if (hero) return { photos: d.photos, startPhotoId: hero.id };
    const synthetic: PlacePhotoRead = {
      id: "__hero__",
      place_id: d.id,
      url: d.hero_photo_url,
      source: "GOOGLE",
      attribution: "GOOGLE",
      review_id: null,
      review_rating: null,
      width_px: null,
      height_px: null,
      caption: null,
      is_hero: true,
      uploaded_by_display_name: null,
      created_at: new Date(0).toISOString(),
    };
    return { photos: [synthetic, ...d.photos], startPhotoId: synthetic.id };
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
    // Widens at lg so the two-column grid below has somewhere to go — a
    // 340px sidebar inside a 768px column would leave the right side
    // narrower than the phone layout. Matches the app shell's max-w-5xl.
    <div className="mx-auto max-w-3xl space-y-5 lg:max-w-5xl">
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

          <PreferenceMatchBanner result={matchResult} />

          {/* Two columns from lg up. The halal verdict is the reason anyone
              opened this page, so on a wide screen it stops scrolling away —
              photos, reviews and hours move past it instead of pushing it off.
              Below lg this collapses to the same single column as before, in
              the same order, so phones get the reordering without the grid. */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
            <div className="space-y-4 lg:sticky lg:top-20">
              {place.data.halal_profile ? (
                <PlaceTrustSummary profile={place.data.halal_profile} />
              ) : (
                <PlaceNoTrustSummary />
              )}

              <PlaceActionCard
                place={place.data}
                onSave={
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
                }
              />

              {/* Two dead full-width cards for signed-out visitors became one
                  quiet line. Reporting matters, but it isn't what someone came
                  here to do, and it shouldn't out-weigh the photos. */}
              <PlaceFooterLinks
                placeId={placeId}
                placeName={place.data.name}
                me={me ?? null}
                disputes={disputesForThisPlace}
                hasActiveDispute={hasActiveDispute}
                onOpenDialog={() => setDisputeDialogOpen(true)}
              />
            </div>

            <div className="min-w-0 space-y-5">
              <PlacePhotoGallery
                photos={place.data.photos}
                placeName={place.data.name}
                placeId={placeId}
              />

              <PlaceReviews
                place={place.data}
                signedIn={Boolean(me?.id)}
                emailVerified={me?.email_verified === true}
              />

              <PlaceHoursCard place={place.data} />

              <NearbyPlaces place={place.data} />
            </div>
          </div>

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
              startPhotoId={heroLightbox.startPhotoId}
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

/**
 * Everything you'd actually do next, on one card: go there, call, open the
 * site, save it.
 *
 * Replaces a loose address line with two pill links floating above the trust
 * card. Getting to the restaurant is the most common action on this page and
 * it was competing with the halal verdict for attention while looking like
 * decoration.
 */
function PlaceActionCard({
  place,
  onSave,
}: {
  place: PlaceDetail;
  onSave: React.ReactNode;
}) {
  const addressParts = [
    place.address,
    [place.city, place.region].filter(Boolean).join(", "),
  ].filter(Boolean);

  // Coordinates, not the free-text address: matching an address string is
  // less reliable than a point, and this is the action most likely to be
  // taken while someone is already in the car.
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
  const websiteUrl = place.website_url
    ? place.website_url.startsWith("http")
      ? place.website_url
      : `https://${place.website_url}`
    : null;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <MapPin className="h-4 w-4" aria-hidden />
          Directions
        </a>
        {place.phone && (
          <a
            href={`tel:${place.phone.replace(/[^+\d]/g, "")}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium transition hover:bg-accent"
          >
            <Phone className="h-4 w-4" aria-hidden />
            Call
          </a>
        )}
        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium transition hover:bg-accent"
            aria-label="Visit website"
          >
            <Globe className="h-4 w-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Website</span>
          </a>
        )}
        {onSave}
      </div>

      {addressParts.length > 0 && (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <span>{addressParts.join(", ")}</span>
          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        </a>
      )}
    </section>
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
  // Collapsed by default. It used to sit high on the page where an expanded
  // week justified itself; now it's below the photos and reviews, where seven
  // lines of times is mostly scroll between you and the nearby places.
  const [open, setOpen] = React.useState(false);
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

/**
 * Report + claim, as two lines of text rather than two full-width cards.
 *
 * The old version gave "Spot something wrong?" a bordered section with a
 * heading and a button, which for a signed-out visitor — most first-time
 * traffic — was a large box whose only affordance was "Sign in to report".
 * Reporting matters, but it isn't why anyone opened this page, and it was
 * out-weighing the photos.
 *
 * Existing reports keep their full treatment: if you've filed something, its
 * status is real information about a place you cared enough to flag.
 */
function PlaceFooterLinks({
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
  // Verifiers file disputes on the diner surface like any consumer (the API
  // gates on auth, not the CONSUMER role). Only OWNER / ADMIN are the wrong
  // audience here.
  const isConsumer = isConsumerAudience(me?.role);

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        {hasActiveDispute ? (
          <span className="flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden />
            You have an open report for {placeName}.
          </span>
        ) : isConsumer ? (
          <>
            Something wrong with this profile?{" "}
            <button
              type="button"
              onClick={onOpenDialog}
              className="font-semibold text-primary hover:underline"
            >
              Report it
            </button>
          </>
        ) : isAnonymous ? (
          <>
            Something wrong with this profile?{" "}
            <Link
              href={`/login?next=/places/${placeId}`}
              className="font-semibold text-primary hover:underline"
            >
              Sign in to report it
            </Link>
          </>
        ) : (
          <>Reports are filed by signed-in diners.</>
        )}
      </p>

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Own {placeName}?{" "}
        <a
          href="https://owner.trusthalal.org/get-verified"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary hover:underline"
        >
          Claim your listing
        </a>
      </p>

      {disputes.length > 0 && (
        <div className="space-y-2 rounded-lg border bg-card p-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Your reports for this place
          </h3>
          <ul className="space-y-2">
            {disputes.map((d) => (
              <li key={d.id} className="rounded-md border bg-background p-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {DISPUTED_ATTRIBUTE_LABELS[d.disputed_attribute] ??
                      d.disputed_attribute}
                  </span>
                  <span className="text-muted-foreground">
                    {DISPUTE_STATUS_LABELS[d.status] ?? d.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 text-muted-foreground">
                  {d.description}
                </p>
                {d.admin_decision_note && (
                  <p className="mt-2 rounded-md bg-muted p-2">
                    <strong>Admin note:</strong> {d.admin_decision_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
