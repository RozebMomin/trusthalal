/**
 * Write or edit a review.
 *
 * ## Why the draft is persisted
 *
 * Text moderation runs on submit and **fails closed** — if the content
 * scanner is unreachable, the post is refused. That's the right call (it
 * matches the photo pipeline: no answer from the scanner means no publish),
 * but it's only acceptable if nobody loses what they wrote. Reviews are
 * voluntary effort; someone who hits an error and loses a paragraph does not
 * sit down and retype it.
 *
 * So the draft is mirrored to localStorage on every keystroke and restored
 * on mount. It survives a rejection, a refresh, and a closed tab.
 *
 * ## Three failure states that must not look alike
 *
 * A 400 means we read your words and they broke a rule. A 503 means we
 * couldn't read them at all. A 401/403 means the content was never the
 * problem — you're signed out or unverified. See the `Failure` type.
 */
"use client";

import { Star } from "lucide-react";
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
  useCreateReview,
  useDeleteReview,
  useUpdateReview,
  type PlaceReviewRead,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const BODY_MIN = 20;
const BODY_MAX = 5000;

function draftKey(placeId: string) {
  return `th:review-draft:${placeId}`;
}

/** Why a submit failed.
 *
 *  These are three genuinely different messages to a person, and collapsing
 *  any two of them produces a lie:
 *
 *    rejected — we read your words and they broke a rule.
 *    outage   — we couldn't read them at all. Our fault, not yours.
 *    other    — anything else: signed out, offline, server error. Emphatically
 *               NOT a judgement on the content.
 *
 *  This started as a binary (outage vs. everything-else-is-rejected), which
 *  meant a signed-out user got told their review "can't be posted as
 *  written" above a message about a missing session. */
type Failure =
  | { kind: "rejected"; message: string }
  | { kind: "outage"; message: string }
  | { kind: "other"; title: string; message: string };

export function WriteReviewDialog({
  placeId,
  placeName,
  existing,
  open,
  onOpenChange,
}: {
  placeId: string;
  placeName: string;
  existing: PlaceReviewRead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateReview(placeId);
  const update = useUpdateReview(placeId);
  const remove = useDeleteReview(placeId);

  const [rating, setRating] = React.useState(existing?.rating ?? 0);
  const [body, setBody] = React.useState(existing?.body ?? "");
  const [visitedOn, setVisitedOn] = React.useState(existing?.visited_on ?? "");
  const [failure, setFailure] = React.useState<Failure | null>(null);

  // Restore an unsent draft. Only for new reviews — when editing, the
  // server's copy is the truth and a stale local draft would silently
  // resurrect text the user already replaced.
  React.useEffect(() => {
    if (existing) return;
    try {
      const raw = window.localStorage.getItem(draftKey(placeId));
      if (!raw) return;
      const d = JSON.parse(raw) as { rating?: number; body?: string };
      if (d.body) setBody(d.body);
      if (d.rating) setRating(d.rating);
    } catch {
      // A corrupt draft is not worth surfacing — just start clean.
    }
  }, [placeId, existing]);

  React.useEffect(() => {
    if (existing) return;
    try {
      if (body.trim() || rating) {
        window.localStorage.setItem(
          draftKey(placeId),
          JSON.stringify({ rating, body }),
        );
      }
    } catch {
      // Private browsing / quota. The draft is a nicety, not a requirement.
    }
  }, [placeId, rating, body, existing]);

  function clearDraft() {
    try {
      window.localStorage.removeItem(draftKey(placeId));
    } catch {
      /* ignore */
    }
  }

  const trimmed = body.trim();
  const pending = create.isPending || update.isPending;
  const canSubmit = rating > 0 && trimmed.length >= BODY_MIN && !pending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setFailure(null);
    try {
      if (existing) {
        await update.mutateAsync({
          reviewId: existing.id,
          rating,
          body: trimmed,
          visited_on: visitedOn || null,
        });
      } else {
        await create.mutateAsync({
          rating,
          body: trimmed,
          visited_on: visitedOn || null,
        });
      }
      clearDraft();
      onOpenChange(false);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const { title, description } = friendlyApiError(err, {
        defaultTitle: "Couldn't post your review",
      });
      // 503 is the moderation service being unreachable — emphatically not
      // a judgement on what they wrote.
      if (status === 503) {
        setFailure({
          kind: "outage",
          message:
            "We couldn't run our content check just now — that's on us, not your review. Your draft is saved; try again in a moment.",
        });
      } else if (status === 400) {
        setFailure({ kind: "rejected", message: description });
      } else if (status === 401) {
        setFailure({
          kind: "other",
          title: "You're signed out",
          message: "Sign in and your draft will still be here.",
        });
      } else if (status === 403) {
        setFailure({
          kind: "other",
          title: "Confirm your email first",
          message:
            "Check your inbox for the confirmation link, then post your review.",
        });
      } else {
        setFailure({ kind: "other", title, message: description });
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit your review" : `Review ${placeName}`}
          </DialogTitle>
          <DialogDescription>
            Diners rely on these. Describe what you ordered and what you saw.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {failure && (
            <div
              role="alert"
              className={cn(
                "rounded-md border p-3 text-sm leading-relaxed",
                failure.kind === "rejected"
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : "border-amber-300 bg-amber-50 text-amber-900",
              )}
            >
              <span className="block font-semibold">
                {failure.kind === "outage"
                  ? "We couldn't run our content check"
                  : failure.kind === "rejected"
                    ? "This can't be posted as written"
                    : failure.title}
              </span>
              {failure.message}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Your rating</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  aria-pressed={rating === n}
                  className="rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Star
                    className={cn(
                      "h-7 w-7 transition",
                      n <= rating
                        ? "fill-amber-400 text-amber-400"
                        : "fill-muted text-muted-foreground/40 hover:text-muted-foreground",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="review-visited">
              When did you visit?{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <input
              id="review-visited"
              type="date"
              value={visitedOn}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setVisitedOn(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="review-body">Your review</Label>
            <Textarea
              id="review-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={BODY_MAX}
              placeholder="What did you order? Did you ask about the halal status — and what did they say?"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>
                {trimmed.length < BODY_MIN
                  ? `At least ${BODY_MIN} characters`
                  : "Looks good"}
              </span>
              <span>
                {body.length} / {BODY_MAX}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            {existing && (
              <Button
                type="button"
                variant="outline"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={async () => {
                  await remove.mutateAsync(existing.id);
                  clearDraft();
                  onOpenChange(false);
                }}
              >
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={!canSubmit}>
              {pending ? "Checking…" : existing ? "Save changes" : "Post review"}
            </Button>
          </div>

          {!existing && (body || rating > 0) && (
            <p className="text-center text-[11px] text-muted-foreground">
              Your draft is saved on this device.
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
