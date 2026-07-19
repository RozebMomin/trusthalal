"use client";

/**
 * The owner's review inbox.
 *
 * Defaults to "needs reply" — the actionable bucket — because that's the
 * only reason a global inbox exists rather than just a tab on each place.
 * An owner with four restaurants shouldn't have to click into each one to
 * find out somebody is waiting on them.
 *
 * Replies compose inline rather than in a dialog. The point of this screen
 * is working through several in a sitting, and a modal per reply turns that
 * into a chore.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  useDeleteReviewReply,
  useEditReviewReply,
  useOwnerReviews,
  useReplyToReview,
  useResendVerification,
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

function ReviewCard({ review }: { review: OwnerReviewRead }) {
  const reply = useReplyToReview();
  const editReply = useEditReviewReply();
  const removeReply = useDeleteReviewReply();

  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState(review.reply?.body ?? "");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = React.useState(false);
  const resendVerify = useResendVerification();

  const editing = review.reply != null;
  const pending = reply.isPending || editReply.isPending;
  const canSubmit = body.trim().length > 0 && !pending;

  async function submit(acknowledgedWarning = false) {
    if (!canSubmit) return;
    setErrorMsg(null);
    setWarning(null);
    try {
      const payload = {
        reviewId: review.id,
        body: body.trim(),
        acknowledgedWarning,
      };
      if (editing) await editReply.mutateAsync(payload);
      else await reply.mutateAsync(payload);
      setOpen(false);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const code = (err as { code?: string })?.code;
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't post that reply",
      });
      // Owners get the same nudge diners do. An owner replying angrily in
      // public does more damage to Trust Halal than the review that provoked
      // it, so this is the one audience it's most worth asking twice.
      if (code === "REVIEW_TEXT_WARNING") {
        setWarning(description);
        return;
      }
      // Owners are held to the same content filter as diners. Worth saying
      // plainly rather than letting them wonder what happened.
      // 403 here means the account's email was never confirmed. Accounts
      // that predate verification were never sent a link, so "check your
      // inbox" would point at nothing — offer to send one instead.
      if (status === 403) {
        setNeedsVerify(true);
        setErrorMsg(null);
      } else {
        setErrorMsg(
          status === 503
            ? "We couldn't run our content check just now — that's on us. Try again in a moment."
            : description,
        );
      }
    }
  }

  return (
    <li className="rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-semibold">
            {review.author.display_name ?? "A diner"}
          </span>
          {review.place && (
            <Link
              href={`/my-places/${review.place_id}`}
              className="ml-2 text-sm text-muted-foreground hover:underline"
            >
              · {review.place.name}
            </Link>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {relative(review.created_at)}
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

      {/* The diner rewrote this after you answered it. Said up front, above
          the reply, because the action this card wants is "re-read your reply
          against the new text" — not "reply", which the owner already did. */}
      {review.edited_after_reply && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <b>This review changed after you replied.</b>{" "}
          {review.edited_at && `Edited ${relative(review.edited_at)}. `}
          Diners currently see a note saying so under your reply. Editing your
          reply — even slightly — clears it.
        </div>
      )}

      {review.reply && !open && (
        <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
          <div className="text-[11px] font-bold text-primary">
            Your reply · {relative(review.reply.created_at)}
            {review.reply.edited_at && " · edited"}
          </div>
          <p className="mt-1 whitespace-pre-line text-sm">
            {review.reply.body}
          </p>
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
          {/* Most first-time owners reply defensively to criticism, and a
              public argument costs more than the review did. One line of
              framing here measurably changes what gets written. */}
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
            placeholder="Thanks for coming in…"
            className="w-full rounded-md border bg-background p-2 text-sm"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Posting publicly as{" "}
              <b className="text-foreground">
                {review.place?.name ?? "your restaurant"}
              </b>
            </span>
            <span>
              {body.length} / {REPLY_MAX}
            </span>
          </div>
          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}
          {warning && (
            <div
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900"
            >
              <span className="block font-semibold">Worth a second look</span>
              {warning}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setWarning(null)}
                >
                  Let me edit it
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => submit(true)}
                >
                  {pending ? "Posting…" : "Post anyway"}
                </Button>
              </div>
            </div>
          )}
          {needsVerify && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 p-3">
              <p className="text-xs leading-relaxed text-amber-900">
                {resendVerify.isSuccess
                  ? `Sent — check ${resendVerify.data?.email} and click the link, then post your reply.`
                  : "Confirm your email address before replying publicly."}
              </p>
              {!resendVerify.isSuccess && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resendVerify.isPending}
                  onClick={() => resendVerify.mutate({ audience: "owner" })}
                >
                  {resendVerify.isPending ? "Sending…" : "Send me the link"}
                </Button>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={!canSubmit} onClick={() => submit(false)}>
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

/**
 * Which bucket the inbox is showing.
 *
 * "updated" exists because a review can change months after you answered it,
 * and the other two buckets structurally cannot surface that: "needs reply"
 * is defined as having no reply, and "all" sorts by original post date, so a
 * three-month-old review rewritten this morning sits three months down.
 */
type Bucket = "needs_reply" | "updated" | "reported" | "all";

export default function MyReviewsPage() {
  const [bucket, setBucket] = React.useState<Bucket>("needs_reply");
  const query = useOwnerReviews({
    needsReply: bucket === "needs_reply",
    editedAfterReply: bucket === "updated",
    hasReport: bucket === "reported",
  });

  const empty = {
    needs_reply: "Nothing waiting on you. Reviews you haven't answered show up here.",
    updated:
      "Nothing to revisit. If a diner rewrites a review after you replied, it lands here so your reply doesn't end up answering words that aren't there.",
    reported:
      "Nothing contested. Reviews someone has reported show up here while we look at them — worth knowing before you reply, since the tone of a good reply differs.",
    all: "No reviews yet. They'll appear here as diners write them.",
  }[bucket];

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Replying publicly — especially to criticism — is the
          highest-leverage thing you can do here.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["needs_reply", "Needs reply", query.data?.needs_reply_count],
            [
              "updated",
              "Updated since your reply",
              query.data?.edited_after_reply_count,
            ],
            ["reported", "Reported", undefined],
            [
              "all",
              "All",
              query.data && bucket === "all" ? query.data.total : undefined,
            ],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setBucket(key)}
            className={
              "rounded-full border px-3 py-1 text-sm font-medium transition " +
              (bucket === key
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground")
            }
          >
            {label}
            {count != null && <span className="ml-1 opacity-70">{count}</span>}
          </button>
        ))}
      </div>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Loading reviews…</p>
      )}

      {query.data && query.data.items.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      )}

      {query.data && query.data.items.length > 0 && (
        <ul className="space-y-3">
          {query.data.items.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
