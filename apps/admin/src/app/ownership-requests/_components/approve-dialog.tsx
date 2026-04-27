"use client";

/**
 * Approve-ownership-request dialog.
 *
 * Slice 5d redesign: admins no longer pick or create the sponsoring
 * organization here — that responsibility moved to the owners (who
 * file claims under their own org) and to /admin/organizations
 * (where admin verifies the org separately). This dialog now reads
 * the org off the claim itself and gates approval on the org being
 * VERIFIED.
 *
 * Three render branches:
 *
 *   * Claim has a VERIFIED org (the canonical slice-5b path): show
 *     the org as a confirmation card and let admin approve.
 *   * Claim has an org that isn't VERIFIED yet: surface a callout
 *     telling admin to verify the org first, with a deep-link to
 *     /organizations/{id}.
 *   * Claim has no org at all (legacy anonymous public submission):
 *     show an org-picker filtered to VERIFIED orgs only, plus a
 *     "no good options" fallback that explains the workaround
 *     (ask the requester to re-file via the owner portal).
 */

import Link from "next/link";
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
  type OwnershipRequestAdminRead,
  useAdminOrganizations,
  useApproveOwnershipRequest,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  request: OwnershipRequestAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ApproveDialog({ request, open, onOpenChange }: Props) {
  const claimOrg = request.organization;
  const claimOrgVerified = claimOrg?.status === "VERIFIED";

  // Legacy fallback: if the claim has no org at all, admin picks
  // from existing VERIFIED orgs.
  const [legacyOrgId, setLegacyOrgId] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");
  const { toast } = useToast();
  const { data: allOrgs, isLoading: orgsLoading } = useAdminOrganizations({
    status: claimOrg ? undefined : "VERIFIED",
  });
  const approve = useApproveOwnershipRequest();

  React.useEffect(() => {
    if (open) {
      setLegacyOrgId("");
      setNote("");
    }
  }, [open, request.id]);

  // Submission contract: if the claim has a VERIFIED org we send
  // nothing extra; if the claim is legacy (no org) admin must have
  // picked one from the dropdown.
  const canSubmit =
    (claimOrg && claimOrgVerified) || (!claimOrg && legacyOrgId.length > 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || approve.isPending) return;

    try {
      await approve.mutateAsync({
        id: request.id,
        payload: {
          organization_id: claimOrg ? null : legacyOrgId,
          note: note.trim() || null,
          // Defaults — can be exposed in an Advanced section later.
          member_role: "OWNER_ADMIN",
          place_owner_role: "PRIMARY",
        },
      });
      toast({
        title: "Ownership request approved",
        description: `${request.contact_name} now owns this place.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Approval failed",
        overrides: {
          OWNERSHIP_REQUEST_TERMINAL: {
            title: "Request already decided",
            description:
              "This ownership request is already approved, rejected, or cancelled. Reload to see the latest state.",
          },
          OWNERSHIP_APPROVE_NO_ORG: {
            title: "No sponsoring organization",
            description:
              "This claim has no organization. Ask the requester to re-file via the owner portal, or pick an existing verified org.",
          },
          OWNERSHIP_APPROVE_ORG_NOT_VERIFIED: {
            title: "Verify the organization first",
            description:
              "Open the organization in /admin/organizations and verify it before approving this claim.",
          },
          ORGANIZATION_NOT_FOUND: {
            title: "Organization not found",
            description:
              "That organization no longer exists. Refresh the list and try again.",
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
            <DialogTitle>Approve ownership request</DialogTitle>
            <DialogDescription>
              Grant {request.contact_name} ownership of this place under
              the sponsoring organization.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {claimOrg ? (
              <ClaimOrgSection
                orgId={claimOrg.id}
                orgName={claimOrg.name}
                isVerified={claimOrgVerified}
                statusLabel={claimOrg.status}
              />
            ) : (
              <LegacyOrgPicker
                orgs={allOrgs ?? []}
                isLoading={orgsLoading}
                value={legacyOrgId}
                onChange={setLegacyOrgId}
              />
            )}

            <div className="space-y-2">
              <Label htmlFor="approve-note">Note (optional)</Label>
              <Textarea
                id="approve-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Internal note attached to the approval event"
                maxLength={2000}
              />
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
              disabled={!canSubmit || approve.isPending}
              title={
                !canSubmit
                  ? claimOrg && !claimOrgVerified
                    ? "Verify the sponsoring organization first"
                    : "Pick a verified organization"
                  : undefined
              }
            >
              {approve.isPending ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Claim-org confirmation card (slice-5b path)
// ---------------------------------------------------------------------------
function ClaimOrgSection({
  orgId,
  orgName,
  isVerified,
  statusLabel,
}: {
  orgId: string;
  orgName: string;
  isVerified: boolean;
  statusLabel: string;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Sponsoring organization
        </p>
        <Link
          href={`/organizations/${orgId}`}
          className="mt-1 inline-block text-base font-semibold hover:underline"
        >
          {orgName}
        </Link>
        <p className="mt-1 text-sm text-muted-foreground">
          Status: {humanStatus(statusLabel)}
        </p>
      </div>

      {!isVerified && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          This organization isn&apos;t verified yet.{" "}
          <Link
            href={`/organizations/${orgId}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            Open it
          </Link>{" "}
          to review the supporting documents and verify before approving
          this claim.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy fallback — claim has no org, admin picks from VERIFIED orgs
// ---------------------------------------------------------------------------
function LegacyOrgPicker({
  orgs,
  isLoading,
  value,
  onChange,
}: {
  orgs: { id: string; name: string }[];
  isLoading: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
      <p className="text-sm text-amber-900 dark:text-amber-100">
        This claim was filed via the public anonymous endpoint and has
        no sponsoring organization. The cleaner path is to ask the
        requester to re-file via the owner portal so they pick the
        org themselves; otherwise pick an existing verified
        organization here.
      </p>

      <div className="space-y-1">
        <Label htmlFor="legacy-org-select" className="text-xs">
          Verified organization
        </Label>
        <Select value={value} onValueChange={onChange} disabled={isLoading}>
          <SelectTrigger id="legacy-org-select">
            <SelectValue
              placeholder={
                isLoading ? "Loading…" : "Select a verified organization"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                {org.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function humanStatus(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft (owner hasn't submitted)";
    case "UNDER_REVIEW":
      return "Under review (verify first)";
    case "VERIFIED":
      return "Verified";
    case "REJECTED":
      return "Rejected";
    default:
      return status;
  }
}
