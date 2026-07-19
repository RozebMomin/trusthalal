/**
 * Report a photo.
 *
 * The only lever anyone has over someone else's photo — restaurants
 * included, since they can't delete diner photos. That constraint is worth
 * stating in the dialog rather than leaving people to discover it: an owner
 * who arrives expecting a delete button and finds a report form should
 * understand why, not conclude the button is missing.
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
  useReportPhoto,
  type PhotoReportReason,
  type PlacePhotoRead,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const REASONS: Array<{ value: PhotoReportReason; label: string; hint: string }> =
  [
    {
      value: "NOT_THIS_PLACE",
      label: "Not this restaurant",
      hint: "It's a different business, or nowhere near here.",
    },
    {
      value: "INAPPROPRIATE",
      label: "Inappropriate",
      hint: "Explicit, violent, or abusive content.",
    },
    {
      value: "PERSONAL_INFO",
      label: "Shows personal information",
      hint: "An identifiable person, a document, a phone number.",
    },
    {
      value: "MISLEADING",
      label: "Misleading",
      hint: "It misrepresents what this restaurant serves.",
    },
    {
      value: "COPYRIGHT",
      label: "Copyright",
      hint: "It's my image and it was used without permission.",
    },
    {
      value: "OTHER",
      label: "Something else",
      hint: "Tell us what's wrong and we'll look.",
    },
  ];

export function ReportPhotoDialog({
  placeId,
  photo,
  open,
  onOpenChange,
}: {
  placeId: string;
  photo: PlacePhotoRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const report = useReportPhoto(placeId);
  const [reason, setReason] = React.useState<PhotoReportReason | null>(null);
  const [detail, setDetail] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  // "Something else" with no explanation is unactionable — the server
  // rejects it, so the button shouldn't pretend otherwise.
  const needsDetail = reason === "OTHER";
  const canSubmit =
    reason !== null && (!needsDetail || detail.trim().length > 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || report.isPending) return;
    setErrorMsg(null);
    try {
      await report.mutateAsync({
        photoId: photo.id,
        reason: reason as PhotoReportReason,
        detail: detail.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't send that report",
        overrides: {
          PHOTO_ALREADY_REPORTED: {
            title: "",
            description:
              "You've already reported this photo — it's in our queue.",
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
              Someone on our team reviews reported photos within a day.
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
          <DialogTitle>Report this photo</DialogTitle>
          <DialogDescription>
            Tell us what&rsquo;s wrong and we&rsquo;ll review it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
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
                  name="photo-report-reason"
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
            <Label htmlFor="photo-report-detail">
              Anything else?{" "}
              {needsDetail ? (
                <span className="text-destructive">Required</span>
              ) : (
                <span className="text-muted-foreground">(optional)</span>
              )}
            </Label>
            <Textarea
              id="photo-report-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What should we know?"
            />
          </div>

          {/* Sets expectations before the outcome does. Owners in particular
              arrive here wanting a delete button; saying plainly that honest
              photos stay up is cheaper now than an argument later. */}
          <p className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            Photos of what a restaurant actually served stay up, including
            unflattering ones — that&rsquo;s a large part of what makes Trust
            Halal worth reading. We remove photos that break our guidelines.
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
