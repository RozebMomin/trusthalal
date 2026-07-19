/**
 * Diner reviews on the place detail page.
 *
 * Sits between the photo gallery and the dispute section: verified facts,
 * then photos, then community opinion, then "something's wrong here".
 *
 * ## The two ratings
 *
 * Trust Halal's average and Google's are shown side by side and each is
 * labelled. This is the point of the section, not a detail of it. Before
 * reviews existed the product rendered a bare unattributed star that
 * silently meant Google's — two numbers measuring different things over
 * different populations. They must never be blended or shown unlabelled.
 */
"use client";

import { MessageSquare, Star } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  usePlaceReviews,
  type PlaceDetail,
  type PlaceReviewRead,
  type ReviewSort,
  type ReviewSummary,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

import { ConfirmEmailPrompt } from "./confirm-email-prompt";
import { ReportReviewDialog } from "./report-review-dialog";
import { WriteReviewDialog } from "./write-review-dialog";

const SORTS: Array<{ value: ReviewSort; label: string }> = [
  { value: "recent", label: "Most recent" },
  { value: "rating_high", label: "Highest first" },
  { value: "rating_low", label: "Lowest first" },
];

export function Stars({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      aria-label={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            "h-3.5 w-3.5",
            n <= rating
              ? "fill-amber-400 text-amber-400"
              : "fill-muted text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function RatingHeader({
  summary,
  onWrite,
  canReview,
  signedIn,
  emailVerified,
  hasMine,
}: {
  summary: ReviewSummary;
  onWrite: () => void;
  canReview: boolean;
  signedIn: boolean;
  emailVerified: boolean;
  hasMine: boolean;
}) {
  const max = Math.max(1, ...Object.values(summary.histogram ?? {}));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-6">
        <div className="shrink-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Trust Halal
          </div>
          {summary.count > 0 ? (
            <>
              <div className="text-4xl font-bold leading-none tracking-tight">
                {summary.average?.toFixed(1)}
              </div>
              <Stars
                rating={Math.round(summary.average ?? 0)}
                className="mt-1"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {summary.count} review{summary.count === 1 ? "" : "s"}
              </div>
            </>
          ) : (
            <div className="mt-1 max-w-[14rem] text-sm text-muted-foreground">
              No reviews yet. Be the first.
            </div>
          )}
        </div>

        {summary.count > 0 && (
          <div className="min-w-[12rem] flex-1 space-y-1 pt-1">
            {[5, 4, 3, 2, 1].map((n) => {
              const count = summary.histogram?.[String(n)] ?? 0;
              return (
                <div
                  key={n}
                  className="flex items-center gap-2 text-[11px] text-muted-foreground"
                >
                  <span className="w-4 shrink-0">{n}★</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-amber-400"
                      style={{ width: `${(count / max) * 100}%` }}
                    />
                  </span>
                  <span className="w-5 shrink-0 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Google's number, explicitly labelled as Google's. */}
        {summary.google_rating != null && (
          <div className="shrink-0 border-l pl-6">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              On Google
            </div>
            <div className="text-2xl font-bold leading-tight tracking-tight text-muted-foreground">
              {summary.google_rating.toFixed(1)}
            </div>
            {summary.google_rating_count != null && (
              <div className="text-xs text-muted-foreground">
                {summary.google_rating_count.toLocaleString()} ratings
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Reviews are from Trust Halal diners. We show Google&rsquo;s rating
          for context.
        </p>
        {/* Signed-out users get sent to sign-in rather than into a composer
            that can only fail. Opening the dialog and letting the POST 401
            is how someone writes a paragraph and then loses the argument
            with a login wall. */}
        {signedIn ? (
          <Button size="sm" onClick={onWrite}>
            {hasMine ? "Edit your review" : "Write a review"}
          </Button>
        ) : (
          <Button size="sm" asChild>
            <a
              href={`/login?next=${encodeURIComponent(
                typeof window === "undefined" ? "/" : window.location.pathname,
              )}`}
            >
              Sign in to review
            </a>
          </Button>
        )}
      </div>

      {/* Explain a disabled action rather than hiding it — someone who can't
          review should learn why here, not by pressing a button that fails. */}
      {!canReview && !hasMine && signedIn && !emailVerified && (
        <ConfirmEmailPrompt />
      )}
    </div>
  );
}

function ReviewRow({
  review,
  placeName,
  onReport,
  onEdit,
}: {
  review: PlaceReviewRead;
  /** The restaurant, not the organization that owns it — see the reply
   *  byline below. */
  placeName: string;
  onReport: (r: PlaceReviewRead) => void;
  onEdit: () => void;
}) {
  const initial = (review.author.display_name ?? "?").charAt(0).toUpperCase();

  return (
    <li className="border-t py-5 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {review.author.display_name ?? "A diner"}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <Stars rating={review.rating} />
            <span>· {relativeDate(review.created_at)}</span>
            {review.visited_on && (
              <span>
                · visited{" "}
                {new Date(review.visited_on).toLocaleDateString(undefined, {
                  month: "short",
                  year: "numeric",
                })}
              </span>
            )}
            {review.edited_at && <span>· edited</span>}
          </div>
        </div>
      </div>

      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
        {review.body}
      </p>

      {review.photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {review.photos.map((p) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={p.id}
              src={p.url}
              alt=""
              loading="lazy"
              className="h-20 w-20 rounded-lg border object-cover"
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-xs font-medium text-muted-foreground">
        {review.is_mine ? (
          <button type="button" onClick={onEdit} className="hover:text-foreground">
            Edit
          </button>
        ) : review.reported_by_me ? (
          <span>Reported</span>
        ) : (
          <button
            type="button"
            onClick={() => onReport(review)}
            className="hover:text-foreground"
          >
            ⚑ Report
          </button>
        )}
      </div>

      {review.reply && (
        <div className="ml-11 mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          {/* The restaurant, not the owning organization.
              `organization_name` is the legal entity — "Khan Restaurants
              LLC" — which a diner reading a review of Jay's Deli has never
              heard of and can't connect to the place they're looking at.
              It also broke a promise the product makes: the owner's
              composer says "Posting publicly as Jay's Deli", and this
              rendered something else entirely.

              One org can own several restaurants, so the org name is
              strictly less specific here too — the reply is from this
              location. */}
          <div className="text-[11px] font-bold text-primary">
            ✓ Response from {placeName} ·{" "}
            {relativeDate(review.reply.created_at)}
          </div>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/85">
            {review.reply.body}
          </p>
        </div>
      )}
    </li>
  );
}

export function PlaceReviews({
  place,
  signedIn,
  emailVerified,
}: {
  place: PlaceDetail;
  signedIn: boolean;
  emailVerified: boolean;
}) {
  const [sort, setSort] = React.useState<ReviewSort>("recent");
  const [writeOpen, setWriteOpen] = React.useState(false);
  const [reportTarget, setReportTarget] =
    React.useState<PlaceReviewRead | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  const reviews = usePlaceReviews(place.id, sort);
  const data = reviews.data;
  const items = data?.items ?? [];
  const shown = expanded ? items : items.slice(0, 5);

  const mine = items.find((r) => r.is_mine) ?? null;

  return (
    <section
      aria-labelledby="reviews-heading"
      className="rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <h2
        id="reviews-heading"
        className="mb-4 flex items-center gap-2 text-base font-semibold tracking-tight"
      >
        <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
        Reviews
      </h2>

      {reviews.isLoading && (
        <p className="text-sm text-muted-foreground">Loading reviews…</p>
      )}

      {data && (
        <>
          <RatingHeader
            summary={data.summary}
            canReview={data.can_review}
            signedIn={signedIn}
            emailVerified={emailVerified}
            hasMine={Boolean(mine)}
            onWrite={() => setWriteOpen(true)}
          />

          {items.length > 0 && (
            <>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {data.total} review{data.total === 1 ? "" : "s"}
                </span>
                {/* One sort option per honest ordering. No "most helpful" —
                    there are no helpful votes to back it. */}
                <div className="flex gap-1.5">
                  {SORTS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setSort(s.value)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                        sort === s.value
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <ul className="mt-2">
                {shown.map((r) => (
                  <ReviewRow
                    key={r.id}
                    review={r}
                    placeName={place.name}
                    onReport={setReportTarget}
                    onEdit={() => setWriteOpen(true)}
                  />
                ))}
              </ul>

              {items.length > shown.length && (
                <div className="border-t pt-4 text-center">
                  <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
                    Show all {items.length} reviews
                  </Button>
                </div>
              )}
            </>
          )}

          {/* An unclaimed place has nobody who can reply, which makes this
              a conversion surface rather than a dead end. Gated on the real
              signal — showing "claim this" to a restaurant that already has
              would read as broken. */}
          {place.is_claimed === false && items.length > 0 && (
            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed">
              <span className="font-semibold">Own {place.name}?</span> Claim
              your restaurant to reply to these reviews publicly and add your
              halal details.{" "}
              <a
                href="https://owner.trusthalal.org/get-verified"
                className="font-semibold text-primary underline underline-offset-2"
              >
                Get verified →
              </a>
            </div>
          )}
        </>
      )}

      {writeOpen && (
        <WriteReviewDialog
          placeId={place.id}
          placeName={place.name}
          existing={mine}
          open
          onOpenChange={setWriteOpen}
        />
      )}

      {reportTarget && (
        <ReportReviewDialog
          placeId={place.id}
          review={reportTarget}
          open
          onOpenChange={(next) => {
            if (!next) setReportTarget(null);
          }}
        />
      )}
    </section>
  );
}
