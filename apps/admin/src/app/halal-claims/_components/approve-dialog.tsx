"use client";

/**
 * Approve a halal claim.
 *
 * The Approve action is the heaviest decision in the queue: admin
 * picks a ``validation_tier`` (the consumer-facing confidence level),
 * optionally tweaks the expiry, optionally records a certificate
 * expiry date, and the server flips the claim to APPROVED + runs the
 * profile-derivation service to update / create the place's
 * HalalProfile.
 *
 * Defaults are tuned for the common case:
 *   * SELF_ATTESTED tier — the conservative pick. Admin upgrades to
 *     CERTIFICATE_ON_FILE only when a cert was uploaded AND admin
 *     verified it; TRUST_HALAL_VERIFIED requires a verifier site
 *     visit which Phase 8 introduces.
 *   * No expiry override — server applies the 12-month default.
 *
 * decision_note is optional here (unlike reject / request-info /
 * revoke). Approving a clean submission with no extra context is a
 * common case and we don't want to force busy-work text.
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
  const { toast } = useToast();
  const approve = useApproveHalalClaim();

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
    }
  }, [open, claim.id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (approve.isPending) return;

    try {
      await approve.mutateAsync({
        id: claim.id,
        payload: {
          validation_tier: tier,
          decision_note: decisionNote.trim() || null,
          internal_notes: internalNotes.trim() || null,
          expires_at_override: toIsoOrNull(expiresAtOverride),
          certificate_expires_at: toIsoOrNull(certExpiresAt),
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
              "Only PENDING_REVIEW or NEEDS_MORE_INFO claims can be approved. Reload to see the latest state.",
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

            {/* Decision note (optional, owner-visible) */}
            <div className="space-y-2">
              <Label htmlFor="approve-decision-note">
                Decision note (optional, visible to owner)
              </Label>
              <Textarea
                id="approve-decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="e.g. Cert on file matches the IFANCA registry; approved."
                maxLength={2000}
              />
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
                  Leave blank for the 12-month default.
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
            <Button type="submit" disabled={approve.isPending}>
              {approve.isPending ? "Approving…" : "Approve claim"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
