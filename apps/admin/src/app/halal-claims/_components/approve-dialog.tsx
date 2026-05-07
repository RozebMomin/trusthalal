"use client";

/**
 * Approve a halal claim. Admin picks a validation tier + optional
 * expiry + optional notes; the server flips the claim to APPROVED
 * and runs profile derivation in the same transaction.
 *
 * Override flow: when the claim is in NEEDS_MORE_INFO, DRAFT,
 * REJECTED, or REVOKED, approving is outside the standard
 * PENDING_REVIEW → APPROVED happy path. The dialog shows a yellow
 * callout, requires staff to tick an "I acknowledge this is an
 * override approval" checkbox, and the decision_note becomes
 * required so the audit trail records WHY the unusual transition
 * happened.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type HalalClaimAdminRead,
  type ValidationTier,
  useApproveHalalClaim,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  claim: HalalClaimAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Statuses where approval requires the override flow. Mirrors
// _OVERRIDE_APPROVABLE_STATUSES on the server. APPROVED + SUPERSEDED
// + PENDING_REVIEW aren't here on purpose — the first two are
// meaningless to re-approve, and PENDING_REVIEW is the happy path.
const OVERRIDE_REQUIRED_STATUSES: ReadonlySet<string> = new Set([
  "DRAFT",
  "NEEDS_MORE_INFO",
  "REJECTED",
  "REVOKED",
]);

// Default is SELF_ATTESTED — the conservative pick. Admin upgrades
// to CERTIFICATE_ON_FILE only after verifying an uploaded cert;
// TRUST_HALAL_VERIFIED requires the verifier site-visit flow that
// Phase 8 introduces.
const TIER_OPTIONS: ReadonlyArray<{
  value: ValidationTier;
  label: string;
  description: string;
}> = [
  {
    value: "SELF_ATTESTED",
    label: "Self-attested",
    description:
      "Owner submitted answers; no external evidence verified beyond what's on file.",
  },
  {
    value: "CERTIFICATE_ON_FILE",
    label: "Certificate on file",
    description:
      "Owner uploaded a current cert from a recognized authority and you've verified it's real and unexpired.",
  },
  {
    value: "TRUST_HALAL_VERIFIED",
    label: "Trust Halal verified",
    description:
      "A Trust Halal verifier or staff member physically confirmed the claim. Highest confidence tier.",
  },
];

/**
 * Convert an HTML <input type="datetime-local"> value (no timezone)
 * into an ISO-8601 string for the API. ``""`` round-trips to
 * ``null`` so admins who don't want to override an expiry just leave
 * the field blank.
 */
