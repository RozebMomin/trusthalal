"use client";

/**
 * Reject-organization confirmation dialog.
 *
 * Staff pick from a small set of one-click presets covering the
 * rejection reasons we see most often (entity name mismatch,
 * illegible/expired docs, wrong document type, not in good
 * standing). Selecting "Other" reveals a free-text box for
 * anything that doesn't fit the presets — this is where the
 * specific, owner-actionable detail goes.
 *
 * The dialog composes the final ``reason`` string from the
 * selected presets + Other text and sends it to the existing
 * /admin/organizations/{id}/reject endpoint, which still requires
 * a non-empty reason (min_length=3 server-side). Keeping the
 * structured choice client-side means no schema migration; if/when
 * we want to filter/aggregate by reason category we can split the
 * payload then.
 *
 * The owner sees the composed string verbatim on their org detail
 * page after rejection — preset labels are written so they read
 * cleanly as a sentence.
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
  type OrganizationAdminRead,
  useRejectOrganization,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  org: OrganizationAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// One-click presets covering the bulk of real rejections seen so
// far. Each label is the verbatim string the owner reads on their
// portal — keep them complete-sentence-ish so multiple selections
// concatenated with "; " still read cleanly.
const PRESET_REASONS = [
  {
    id: "entity_name_mismatch",
    label:
      "Documentation provided does not match the registered entity name on the state filing.",
  },
  {
    id: "document_illegible_or_expired",
    label:
      "One or more uploaded documents are illegible, cut off, or past their validity date.",
  },
  {
    id: "wrong_document_type",
    label:
      "Uploaded document is not the right type — articles of organization, certificate of incorporation, or a recent annual report is required.",
  },
  {
    id: "not_in_good_standing",
    label:
      "State filing shows the entity is dissolved, suspended, or otherwise not in good standing.",
  },
] as const;

const OTHER_ID = "__other__";
const MIN_OTHER_LENGTH = 3;

/** Compose the final reason string from the structured choices. */
function composeReason(
  selectedPresetIds: ReadonlySet<string>,
  otherChecked: boolean,
  otherText: string,
): string {
  const parts: string[] = [];
  for (const preset of PRESET_REASONS) {
    if (selectedPresetIds.has(preset.id)) {
      parts.push(preset.label);
    }
  }
  if (otherChecked) {
    const trimmed = otherText.trim();
    if (trimmed.length > 0) {
      parts.push(`Other: ${trimmed}`);
    }
  }
  return parts.join(" ");
}

export function RejectOrgDialog({ org, open, onOpenChange }: Props) {
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [otherChecked, setOtherChecked] = React.useState(false);
  const [otherText, setOtherText] = React.useState("");

  const { toast } = useToast();
  const reject = useRejectOrganization();

  // Reset every time the dialog opens for a (new) org so a stale
  // selection doesn't leak across invocations.
  React.useEffect(() => {
    if (open) {
      setSelected(new Set());
      setOtherChecked(false);
      setOtherText("");
    }
  }, [open, org.id]);

  function togglePreset(id: string, next: boolean) {
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  }

  const otherReady =
    otherChecked && otherText.trim().length >= MIN_OTHER_LENGTH;
  // Either at least one preset is checked, OR Other is checked and
  // has substantive content. A bare "Other" with no text isn't
  // submittable — that's just clicking the box and stopping.
  const canSubmit = selected.size > 0 || otherReady;

  const composed = composeReason(selected, otherChecked, otherText);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || reject.isPending) return;

    try {
      await reject.mutateAsync({
        id: org.id,
        reason: composed,
      });
      toast({
        title: "Organization rejected",
        description: "The owner will see the reason on their org detail page.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Rejection failed",
        overrides: {
          ORGANIZATION_NOT_REVIEWABLE: {
            title: "Already decided",
            description:
              "This organization is no longer in UNDER_REVIEW. Reload to see the latest state.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Reject organization</DialogTitle>
            <DialogDescription>
              Pick one or more reasons. The owner sees the
              composed message verbatim on their org detail page,
              so be specific about what would let them try again
              with a new filing.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="mt-4 space-y-3">
            <legend className="text-sm font-medium">
              Reasons{" "}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </legend>

            <div className="space-y-2">
              {PRESET_REASONS.map((preset) => {
                const inputId = `reject-${preset.id}`;
                const checked = selected.has(preset.id);
                return (
                  <label
                    key={preset.id}
                    htmlFor={inputId}
                    className="flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3 text-sm transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0"
                      checked={checked}
                      onChange={(e) =>
                        togglePreset(preset.id, e.target.checked)
                      }
                      disabled={reject.isPending}
                    />
                    <span>{preset.label}</span>
                  </label>
                );
              })}

              {/* Other — toggling the box reveals the textarea. */}
              <label
                htmlFor={OTHER_ID}
                className="flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3 text-sm transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
              >
                <input
                  id={OTHER_ID}
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0"
                  checked={otherChecked}
                  onChange={(e) => setOtherChecked(e.target.checked)}
                  disabled={reject.isPending}
                />
                <span className="font-medium">
                  Other (write your own)
                </span>
              </label>

              {otherChecked && (
                <div className="space-y-2 pl-7">
                  <Label htmlFor="reject-other-text" className="sr-only">
                    Other reason
                  </Label>
                  <Textarea
                    id="reject-other-text"
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    maxLength={2000}
                    rows={4}
                    required
                    disabled={reject.isPending}
                    placeholder="Describe what the owner needs to fix. The exact text here will be shown on their detail page."
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum {MIN_OTHER_LENGTH} characters. Visible to
                    the owner.
                  </p>
                </div>
              )}
            </div>
          </fieldset>

          {/* Live preview of the composed reason — keeps staff
              honest about what the owner is going to see. */}
          {composed.length > 0 && (
            <div className="mt-4 rounded-md border bg-muted/30 p-3 text-xs">
              <p className="mb-1 font-medium text-muted-foreground">
                Owner will see:
              </p>
              <p className="whitespace-pre-wrap">{composed}</p>
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={reject.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!canSubmit || reject.isPending}
            >
              {reject.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
