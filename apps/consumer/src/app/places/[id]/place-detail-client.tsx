"use client";

/**
 * Client view for /places/[id].
 *
 * Renders a place's name, address, full halal profile (when one
 * exists), and the caller's existing dispute history for this place.
 * Anchored by the search results list — clicking any row from the
 * home page lands here.
 *
 * Auth posture:
 *   * Anonymous visitors see the full read surface (it's public).
 *     The "Report an issue" trigger swaps to a "Sign in to report"
 *     link.
 *   * Signed-in CONSUMERs see the full file-a-dispute dialog.
 *   * Signed-in OWNER / ADMIN / VERIFIER see the read surface but
 *     not the consumer dispute UI — those audiences have their own
 *     surfaces for managing disputes (admin panel, owner portal).
 *     The AppShell already shows them a "this isn't your portal"
 *     pointer; we don't repeat it here.
 *
 * Wrapped by a server component (page.tsx) which provides
 * generateMetadata + JSON-LD structured data; the placeId is passed
 * down explicitly so this view doesn't depend on `useParams`.
 */

import { ChevronLeft, Flag, MapPin } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { HalalProfileDetail } from "@/components/halal-profile-detail";
import { FileDisputeDialog } from "@/components/file-dispute-dialog";
import { PreferenceMatchBanner } from "@/components/preference-match-banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  type ConsumerDisputeReporter,
  type DisputeStatus,
  type DisputedAttribute,
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back to search
      </Link>

      {place.isLoading && <PlaceLoading />}

      {place.error && <PlaceError error={place.error as Error} />}

      {place.data && (
        <>
          <PlaceHeader place={place.data} />

          <PreferenceMatchBanner result={matchResult} />

          {place.data.halal_profile ? (
            <HalalProfileDetail profile={place.data.halal_profile} />
          ) : (
            <NoHalalProfileNotice />
          )}

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

function PlaceHeader({
  place,
}: {
  place: NonNullable<ReturnType<typeof usePlaceDetail>["data"]>;
}) {
  const addressParts = [
    place.address,
    [place.city, place.region].filter(Boolean).join(", "),
    place.country_code,
  ].filter(Boolean);

  return (
    <header className="space-y-2 pt-2">
      {place.is_deleted && (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          This restaurant has been removed from the directory. The
          page is preserved so existing links don&apos;t 404.
        </p>
      )}
      <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">
        {place.name}
      </h1>
      {addressParts.length > 0 && (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="break-words">{addressParts.join(" · ")}</span>
        </p>
      )}
    </header>
  );
}

function NoHalalProfileNotice() {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">
        No halal profile yet.
      </p>
      <p className="mt-1">
        This restaurant hasn&apos;t been verified by Trust Halal. If
        you own or know this place, ask the owner to submit a halal
        claim through the owner portal.
      </p>
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
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">
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
    <div className="space-y-6">
      <div className="space-y-2 pt-2">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
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