function toIsoOrNull(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // <input type="datetime-local"> emits ``YYYY-MM-DDTHH:MM`` in local
  // time. Parse via Date and re-serialize as UTC ISO so the wire
  // format matches the server's ``datetime`` field.
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function ApproveDialog({ claim, open, onOpenChange }: Props) {
  const [tier, setTier] = React.useState<ValidationTier>("SELF_ATTESTED");
  const [decisionNote, setDecisionNote] = React.useState<string>("");
  const [internalNotes, setInternalNotes] = React.useState<string>("");
  const [expiresAtOverride, setExpiresAtOverride] = React.useState<string>("");
  const [certExpiresAt, setCertExpiresAt] = React.useState<string>("");
  const [overrideAck, setOverrideAck] = React.useState<boolean>(false);
  const { toast } = useToast();
  const approve = useApproveHalalClaim();

  const isOverride = OVERRIDE_REQUIRED_STATUSES.has(claim.status);
  const trimmedNote = decisionNote.trim();
  // Override path requires both the ack flag AND a non-empty note.
  // Happy path leaves both unconstrained.
  const canSubmit = isOverride
    ? overrideAck && trimmedNote.length > 0 && !approve.isPending
    : !approve.isPending;

  // Reset the form whenever the dialog opens for a different claim.
  // Re-opening for the same claim keeps the prior selection so admin
  // can correct a typo without retyping everything.
  React.useEffect(() => {
    if (open) {
      setTier("SELF_ATTESTED");
      setDecisionNote("");
      setInternalNotes("");
      setExpiresAtOverride("");
      setCertExpiresAt("");
      setOverrideAck(false);
    }
  }, [open, claim.id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      await approve.mutateAsync({
        id: claim.id,
        payload: {
          validation_tier: tier,
          decision_note: trimmedNote || null,
          internal_notes: internalNotes.trim() || null,
          expires_at_override: toIsoOrNull(expiresAtOverride),
          certificate_expires_at: toIsoOrNull(certExpiresAt),
          override_acknowledged: isOverride ? overrideAck : false,
        },
      });
      toast({
        title: "Claim approved",
        description:
          "The place's halal profile has been updated. Owner sees the decision on their claim.",
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Approval failed",
        overrides: {
          HALAL_CLAIM_NOT_DECIDABLE: {
            title: "Claim isn't reviewable",
            description:
              "This claim is APPROVED or SUPERSEDED — there's nothing to approve from here. Reload the queue.",
          },
          HALAL_CLAIM_APPROVAL_REQUIRES_OVERRIDE: {
            title: "Override acknowledgement required",
            description:
              "You're approving outside the standard PENDING_REVIEW flow. Tick the override checkbox and add a decision note explaining the reasoning.",
          },
          HALAL_CLAIM_NOT_FOUND: {
            title: "Claim no longer exists",
            description:
              "Someone may have just removed it. Reload the queue to refresh.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Approve halal claim</DialogTitle>
            <DialogDescription>
              Pick a validation tier — this drives the consumer-facing
              confidence level on the place&apos;s halal profile.
            </DialogDescription>
          </DialogHeader>

          {isOverride && (
            <div
              role="alert"
              className="mt-4 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
            >
              <p className="font-medium text-amber-950 dark:text-amber-100">
                Override approval — outside the standard flow
              </p>
              <p className="text-amber-900 dark:text-amber-100">
                This claim is in <strong>{claim.status}</strong>, not
                PENDING_REVIEW. Approving from here is allowed but
                requires you to acknowledge the deviation and leave a
                decision note explaining why. The note lands on the
                audit trail and is visible to the owner.
              </p>
              <label className="flex items-start gap-2 pt-1 text-amber-950 dark:text-amber-100">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={overrideAck}
                  onChange={(e) => setOverrideAck(e.target.checked)}
                  disabled={approve.isPending}
                />
                <span>
                  I acknowledge this is an override approval and have
                  reviewed the claim&apos;s history.
                </span>
              </label>
            </div>
          )}

          <div className="mt-4 space-y-5">
            {/* Validation tier */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Validation tier</legend>
              <div className="space-y-2">
                {TIER_OPTIONS.map((opt) => {
                  const id = `tier-${opt.value}`;
                  const isSelected = tier === opt.value;
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
                        name="validation-tier"
                        value={opt.value}
                        checked={isSelected}
                        onChange={() => setTier(opt.value)}
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

            {/* Decision note. Required in override mode, optional
                otherwise. The required-asterisk + helper copy flip
                between the two. */}
            <div className="space-y-2">
              <Label htmlFor="approve-decision-note">
                Decision note{" "}
                {isOverride ? (
                  <span aria-hidden className="text-destructive">
                    *
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    (optional, visible to owner)
                  </span>
                )}
              </Label>
              <Textarea
                id="approve-decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder={
                  isOverride
                    ? "Explain why you're approving outside the standard flow."
                    : "e.g. Cert on file matches the IFANCA registry; approved."
                }
                maxLength={2000}
                required={isOverride}
              />
              {isOverride && (
                <p className="text-xs text-muted-foreground">
                  Required for override approvals. Lands on the audit
                  trail and is shown to the owner.
                </p>
              )}
            </div>

            {/* Internal notes (optional, staff-only) */}
            <div className="space-y-2">
              <Label htmlFor="approve-internal-notes">
                Internal notes (optional, staff-only)
              </Label>
              <Textarea
                id="approve-internal-notes"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Anything other admins should know. Not shown to the owner."
                maxLength={4000}
              />
            </div>

            {/* Expiry overrides */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="approve-expires-at">
                  Profile expiry (optional)
                </Label>
                <Input
                  id="approve-expires-at"
                  type="datetime-local"
                  value={expiresAtOverride}
                  onChange={(e) => setExpiresAtOverride(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank for the 90-day default. Overrides past
                  90 days are clamped server-side — company policy.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="approve-cert-expires-at">
                  Certificate expiry (optional)
                </Label>
                <Input
                  id="approve-cert-expires-at"
                  type="datetime-local"
                  value={certExpiresAt}
                  onChange={(e) => setCertExpiresAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Mirrors the cert&apos;s own expiry. Display-only.
                </p>
              </div>
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
            <Button type="submit" disabled={!canSubmit}>
              {approve.isPending
                ? "Approving…"
                : isOverride
                  ? "Approve (override)"
                  : "Approve claim"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
