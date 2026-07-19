"use client";

/**
 * Reported-photo detail + decision.
 *
 * Shows the photo large, because that's how this decision is actually made,
 * and shows the review it came from when there is one — a plate photo means
 * something different once you can read what the diner said about it.
 *
 * Verdict and action are separate fields for the same reason they are on
 * reviews: a report can be valid without warranting a takedown.
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
import { usePhotoReport, useResolvePhotoReport } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

const REASON_LABEL: Record<string, string> = {
  NOT_THIS_PLACE: "Not this place",
  INAPPROPRIATE: "Inappropriate",
  MISLEADING: "Misleading",
  PERSONAL_INFO: "Shows personal information",
  COPYRIGHT: "Copyright",
  OTHER: "Other",
};

const ATTRIBUTION_LABEL: Record<string, string> = {
  OWNER: "Uploaded by the restaurant",
  DINER: "Uploaded by a diner",
  REVIEW: "Attached to a diner's review",
  GOOGLE: "Imported from Google",
};

export default function ReportedPhotoDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const photoId = params?.id ?? "";

  const query = usePhotoReport(photoId);
  const resolve = useResolvePhotoReport(photoId);

  const [action, setAction] = React.useState<"dismiss" | "remove" | null>(null);
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

  const photo = query.data;
  const openReports = photo.reports.filter((r) => r.status === "OPEN");
  const decided = openReports.length === 0;

  const needsNote = action === "remove";
  const canSubmit = !needsNote || note.trim().length >= 3;

  async function submit() {
    if (!action || !canSubmit) return;
    setErrorMsg(null);
    try {
      await resolve.mutateAsync({
        decision: action === "dismiss" ? "DISMISSED" : "UPHELD",
        remove: action === "remove",
        resolution_note: note.trim() || undefined,
      });
      toast({
        title: action === "dismiss" ? "Reports dismissed" : "Photo removed",
        description:
          action === "dismiss"
            ? "The photo stays up."
            : "The uploader has been emailed the reason.",
      });
      setAction(null);
      setNote("");
      router.push("/reported-photos");
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
        onClick={() => router.push("/reported-photos")}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ‹ Reported photos
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {photo.place_name ?? "Reported photo"}
        </h1>
        {photo.is_hero && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Cover photo
          </span>
        )}
        {openReports.length > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
            {openReports.length} open report
            {openReports.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <section className="rounded-md border bg-card p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt={photo.caption ?? ""}
          className="mx-auto max-h-[55vh] rounded border object-contain"
        />
        <div className="mt-3 flex flex-wrap gap-4 border-t pt-3 text-xs text-muted-foreground">
          <span>{ATTRIBUTION_LABEL[photo.attribution]}</span>
          {photo.uploader_display_name && (
            <span>
              By{" "}
              <b className="text-foreground">{photo.uploader_display_name}</b>{" "}
              {photo.uploader_email}
            </span>
          )}
          {photo.uploader_account_age_days != null && (
            <span>
              Account age:{" "}
              <b className="text-foreground">
                {photo.uploader_account_age_days} days
              </b>
            </span>
          )}
          <span>
            Uploaded {new Date(photo.created_at).toLocaleDateString()}
          </span>
        </div>
        {photo.caption && (
          <p className="mt-2 text-sm">{photo.caption}</p>
        )}
      </section>

      {/* Context that changes the decision: an unappetising photo attached to
          a one-star review is doing its job, not breaking a rule. */}
      {photo.review_id && (
        <section className="rounded-md border bg-card p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            The review it came from
          </h2>
          {photo.review_rating != null && (
            <div className="text-amber-600">
              {"★".repeat(photo.review_rating)}
              <span className="text-muted-foreground/40">
                {"★".repeat(5 - photo.review_rating)}
              </span>
            </div>
          )}
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
            {photo.review_body}
          </p>
        </section>
      )}

      <section className="rounded-md border bg-card p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Reports
        </h2>
        <ul className="space-y-3">
          {photo.reports.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-destructive/20 bg-destructive/5 p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="font-bold text-destructive">
                  {REASON_LABEL[r.reason] ?? r.reason}
                </span>
                <span className="text-muted-foreground">
                  {r.reporter_display_name ?? "Someone"} ·{" "}
                  {new Date(r.created_at).toLocaleDateString()}
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
            Photos of what a restaurant actually served stay up unless they
            break the guidelines.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setAction("dismiss")}>
              Dismiss reports
            </Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setAction("remove")}
            >
              Remove photo
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
                : "Remove this photo"}
            </DialogTitle>
            <DialogDescription>
              {action === "dismiss"
                ? "The photo stays up."
                : "The photo comes down and the uploader is emailed your reason."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="photo-note">
              {needsNote ? "Reason shown to the uploader" : "Note (optional)"}
            </label>
            <Textarea
              id="photo-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder={
                needsNote
                  ? "Write this to them — they receive it verbatim."
                  : ""
              }
            />
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
