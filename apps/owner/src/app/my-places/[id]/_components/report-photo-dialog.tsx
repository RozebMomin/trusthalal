"use client";

/**
 * Report a diner's photo.
 *
 * Restaurants can't delete photos diners added — matching Google and Yelp,
 * and mattering more on a halal-trust platform because a photo of what was
 * actually served is evidence, and the business it implicates shouldn't be
 * able to remove it.
 *
 * The copy sets that expectation up front rather than after the decision.
 * An owner arriving here wants a delete button; the cheapest place to
 * explain why there isn't one is before they've written a report they
 * expect to succeed.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  useReportPlacePhoto,
  type PhotoReportReason,
  type PlacePhotoRead,
} from "@/lib/api/hooks";

const REASONS: Array<{ value: PhotoReportReason; label: string; hint: string }> =
  [
    {
      value: "NOT_THIS_PLACE",
      label: "Not my restaurant",
      hint: "It's a different business.",
    },
    {
      value: "INAPPROPRIATE",
      label: "Inappropriate",
      hint: "Explicit, violent, or abusive.",
    },
    {
      value: "PERSONAL_INFO",
      label: "Shows personal information",
      hint: "An identifiable person, a document, a number.",
    },
    {
      value: "MISLEADING",
      label: "Misleading",
      hint: "Misrepresents what we serve.",
    },
    {
      value: "COPYRIGHT",
      label: "Copyright",
      hint: "It's our image, used without permission.",
    },
    { value: "OTHER", label: "Something else", hint: "Tell us what's wrong." },
  ];

export function ReportPhotoDialog({
  placeId,
  photo,
  onClose,
}: {
  placeId: string;
  photo: PlacePhotoRead;
  onClose: () => void;
}) {
  const report = useReportPlacePhoto();
  const [reason, setReason] = React.useState<PhotoReportReason | null>(null);
  const [detail, setDetail] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const needsDetail = reason === "OTHER";
  const canSubmit =
    reason !== null && (!needsDetail || detail.trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || report.isPending) return;
    setErrorMsg(null);
    try {
      await report.mutateAsync({
        placeId,
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
            description: "You've already reported this photo.",
          },
        },
      });
      setErrorMsg(description);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-md border bg-card p-5 shadow-lg">
        {done ? (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">
              Thanks &mdash; we&rsquo;ll take a look
            </h3>
            <p className="text-sm text-muted-foreground">
              Someone on our team reviews reported photos within a day.
            </p>
            <Button className="w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">Report this photo</h3>
              <p className="text-sm text-muted-foreground">
                Tell us what&rsquo;s wrong and we&rsquo;ll review it.
              </p>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt=""
              className="h-28 w-full rounded border object-cover"
            />

            <fieldset className="space-y-1.5">
              <legend className="sr-only">Reason</legend>
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className={
                    "flex cursor-pointer gap-3 rounded-md border p-2.5 transition " +
                    (reason === r.value
                      ? "border-foreground bg-muted/50"
                      : "border-border hover:border-foreground/30")
                  }
                >
                  <input
                    type="radio"
                    name="owner-photo-report"
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
              <label
                className="text-sm font-medium"
                htmlFor="owner-photo-detail"
              >
                Anything else?{" "}
                {needsDetail ? (
                  <span className="text-destructive">Required</span>
                ) : (
                  <span className="text-muted-foreground">(optional)</span>
                )}
              </label>
              <textarea
                id="owner-photo-detail"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                maxLength={2000}
                className="w-full rounded-md border bg-background p-2 text-sm"
              />
            </div>

            <p className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              We&rsquo;ll review this within a day. Photos of what a diner was
              actually served stay up unless they break our guidelines &mdash;
              that&rsquo;s what makes your listing worth trusting.
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
                onClick={onClose}
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
        )}
      </div>
    </div>
  );
}
