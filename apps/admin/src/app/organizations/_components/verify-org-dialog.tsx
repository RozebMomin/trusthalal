"use client";

/**
 * Verify-organization confirmation dialog.
 *
 * Mirrors the reject dialog's structured-choice pattern: staff
 * tick the verification checks they actually performed (entity
 * name match, in good standing, articles verified, recent annual
 * report) plus an "Other" free-text fallback for anything outside
 * the presets. The composed string lands as ``decision_note`` on
 * the audit row.
 *
 * The note is required server-side (min_length=3) so every
 * VERIFIED decision has a documented basis — no more bare
 * "click-through" approvals that leave a confused future reviewer
 * wondering what was actually checked.
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
  useVerifyOrganization,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  org: OrganizationAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Preset verification checks. Each label is the verbatim string
// that lands on decision_note — keep them complete-sentence-ish
// so multiple selections concatenated with " " still read cleanly
// in the audit log.
const PRESET_CHECKS = [
  {
    id: "entity_name_matches",
    label:
      "Entity name on the state filing matches the organization on record.",
  },
  {
    id: "in_good_standing",
    label:
      "State filing shows the entity is active and in good standing.",
  },
  {
    id: "articles_verified",
    label:
      "Articles of organization / certificate of incorporation reviewed and look legitimate.",
  },
  {
    id: "annual_report_on_file",
    label:
      "Recent annual report (within last 1–2 years) attached and verified.",
  },
] as const;

const OTHER_ID = "__other__";
const MIN_OTHER_LENGTH = 3;

/** Compose the final note string from the structured choices. */
function composeNote(
  selectedPresetIds: ReadonlySet<string>,
  otherChecked: boolean,
  otherText: string,
): string {
  const parts: string[] = [];
  for (const preset of PRESET_CHECKS) {
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

export function VerifyOrgDialog({ org, open, onOpenChange }: Props) {
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [otherChecked, setOtherChecked] = React.useState(false);
  const [otherText, setOtherText] = React.useState("");

  const { toast } = useToast();
  const verify = useVerifyOrganization();

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
  // has substantive content. A bare Other with no text isn't
  // submittable.
  const canSubmit = selected.size > 0 || otherReady;

  const composed = composeNote(selected, otherChecked, otherText);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || verify.isPending) return;

    try {
      await verify.mutateAsync({
        id: org.id,
        note: composed,
      });
      toast({
        title: "Organization verified",
        description: `${org.name} can now sponsor place claims.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Verification failed",
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
            <DialogTitle>Verify organization</DialogTitle>
            <DialogDescription>
              Confirm <span className="font-medium">{org.name}</span> as a
              real, operating business entity. Tick every check you
              actually performed — the audit log will show exactly
              this. Once verified the org can sponsor new place
              claims.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="mt-4 space-y-3">
            <legend className="text-sm font-medium">
              Verification checks{" "}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </legend>

            <div className="space-y-2">
              {PRESET_CHECKS.map((preset) => {
                const inputId = `verify-${preset.id}`;
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
                      disabled={verify.isPending}
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
                  disabled={verify.isPending}
                />
                <span className="font-medium">
                  Other (write your own)
                </span>
              </label>

              {otherChecked && (
                <div className="space-y-2 pl-7">
                  <Label htmlFor="verify-other-text" className="sr-only">
                    Other check
                  </Label>
                  <Textarea
                    id="verify-other-text"
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    required
                    disabled={verify.isPending}
                    placeholder="Describe the additional check you performed."
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum {MIN_OTHER_LENGTH} characters.
                  </p>
                </div>
              )}
            </div>
          </fieldset>

          {/* Live preview of the composed note — confirms what
              lands on the audit row. */}
          {composed.length > 0 && (
            <div className="mt-4 rounded-md border bg-muted/30 p-3 text-xs">
              <p className="mb-1 font-medium text-muted-foreground">
                Audit note:
              </p>
              <p className="whitespace-pre-wrap">{composed}</p>
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={verify.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || verify.isPending}>
              {verify.isPending ? "Verifying…" : "Verify"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
