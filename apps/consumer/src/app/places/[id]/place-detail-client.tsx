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

import { ChevronLeft, ExternalLink, Flag, MapPin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FavoriteToggle } from "@/components/favorite-toggle";
import { FileDisputeDialog } from "@/components/file-dispute-dialog";
import { PlaceHero } from "@/components/place-hero";
import { PlacePhotoGallery } from "@/components/place-photo-gallery";
import {
  PlaceNoTrustSummary,
  PlaceTrustSummary,
} from "@/components/place-trust-summary";
import { PreferenceMatchBanner } from "@/components/preference-match-banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  type ConsumerDisputeReporter,
  type DisputeStatus,
  type DisputedAttribute,
  type PlaceDetail,
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
          <PlaceHero place={place.data} />

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

          <FileDisputeDialog
            placeId={placeId}
            placeName={place.data.name}
            open={disputeDialogOpen}
            onOpenChange={setDisputeDialogOpen}
          />
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
      <a
        href={directionsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/10"
      >
        Get directions
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </div>
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
  const isConsumer = me?.role === "CONSUMER";

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
