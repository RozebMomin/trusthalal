"use client";

/**
 * Reviews for one place, inside its management page.
 *
 * The global /my-reviews inbox is the triage surface — "who is waiting on
 * me, across everything". This is the opposite view: everything about *this*
 * restaurant, including the ones already answered, so an owner looking at a
 * single location sees the whole picture rather than only the backlog.
 *
 * Reply composition is shared with the inbox rather than duplicated: the
 * guidance copy and the moderation error handling need to stay identical,
 * and two copies drift.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  useDeleteReviewReply,
  useEditReviewReply,
  useOwnerReviews,
  useReplyToReview,
  type OwnerReviewRead,
} from "@/lib/api/hooks";

const REPLY_MAX = 3000;

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-600" aria-label={`${rating} of 5 stars`}>
      {"★".repeat(rating)}
      <span className="text-muted-foreground/40">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function relative(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function ReviewItem({ review }: { review: OwnerReviewRead }) {
  const reply = useReplyToReview();
  const editReply = useEditReviewReply();
  const removeReply = useDeleteReviewReply();

  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState(review.reply?.body ?? "");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const editing = review.reply != null;
  const pending = reply.isPending || editReply.isPending;
  const canSubmit = body.trim().length > 0 && !pending;

  async function submit() {
    if (!canSubmit) return;
    setErrorMsg(null);
    try {
      const payload = { reviewId: review.id, body: body.trim() };
      if (editing) await editReply.mutateAsync(payload);
      else await reply.mutateAsync(payload);
      setOpen(false);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't post that reply",
      });
      // Owner replies go through the same content filter as diners'. A 503
      // means the check couldn't run at all — not that the reply was judged.
      setErrorMsg(
        status === 503
          ? "We couldn't run our content check just now — that's on us. Try again in a moment."
          : description,
      );
    }
  }

  return (
    <li className="border-t py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">
          {review.author.display_name ?? "A diner"}
        </span>
        <span className="text-xs text-muted-foreground">
          {relative(review.created_at)}
          {review.edited_at ? " · edited" : ""}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <Stars rating={review.rating} />
        {review.open_report_count > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
            {review.open_report_count} report
            {review.open_report_count === 1 ? "" : "s"} pending
          </span>
        )}
      </div>

      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
        {review.body}
      </p>

      {review.photos.length > 0 && (
        <div className="mt-2 flex gap-2">
          {review.photos.map((p) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={p.id}
              src={p.url}
              alt=""
              className="h-16 w-16 rounded border object-cover"
            />
          ))}
        </div>
      )}

      {review.reply && !open && (
        <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
          <div className="text-[11px] font-bold text-primary">
            Your reply · {relative(review.reply.created_at)}
            {review.reply.edited_at && " · edited"}
          </div>
          <p className="mt-1 whitespace-pre-line text-sm">{review.reply.body}</p>
          <div className="mt-2 flex gap-3 text-xs font-medium text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                setBody(review.reply?.body ?? "");
                setOpen(true);
              }}
              className="hover:text-foreground"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete your reply?")) {
                  removeReply.mutate(review.id);
                }
              }}
              className="hover:text-destructive"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {!open && !review.reply && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => {
            setBody("");
            setOpen(true);
          }}
        >
          Reply
        </Button>
      )}

      {open && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
            Replies are public and permanent. The ones that work: thank them,
            state the fact plainly, say what changed.
          </p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={REPLY_MAX}
            autoFocus
            className="w-full rounded-md border bg-background p-2 text-sm"
          />
          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={!canSubmit} onClick={submit}>
              {pending ? "Checking…" : editing ? "Save reply" : "Post reply"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setErrorMsg(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function PlaceReviewsSection({ placeId }: { placeId: string }) {
  const [needsReply, setNeedsReply] = React.useState(false);
  const query = useOwnerReviews({ placeId, needsReply });

  const items = query.data?.items ?? [];
  // The inbox's needs_reply_count spans every managed place, so it's the
  // wrong number here — derive this place's own from the rows.
  const unanswered = (query.data?.items ?? []).filter((r) => !r.reply).length;

  return (
    <section className="space-y-4 rounded-md border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Reviews</h2>
        <p className="text-sm text-muted-foreground">
          What diners have said about this restaurant, and your replies.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            [false, "All"],
            [true, "Needs reply"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={String(key)}
            type="button"
            onClick={() => setNeedsReply(key)}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium transition " +
              (needsReply === key
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground")
            }
          >
            {label}
            {key && !needsReply && unanswered > 0 && (
              <span className="ml-1 opacity-70">{unanswered}</span>
            )}
          </button>
        ))}
      </div>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Loading reviews…</p>
      )}

      {query.data && items.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {needsReply
            ? "Nothing waiting on you here."
            : "No reviews yet. They'll appear as diners write them."}
        </div>
      )}

      {items.length > 0 && (
        <ul>
          {items.map((r) => (
            <ReviewItem key={r.id} review={r} />
          ))}
        </ul>
      )}
    </section>
  );
}
