"use client";

/**
 * /my-reviews — everything you've written, including what was taken down.
 *
 * ## Why this page exists
 *
 * The public listing on a place filters to PUBLISHED. So before this page,
 * a review that was hidden or removed was invisible to the person who wrote
 * it — it simply stopped being there, and the removal email was the only
 * explanation that ever existed. An email in a spam folder meant someone's
 * words disappeared with no reason given anywhere they could reach.
 *
 * That's the failure this page prevents, which is why moderated reviews are
 * the ones it treats most carefully: they sort to the top, they carry the
 * moderator's note verbatim, and hidden ones keep an Edit affordance because
 * hidden is reversible and fixing it is the point.
 *
 * The rest — your published reviews, owner replies to them — is secondary,
 * useful mostly because a person who came here after a takedown shouldn't
 * land on a page that only shows them bad news.
 */

import { MessageSquareText } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCurrentUser,
  useMyReviews,
  type MyReviewRead,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-600" aria-label={`${rating} of 5 stars`}>
      {"★".repeat(rating)}
      <span className="text-muted-foreground/40">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function relativeDate(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export default function MyReviewsPage() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const isAuthenticated = Boolean(me);
  const reviews = useMyReviews({ enabled: isAuthenticated });

  // Moderated first. Someone arriving here has usually just been told
  // something came down, and making them scroll past six published reviews
  // to find it would be a strange thing to do to them.
  const sorted = React.useMemo(() => {
    const items = reviews.data ?? [];
    const rank = (r: MyReviewRead) =>
      r.status === "REMOVED" ? 0 : r.status === "HIDDEN" ? 1 : 2;
    return [...items].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [reviews.data]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1 pt-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <MessageSquareText className="h-6 w-6 text-primary" aria-hidden />
          Your reviews
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything you&apos;ve written, including anything moderation acted
          on.
        </p>
      </header>

      {meLoading && <SkeletonList />}

      {!meLoading && !isAuthenticated && (
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">
            Sign in to see your reviews
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            Your reviews are tied to your account, so we need to know who you
            are before we can show them.
          </p>
          <Button asChild className="mt-4">
            <Link href="/login?next=/my-reviews">Sign in</Link>
          </Button>
        </div>
      )}

      {isAuthenticated && (
        <>
          {reviews.isLoading && <SkeletonList />}
          {reviews.error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Couldn&apos;t load your reviews. Refresh and try again.
            </div>
          )}
          {reviews.data && sorted.length === 0 && (
            <div className="rounded-2xl border border-dashed p-8 text-center">
              <h2 className="text-lg font-semibold tracking-tight">
                You haven&apos;t written any yet
              </h2>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
                Reviews are how other diners find out what a place is actually
                like — what you ordered, what you asked, what they said.
              </p>
              <Button asChild className="mt-4" variant="outline">
                <Link href="/">Find a restaurant</Link>
              </Button>
            </div>
          )}
          {sorted.length > 0 && (
            <ul className="space-y-3">
              {sorted.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: MyReviewRead }) {
  const removed = review.status === "REMOVED";
  const hidden = review.status === "HIDDEN";
  const moderated = removed || hidden;

  return (
    <li
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm sm:p-5",
        moderated && "border-amber-300",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {review.place ? (
          <Link
            href={`/places/${review.place_id}`}
            className="font-semibold hover:underline"
          >
            {review.place.name}
          </Link>
        ) : (
          <span className="font-semibold">A restaurant</span>
        )}
        <span className="text-xs text-muted-foreground">
          {relativeDate(review.created_at)}
          {review.edited_at ? " · edited" : ""}
        </span>
      </div>

      <div className="mt-1">
        <Stars rating={review.rating} />
      </div>

      {/* The moderation note is rendered verbatim and above the review,
          because it was written *to* this person and it's the reason they
          opened the page. Paraphrasing a takedown reason is how a
          disagreement becomes a grievance. */}
      {moderated && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
          <span className="block font-semibold">
            {removed
              ? "This review was removed"
              : "This review is hidden while we look at it"}
          </span>
          {review.moderation_note ? (
            <p className="mt-1 whitespace-pre-line">{review.moderation_note}</p>
          ) : (
            <p className="mt-1">
              No reason was recorded, which shouldn&apos;t happen — get in
              touch and we&apos;ll explain.
            </p>
          )}
          <p className="mt-2 text-xs">
            {removed
              ? "Removals are final. If your review described something factual about a restaurant's halal status, you can raise that separately as a dispute on the restaurant's page — that goes to a person and stays on the record as your account."
              : "Hidden is reversible. Edit it to address the note above and it can go back up."}
          </p>
        </div>
      )}

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

      {review.reply && (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="text-[11px] font-bold text-primary">
            ✓ Response from {review.place?.name ?? "the restaurant"} ·{" "}
            {relativeDate(review.reply.created_at)}
          </div>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/85">
            {review.reply.body}
          </p>
        </div>
      )}

      {/* Edit lives on the place page, where the composer already is.
          Removed reviews get no edit affordance — the server refuses, and
          offering a button that can only fail is worse than not offering
          one. */}
      {!removed && (
        <div className="mt-3">
          <Button asChild size="sm" variant="outline">
            <Link href={`/places/${review.place_id}`}>
              {hidden ? "Edit this review" : "View on the restaurant page"}
            </Link>
          </Button>
        </div>
      )}
    </li>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-3">
      {[0, 1, 2].map((i) => (
        <li key={i} className="rounded-xl border bg-card p-5 shadow-sm">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-24" />
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
        </li>
      ))}
    </ul>
  );
}
