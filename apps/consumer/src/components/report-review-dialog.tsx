/**
 * Report a review or an owner's reply.
 *
 * The report queue is the primary defence for text on this platform — the
 * content filter catches profanity, but whether a factual claim about a
 * restaurant is *false* is a question about the world, not about the words,
 * and only a human can weigh it. So this form is load-bearing, and the copy
 * says what will and won't happen rather than implying a report is a delete.
 */
"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  useReportReview,
  type PlaceReviewRead,
  type ReviewReportReason,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const REASONS: Array<{
  value: ReviewReportReason;
  label: string;
  hint: string;
}> = [
  {
    value: "FALSE_INFO",
    label: "It states something false",
    hint: "Presents a claim as fact that isn't true.",
  },
  {
    value: "HARASSMENT",
    label: "Harassment or abuse",
    hint: "Targets a person rather than the experience.",
  },
  {
    value: "OFF_TOPIC",
    label: "Not about this restaurant",
    hint: "Wrong business, or nothing to do with the visit.",
  },
  {
    value: "SPAM",
    label: "Spam",
    hint: "Advertising, links, or repeated posting.",
  },
  {
    value: "CONFLICT_OF_INTEREST",
    label: "Conflict of interest",
    hint: "Written by a competitor, or by someone connected to the business.",
  },
  {
    value: "OTHER",
    label: "Something else",
    hint: "Tell us what's wrong and we'll look.",
  },
];

export function ReportReviewDialog({
  placeId,
  review,
  open,
  onOpenChange,
}: {
  placeId: string;
  review: PlaceReviewRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const report = useReportReview(placeId);
  const [reason, setReason] = React.useState<ReviewReportReason | null>(null);
  const [detail, setDetail] = React.useState("");
  const [target, setTarget] = React.useState<"review" | "reply">("review");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const needsDetail = reason === "OTHER";
  const canSubmit = reason !== null && (!needsDetail || detail.trim().length > 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || report.isPending) return;
    setErrorMsg(null);
    try {
      await report.mutateAsync({
        reviewId: review.id,
        reason: reason as ReviewReportReason,
        detail: detail.trim() || undefined,
        replyId:
          target === "reply" && review.reply ? review.reply.id : undefined,
      });
      setDone(true);
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't send that report",
        overrides: {
          REVIEW_ALREADY_REPORTED: {
            title: "",
            description: "You've already reported this — it's in our queue.",
          },
        },
      });
      setErrorMsg(description);
    }
  }

  if (done) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thanks — we&rsquo;ll take a look</DialogTitle>
            <DialogDescription>
              Someone on our team reviews reports within a day, and
              we&rsquo;ll email you the outcome.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={() => onOpenChange(false)} className="w-full">
            Close
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report this</DialogTitle>
          <DialogDescription>
            Tell us what&rsquo;s wrong and we&rsquo;ll review it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Owners get reported too — behaving badly in public is not an
              owner privilege, and a reply carries more implicit weight than
              an anonymous review does. */}
          {review.reply && (
            <div className="flex gap-1.5">
              {(
                [
                  ["review", "The review"],
                  ["reply", "The owner's reply"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTarget(key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    target === key
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <fieldset className="space-y-1.5">
            <legend className="sr-only">Reason</legend>
            {REASONS.map((r) => (
              <label
                key={r.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-md border p-3 transition",
                  reason === r.value
                    ? "border-foreground bg-muted/50"
                    : "border-border hover:border-foreground/30",
                )}
              >
                <input
                  type="radio"
                  name="review-report-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="review-report-detail">
              Anything else?{" "}
              {needsDetail ? (
                <span className="text-destructive">Required</span>
              ) : (
                <span className="text-muted-foreground">(optional)</span>
              )}
            </Label>
            <Textarea
              id="review-report-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What should we know?"
            />
          </div>

          <p className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            Strongly worded but genuine accounts stay up, including
            unflattering ones — they&rsquo;re a large part of what makes Trust
            Halal worth reading. We remove content that breaks our guidelines.
          </p>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={!canSubmit || report.isPending}
            >
              {report.isPending ? "Sending…" : "Send report"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
