"use client";

/**
 * Resolve a consumer dispute (uphold or dismiss).
 *
 * Two-radio decision picker. UPHELD, admin sided with the consumer
 * (data correction goes through a separate owner-driven
 * RECONCILIATION halal_claim, not this endpoint). DISMISSED, admin
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  DELIST_REASON_OPTIONS,
  type ConsumerDisputeAdminRead,
  type DelistReason,
  type ProfileCorrection,
  useResolveDispute,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Decision = "RESOLVED_UPHELD" | "RESOLVED_DISMISSED";

// Radix Select can't hold an empty value, so "leave as-is" uses a sentinel we
// translate back to "field omitted" when building the correction payload.
const KEEP = "__keep__";
type Opt = readonly [value: string, label: string];
const ALCOHOL_OPTS: Opt[] = [["NONE", "No alcohol"], ["BEER_AND_WINE_ONLY", "Beer & wine only"], ["FULL_BAR", "Full bar"]];
const MENU_OPTS: Opt[] = [["FULLY_HALAL", "Fully halal"], ["MIXED_SEPARATE_KITCHENS", "Mixed · separate kitchens"], ["HALAL_OPTIONS_ADVERTISED", "Halal options advertised"], ["HALAL_UPON_REQUEST", "Halal upon request"], ["MIXED_SHARED_KITCHEN", "Mixed · shared kitchen"]];
const SLAUGHTER_OPTS: Opt[] = [["HAND_CUT", "Hand-cut"], ["MACHINE_CUT", "Machine-cut"], ["NOT_SERVED", "Not served"], ["NOT_DISCLOSED", "Not disclosed"]];
const ZABIHAH_OPTS: Opt[] = [["ZABIHAH", "Zabihah"], ["NOT_ZABIHAH", "Not zabihah"], ["UNSURE", "Unsure"], ["NOT_SERVED", "Not served"]];
const BOOL_OPTS: Opt[] = [["true", "Yes"], ["false", "No"]];

// (state key on the profile, label, options). Booleans use BOOL_OPTS.
const CORRECTION_FIELDS: ReadonlyArray<readonly [keyof ProfileCorrection, string, Opt[]]> = [
  ["alcohol_policy", "Alcohol served", ALCOHOL_OPTS],
  ["alcohol_in_cooking", "Alcohol in cooking", BOOL_OPTS],
  ["menu_posture", "Menu posture", MENU_OPTS],
  ["chicken_slaughter", "Chicken", SLAUGHTER_OPTS],
  ["beef_zabihah", "Beef", ZABIHAH_OPTS],
  ["lamb_zabihah", "Lamb", ZABIHAH_OPTS],
  ["goat_zabihah", "Goat", ZABIHAH_OPTS],
  ["has_certification", "Has certificate", BOOL_OPTS],
];

const DECISION_OPTIONS: ReadonlyArray<{
  value: Decision;
  label: string;
  description: string;
}> = [
  {
    value: "RESOLVED_UPHELD",
    label: "Uphold",
    description:
      "Consumer was right — the profile is wrong. Optionally correct the data right here (below), or leave it for an owner reconciliation claim. Either way the dispute badge clears.",
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
  // Optional "also de-list" side-effect, only valid on the UPHELD path.
  const [delistEnabled, setDelistEnabled] = React.useState(false);
  const [delistReason, setDelistReason] =
    React.useState<DelistReason>("NOT_HALAL");
  const [delistNote, setDelistNote] = React.useState<string>("");
  // Optional "also correct the profile data" side-effect (UPHELD-only). Each
  // field holds KEEP ("leave as-is") until the admin picks a new value.
  const [correctEnabled, setCorrectEnabled] = React.useState(false);
  const [corr, setCorr] = React.useState<Record<string, string>>({});
  const [certName, setCertName] = React.useState<string>("");
  const { toast } = useToast();
  const resolve = useResolveDispute();

  React.useEffect(() => {
    if (open) {
      setDecision("RESOLVED_DISMISSED");
      setNote("");
      setDelistEnabled(false);
      setDelistReason("NOT_HALAL");
      setDelistNote("");
      setCorrectEnabled(false);
      setCorr({});
      setCertName("");
    }
  }, [open, dispute.id]);

  // Assemble the correction payload from the fields the admin actually changed.
  function buildCorrection(): ProfileCorrection | undefined {
    if (!correctEnabled) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, , opts] of CORRECTION_FIELDS) {
      const v = corr[key];
      if (!v || v === KEEP) continue;
      out[key] = opts === BOOL_OPTS ? v === "true" : v;
    }
    if (certName.trim()) out.certifying_body_name = certName.trim();
    return Object.keys(out).length ? (out as ProfileCorrection) : undefined;
  }

  // The de-list side-effect is UPHELD-only (server 409s otherwise).
  // Clear it the moment the admin flips back to DISMISSED so a stale
  // toggle can't ride along in the payload.
  const isUpheld = decision === "RESOLVED_UPHELD";
  React.useEffect(() => {
    if (!isUpheld) {
      setDelistEnabled(false);
      setCorrectEnabled(false);
    }
  }, [isUpheld]);

  // Server requires a non-trivial note on DISMISSED (the consumer
  // sees it as the explanation). UPHELD keeps the note optional,
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
          // Only ride the de-list side-effect on the UPHELD path; the
          // effect that clears it on DISMISSED keeps this in sync, but
          // guard on isUpheld too so the payload can't drift.
          delist:
            isUpheld && delistEnabled
              ? { reason: delistReason, note: delistNote.trim() || null }
              : undefined,
          correction: isUpheld ? buildCorrection() : undefined,
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
          DISPUTE_DELIST_REQUIRES_UPHELD: {
            title: "De-list needs an upheld decision",
            description:
              "You can only de-list the place when upholding the dispute. Switch to Uphold or clear the de-list option.",
          },
          DISPUTE_CORRECTION_REQUIRES_UPHELD: {
            title: "Correction needs an upheld decision",
            description:
              "You can only correct the profile when upholding the dispute. Switch to Uphold or clear the correction.",
          },
          PLACE_HAS_NO_PROFILE: {
            title: "No profile to correct",
            description:
              "This place doesn't have a halal profile yet, so there's nothing to correct.",
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

            {/*
              Optional de-list side-effect, UPHELD-only. When the admin
              upholds a report that means the place shouldn't be on the
              platform (not halal, closed, fraudulent), they can de-list
              it in the same action instead of a second trip to the place
              page.
            */}
            {isUpheld && (
              <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={delistEnabled}
                    onChange={(e) => setDelistEnabled(e.target.checked)}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Also de-list this place (remove from platform)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Leaves a public tombstone explaining why. Use for
                      places that shouldn&apos;t be listed at all, not just
                      a data correction.
                    </p>
                  </div>
                </label>

                {delistEnabled && (
                  <div className="space-y-3 pl-7">
                    <div className="space-y-2">
                      <Label htmlFor="resolve-delist-reason">
                        De-list reason
                      </Label>
                      <Select
                        value={delistReason}
                        onValueChange={(v) =>
                          setDelistReason(v as DelistReason)
                        }
                      >
                        <SelectTrigger id="resolve-delist-reason">
                          <SelectValue placeholder="Pick a reason" />
                        </SelectTrigger>
                        <SelectContent>
                          {DELIST_REASON_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="resolve-delist-note">
                        De-list note (optional)
                      </Label>
                      <Textarea
                        id="resolve-delist-note"
                        value={delistNote}
                        onChange={(e) => setDelistNote(e.target.value)}
                        placeholder="Optional context saved on the audit event."
                        maxLength={500}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/*
              Optional profile correction, UPHELD-only. The data-change pathway
              for ownerless, verifier-established places: fix the wrong field(s)
              directly (e.g. alcohol → not served) instead of waiting on an
              owner reconciliation claim. Only changed fields are sent.
            */}
            {isUpheld && (
              <div className="space-y-3 rounded-md border p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={correctEnabled}
                    onChange={(e) => setCorrectEnabled(e.target.checked)}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Also correct the profile data
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Apply the fix directly to the halal profile. For places
                      with no owner to file a reconciliation claim. Only the
                      fields you change are updated.
                    </p>
                  </div>
                </label>

                {correctEnabled && (
                  <div className="grid grid-cols-1 gap-3 pl-7 sm:grid-cols-2">
                    {CORRECTION_FIELDS.map(([key, label, opts]) => (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={`corr-${key}`} className="text-xs">
                          {label}
                        </Label>
                        <Select
                          value={corr[key] ?? KEEP}
                          onValueChange={(v) =>
                            setCorr((prev) => ({ ...prev, [key]: v }))
                          }
                        >
                          <SelectTrigger id={`corr-${key}`} className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={KEEP}>Leave as-is</SelectItem>
                            {opts.map(([v, l]) => (
                              <SelectItem key={v} value={v}>
                                {l}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="corr-cert-name" className="text-xs">
                        Certifier name (leave blank to keep)
                      </Label>
                      <input
                        id="corr-cert-name"
                        value={certName}
                        onChange={(e) => setCertName(e.target.value)}
                        placeholder="e.g. Halal Monitoring Services"
                        maxLength={255}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
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
