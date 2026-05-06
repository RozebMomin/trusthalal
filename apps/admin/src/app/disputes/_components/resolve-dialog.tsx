"use client";

/**
 * Resolve a consumer dispute (uphold or dismiss).
 *
 * Two-radio decision picker. UPHELD — admin sided with the consumer
 * (data correction goes through a separate owner-driven
 * RECONCILIATION halal_claim, not this endpoint). DISMISSED — admin
 * sided with the place; no profile change.
 *
 * The note is owner/consumer-visible on DISMISSED so the consumer
 * understands the outcome; we surface it as required (min 3 chars)
 * on the dismiss path and optional on uphold. Server enforces a
 * matching contract.
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
  type ConsumerDisputeAdminRead,
  useResolveDispute,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Decision = "RESOLVED_UPHELD" | "RESOLVED_DISMISSED";

const DECISION_OPTIONS: ReadonlyArray<{
  value: Decision;
  label: string;
  description: string;
}> = [
  {
    value: "RESOLVED_UPHELD",
    label: "Uphold",
    description:
      "Consumer was right. The place's halal profile is wrong. Data correction happens through a follow-up RECONCILIATION halal claim from the owner — this endpoint just clears the dispute badge.",
  },
  {
    value: "RESOLVED_DISMISSED",
    label: "Dismiss",
    description:
      "Consumer's report didn't pan out. Profile stays as-is and the dispute closes.",
  },
];

export function ResolveDialog({
  dispute,
  open,
  onOpenChange,
}: {
  dispute: ConsumerDisputeAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [decision, setDecision] = React.useState<Decision>("RESOLVED_DISMISSED");
  const [note, setNote] = React.useState<string>("");
  const { toast } = useToast();
  const resolve = useResolveDispute();

  React.useEffect(() => {
    if (open) {
      setDecision("RESOLVED_DISMISSED");
      setNote("");
    }
  }, [open, dispute.id]);

  // Server requires a non-trivial note on DISMISSED (the consumer
  // sees it as the explanation). UPHELD keeps the note optional —
  // "we agreed, follow-up RECONCILIATION incoming" speaks for
  // itself.
  const noteRequired = decision === "RESOLVED_DISMISSED";
  const noteOk = !noteRequired || note.trim().length >= 3;
  const canSubmit = noteOk && !resolve.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await resolve.mutateAsync({
        id: dispute.id,
        payload: {
          decision,
          admin_decision_note: note.trim() || null,
        },
      });
      toast({
        title:
          decision === "RESOLVED_UPHELD"
            ? "Dispute upheld"
            : "Dispute dismissed",
        description:
          "The place's DISPUTED badge clears once no other active disputes remain.",
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Resolution failed",
        overrides: {
          CONSUMER_DISPUTE_NOT_RESOLVABLE: {
            title: "Dispute isn't resolvable",
            description:
              "This dispute is already resolved or withdrawn. Reload to see the latest state.",
          },
          CONSUMER_DISPUTE_BAD_DECISION: {
            title: "Bad decision",
            description:
              "Decision must be uphold or dismiss. This is a panel/server contract drift.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Resolve dispute</DialogTitle>
            <DialogDescription>
              Pick a decision. Either path closes the dispute and
              clears the place&apos;s badge once no other active
              disputes remain.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-5">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Decision</legend>
              <div className="space-y-2">
                {DECISION_OPTIONS.map((opt) => {
                  const id = `decision-${opt.value}`;
                  const isSelected = decision === opt.value;
                  return (
                    <label
                      key={opt.value}
                      htmlFor={id}
                      className={[
                        "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition",
                        isSelected
                          ? "border-foreground bg-accent/50"
                          : "hover:bg-accent/30",
                      ].join(" ")}
                    >
                      <input
                        id={id}
                        type="radio"
                        name="dispute-decision"
                        value={opt.value}
                        checked={isSelected}
                        onChange={() => setDecision(opt.value)}
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {opt.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="resolve-note">
                {noteRequired
                  ? "Note (visible to reporter)"
                  : "Note (optional, visible to reporter)"}
              </Label>
              <Textarea
                id="resolve-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  noteRequired
                    ? "e.g. We visited the place; pork on the menu was an old delivery container being cleaned out, not a regular item."
                    : "Optional context for the reporter."
                }
                minLength={noteRequired ? 3 : undefined}
                maxLength={2000}
              />
              {noteRequired && (
                <p className="text-xs text-muted-foreground">
                  At least 3 characters.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={
                decision === "RESOLVED_UPHELD" ? "default" : "destructive"
              }
              disabled={!canSubmit}
            >
              {resolve.isPending
                ? "Resolving…"
                : decision === "RESOLVED_UPHELD"
                  ? "Uphold dispute"
                  : "Dismiss dispute"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
