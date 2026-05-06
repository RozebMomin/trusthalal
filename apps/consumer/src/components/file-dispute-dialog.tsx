"use client";

/**
 * File-a-dispute dialog.
 *
 * Auth-gated: the place detail page only renders the trigger when
 * the caller is a signed-in consumer. The dialog itself doesn't
 * recheck — if the cookie expired between page load and submit, the
 * server returns 401 and the catch block surfaces a friendly
 * "please sign in again" message.
 *
 * UX flow:
 *   1. Consumer picks ``disputed_attribute`` (radio).
 *   2. Writes a description (10–2000 chars, server-validated).
 *   3. Optionally attaches up to 5 files (PDF / JPEG / PNG / HEIC).
 *   4. Submit creates the dispute, then sequentially uploads each
 *      attachment. Attachments are best-effort — if one fails, the
 *      dispute itself remains filed and the user can retry from the
 *      "Your reports" panel later (Phase 9d will surface that flow).
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type DisputedAttribute,
  useFileDispute,
  useUploadDisputeAttachment,
} from "@/lib/api/hooks";

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------

const ATTRIBUTE_OPTIONS: Array<{
  value: DisputedAttribute;
  label: string;
  hint: string;
}> = [
  {
    value: "PORK_SERVED",
    label: "Pork is served",
    hint: "The restaurant says no pork, but you saw pork on the menu or in the kitchen.",
  },
  {
    value: "ALCOHOL_PRESENT",
    label: "Alcohol is served",
    hint: "Alcohol is on the menu or being served, but the listing says it isn't.",
  },
  {
    value: "MENU_POSTURE_INCORRECT",
    label: "Menu posture is wrong",
    hint: "The advertised menu posture (fully halal, halal-options, etc.) doesn't match reality.",
  },
  {
    value: "SLAUGHTER_METHOD_INCORRECT",
    label: "Slaughter method is wrong",
    hint: "The listing claims zabihah, but the meat is machine-slaughtered or non-halal.",
  },
  {
    value: "CERTIFICATION_INVALID",
    label: "Certificate is invalid or expired",
    hint: "The certifying body or expiration date doesn't match what's on file.",
  },
  {
    value: "PLACE_CLOSED",
    label: "The restaurant has closed",
    hint: "The location is permanently closed and should be removed from the directory.",
  },
  {
    value: "OTHER",
    label: "Something else",
    hint: "Use the description below to explain what's wrong.",
  },
];

const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];
const MAX_FILES = 5;
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileDisputeDialog({
  placeId,
  placeName,
  open,
  onOpenChange,
}: {
  placeId: string;
  placeName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [attribute, setAttribute] =
    React.useState<DisputedAttribute>("PORK_SERVED");
  const [description, setDescription] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(
    null,
  );
  const [submittedOk, setSubmittedOk] = React.useState(false);

  const fileDispute = useFileDispute(placeId);
  const uploadAttachment = useUploadDisputeAttachment();

  // Whether the form is mid-submission (mutation pending OR mid-upload-loop).
  const submitting = fileDispute.isPending || uploadAttachment.isPending;

  function reset() {
    setAttribute("PORK_SERVED");
    setDescription("");
    setFiles([]);
    setSubmitError(null);
    setAttachmentError(null);
    setSubmittedOk(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Defer reset to next tick so the close animation runs against
      // the still-populated content (otherwise it visibly clears
      // mid-fade-out).
      setTimeout(reset, 200);
    }
    onOpenChange(next);
  }

  function onSelectFiles(picked: FileList | null) {
    setAttachmentError(null);
    if (!picked || picked.length === 0) return;
    const nextFiles: File[] = [...files];
    for (let i = 0; i < picked.length; i++) {
      const file = picked.item(i);
      if (!file) continue;
      if (nextFiles.length >= MAX_FILES) {
        setAttachmentError(
          `You can attach at most ${MAX_FILES} files per dispute.`,
        );
        break;
      }
      if (!ALLOWED_MIME.includes(file.type)) {
        setAttachmentError(
          `"${file.name}" is not a supported file type. PDF, JPEG, PNG, and HEIC only.`,
        );
        continue;
      }
      if (file.size > MAX_SIZE_BYTES) {
        setAttachmentError(
          `"${file.name}" is larger than 10 MB.`,
        );
        continue;
      }
      nextFiles.push(file);
    }
    setFiles(nextFiles);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setAttachmentError(null);

    const trimmed = description.trim();
    if (trimmed.length < 10) {
      setSubmitError("Please give at least a sentence of detail (10+ characters).");
      return;
    }

    try {
      const dispute = await fileDispute.mutateAsync({
        disputed_attribute: attribute,
        description: trimmed,
      });

      // Best-effort attachment upload. We don't await Promise.all
      // because attachments are independent; if one fails we still
      // want the others to land.
      const failures: string[] = [];
      for (const file of files) {
        try {
          await uploadAttachment.mutateAsync({
            disputeId: dispute.id,
            file,
          });
        } catch (err) {
          const friendly = friendlyApiError(err, {
            defaultTitle: "Upload failed",
          });
          failures.push(`${file.name}: ${friendly.description}`);
        }
      }
      if (failures.length > 0) {
        setAttachmentError(
          "The dispute was filed, but some attachments couldn't be uploaded:\n" +
            failures.join("\n"),
        );
      }
      setSubmittedOk(true);
    } catch (err) {
      const friendly = friendlyApiError(err, {
        defaultTitle: "Couldn't file dispute",
        overrides: {
          UNAUTHORIZED: {
            title: "Sign-in required",
            description:
              "Please sign in again to file a dispute. Your session may have expired.",
          },
          CONSUMER_DISPUTE_DUPLICATE_OPEN: {
            title: "You already filed a dispute",
            description:
              "You have an open dispute on this place already. Wait for the current one to be resolved before filing another.",
          },
        },
      });
      setSubmitError(`${friendly.title}. ${friendly.description}`);
    }
  }

  if (submittedOk) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thanks — your report was filed</DialogTitle>
            <DialogDescription>
              Trust Halal will review your report on{" "}
              <strong>{placeName}</strong> and follow up with the
              restaurant. You can track the status under your profile.
            </DialogDescription>
          </DialogHeader>
          {attachmentError && (
            <p
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
            >
              {attachmentError}
            </p>
          )}
          <DialogFooter>
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={onSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Report an issue with {placeName}</DialogTitle>
            <DialogDescription>
              Tell us what&rsquo;s wrong with this restaurant&rsquo;s
              halal profile. We&rsquo;ll review and follow up with
              the owner.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              What&rsquo;s wrong?
            </legend>
            <div className="space-y-2">
              {ATTRIBUTE_OPTIONS.map((opt) => {
                const id = `dispute-attr-${opt.value}`;
                const checked = attribute === opt.value;
                return (
                  <label
                    key={opt.value}
                    htmlFor={id}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition ${
                      checked
                        ? "border-foreground/60 bg-accent/40"
                        : "hover:border-foreground/30"
                    }`}
                  >
                    <input
                      id={id}
                      type="radio"
                      name="disputed_attribute"
                      value={opt.value}
                      checked={checked}
                      onChange={() => setAttribute(opt.value)}
                      className="mt-1"
                    />
                    <div className="space-y-0.5">
                      <p className="font-medium">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {opt.hint}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="dispute-description">
              Tell us what happened
            </Label>
            <Textarea
              id="dispute-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you observed, when, and any other context that helps us follow up."
              minLength={10}
              maxLength={2000}
              rows={4}
              required
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/2000 characters · 10 minimum.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dispute-files">
              Attach evidence (optional)
            </Label>
            <input
              id="dispute-files"
              type="file"
              multiple
              accept={ALLOWED_MIME.join(",")}
              onChange={(e) => {
                onSelectFiles(e.target.files);
                e.currentTarget.value = "";
              }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
            />
            <p className="text-xs text-muted-foreground">
              PDF, JPEG, PNG, or HEIC. Up to {MAX_FILES} files, 10 MB
              each.
            </p>
            {files.length > 0 && (
              <ul className="space-y-1 text-sm">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                  >
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {attachmentError && (
              <p
                role="alert"
                className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
              >
                {attachmentError}
              </p>
            )}
          </div>

          {submitError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Filing…" : "File report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

