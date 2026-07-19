"use client";

/**
 * Reported-review detail + decision.
 *
 * The decision splits into two independent facts: whether the *report* was
 * valid, and what happens to the *content*. They're separate because a
 * report can be upheld while the review stays up — the reporter was right
 * that it's heated, and it's still a legitimate account of someone's meal.
 *
 * There is deliberately **no "open a dispute" action**. A dispute is a
 * consumer's own accusation against a restaurant; filing one on their behalf
 * would put Trust Halal's institutional weight behind a private person's
 * claim and muddy a record that's supposed to show who alleged what. The
 * removal email points the author at the dispute flow instead, and they
 * choose.
 */

import { useParams, useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  useResolveReviewReport,
  useReviewReport,
  type ModerationAction,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

const REASON_LABEL: Record<string, string> = {
  SPAM: "Spam",
  OFF_TOPIC: "Off topic",
  HARASSMENT: "Harassment",
  FALSE_INFO: "False information",
  CONFLICT_OF_INTEREST: "Conflict of interest",
  OTHER: "Other",
};

type PendingAction = "dismiss" | "hide" | "remove" | null;

export default function ReportedReviewDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const reviewId = params?.id ?? "";

  const query = useReviewReport(reviewId);
  const resolve = useResolveReviewReport(reviewId);

  const [action, setAction] = React.useState<PendingAction>(null);
  const [note, setNote] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  if (query.isLoading) return <Skeleton className="h-96 w-full" />;
  if (query.isError || !query.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&rsquo;t load that report.
      </p>
    );
  }

  const { review, reports } = query.data;
  const openReports = reports.filter((r) => r.status === "OPEN");
  const decided = openReports.length === 0;
  const targetsReply = openReports.some((r) => r.reply_id != null);

  // A note is required whenever content comes down, because it's shown to
  // the author verbatim. The server enforces it; matching here means the
  // button doesn't promise something the API will refuse.
  const needsNote = action === "hide" || action === "remove";
  const canSubmit = !needsNote || note.trim().length >= 3;

  async function submit() {
    if (!action || !canSubmit) return;
    setErrorMsg(null);
    const payload = {
      decision: (action === "dismiss" ? "DISMISSED" : "UPHELD") as
        | "UPHELD"
        | "DISMISSED",
      action: (action === "hide"
        ? "HIDE"
        : action === "remove"
          ? "REMOVE"
          : "NONE") as ModerationAction,
      resolution_note: note.trim() || undefined,
    };
    try {
      await resolve.mutateAsync(payload);
      toast({
        title:
          action === "dismiss"
            ? "Reports dismissed"
            : action === "hide"
              ? "Review hidden"
              : "Review removed",
        description:
          action === "dismiss"
            ? "The content stays up."
            : "The author has been emailed the reason.",
      });
      setAction(null);
      setNote("");
      router.push("/reported-reviews");
    } catch (err) {
      setErrorMsg(
        friendlyApiError(err, { defaultTitle: "Couldn't save that" })
          .description,
      );
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <button
        type="button"
        onClick={() => router.push("/reported-reviews")}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ‹ Reported reviews
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {review.place_name ?? "Reported review"}
        </h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
          {review.status}
        </span>
        {openReports.length > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
            {openReports.length} open report
            {openReports.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <section className="rounded-md border bg-card p-4">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          The review
        </h2>
        <div className="flex flex-wrap items-baseline gap-2 text-sm">
          <span className="font-semibold">
            {review.author.display_name ?? "A diner"}
          </span>
          <span className="text-muted-foreground">
            {review.author_email}
          </span>
        </div>
        <div className="mt-1 text-amber-600">
          {"★".repeat(review.rating)}
          <span className="text-muted-foreground/40">
            {"★".repeat(5 - review.rating)}
          </span>
        </div>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">
          {review.body}
        </p>

        {/* Not decoration. An unsupported accusation from a three-day-old
            account with no other activity is a different thing from a
            detailed account by an established reviewer, and no classifier
            can make that call. */}
        <div className="mt-4 flex flex-wrap gap-4 border-t pt-3 text-xs text-muted-foreground">
          <span>
            Account age:{" "}
            <b className="text-foreground">
              {review.author_account_age_days ?? "?"} days
            </b>
          </span>
          <span>
            Their reviews:{" "}
            <b className="text-foreground">{review.author_review_count}</b>
          </span>
          <span>
            Posted: {new Date(review.created_at).toLocaleDateString()}
          </span>
        </div>
      </section>

      {review.reply && (
        <section
          className={
            targetsReply
              ? "rounded-md border-2 border-amber-400 bg-amber-50 p-4"
              : "rounded-md border bg-card p-4"
          }
        >
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Owner&rsquo;s reply{" "}
            {targetsReply && (
              <span className="text-amber-700">— this is what was reported</span>
            )}
          </h2>
          <div className="text-sm font-semibold">
            {review.reply.organization_name ?? "The owner"}
          </div>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
            {review.reply.body}
          </p>
        </section>
      )}

      <section className="rounded-md border bg-card p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Reports
        </h2>
        <ul className="space-y-3">
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-destructive/20 bg-destructive/5 p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="font-bold text-destructive">
                  {REASON_LABEL[r.reason] ?? r.reason}
                </span>
                <span className="text-muted-foreground">
                  {r.reporter_display_name ?? "Someone"}
                  {/* An owner reporting a review of their own restaurant has
                      an obvious interest. Surface it rather than making the
                      moderator go and check. */}
                  {r.reporter_relationship === "OWNER" && (
                    <b className="ml-1 text-amber-700">· the owner</b>
                  )}{" "}
                  · {new Date(r.created_at).toLocaleDateString()}
                  {r.status !== "OPEN" && ` · ${r.status.toLowerCase()}`}
                </span>
              </div>
              {r.detail && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {r.detail}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {!decided && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <p className="text-xs text-muted-foreground">
            The author is emailed either way.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setAction("dismiss")}>
              Dismiss reports
            </Button>
            <Button variant="outline" onClick={() => setAction("hide")}>
              Hide (reversible)
            </Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setAction("remove")}
            >
              Remove
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={action !== null}
        onOpenChange={(next) => {
          if (!next) {
            setAction(null);
            setErrorMsg(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {action === "dismiss"
                ? "Dismiss these reports"
                : action === "hide"
                  ? "Hide this content"
                  : "Remove this content"}
            </DialogTitle>
            <DialogDescription>
              {action === "dismiss"
                ? "The content stays up and the reporters are told we looked."
                : action === "hide"
                  ? "Reversible. The author can still see and edit it."
                  : "Permanent. The place's rating recalculates without it."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="resolution-note">
              {needsNote ? "Reason shown to the author" : "Note (optional)"}
            </label>
            <Textarea
              id="resolution-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder={
                needsNote
                  ? "Write this to them, not about them — they receive it verbatim."
                  : ""
              }
            />
            {needsNote && (
              <p className="text-xs text-muted-foreground">
                The author sees this in full. Minimum 3 characters.
              </p>
            )}
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setAction(null)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!canSubmit || resolve.isPending}
              onClick={submit}
            >
              {resolve.isPending ? "Saving…" : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
