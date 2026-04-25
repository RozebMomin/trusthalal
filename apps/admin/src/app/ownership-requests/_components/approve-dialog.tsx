"use client";

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

type Mode = "existing" | "new";

export function ApproveDialog({ request, open, onOpenChange }: Props) {
  const [mode, setMode] = React.useState<Mode>("existing");
  const [organizationId, setOrganizationId] = React.useState<string>("");
  const [newOrgName, setNewOrgName] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");

  const { toast } = useToast();
  const { data: orgs, isLoading: orgsLoading } = useAdminOrganizations();
  const approve = useApproveOwnershipRequest();

  // Reset form state every time the dialog opens against a new request.
  React.useEffect(() => {
    if (open) {
      setMode("existing");
      setOrganizationId("");
      setNewOrgName("");
      setNote("");
    }
  }, [open, request.id]);

  const canSubmit =
    mode === "existing"
      ? Boolean(organizationId)
      : newOrgName.trim().length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || approve.isPending) return;

    try {
      await approve.mutateAsync({
        id: request.id,
        payload: {
          organization_id: mode === "existing" ? organizationId : null,
          new_organization_name:
            mode === "new" ? newOrgName.trim() : null,
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
          OWNERSHIP_APPROVE_BAD_ORG: {
            title: "Pick exactly one organization",
            description:
              "Provide either an existing organization or a new organization name — not both, not neither.",
          },
          ORGANIZATION_NOT_FOUND: {
            title: "Organization not found",
            description:
              "The organization you picked no longer exists. Refresh the list and try again.",
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
              Grant {request.contact_name} ownership of this place. You can
              attach them to an existing organization or create a new one.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "existing" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("existing")}
              >
                Use existing org
              </Button>
              <Button
                type="button"
                variant={mode === "new" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("new")}
              >
                Create new org
              </Button>
            </div>

            {mode === "existing" ? (
              <div className="space-y-2">
                <Label htmlFor="org-select">Organization</Label>
                <Select
                  value={organizationId}
                  onValueChange={setOrganizationId}
                  disabled={orgsLoading}
                >
                  <SelectTrigger id="org-select">
                    <SelectValue
                      placeholder={
                        orgsLoading ? "Loading…" : "Select an organization"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(orgs ?? []).map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="new-org-name">New organization name</Label>
                <Input
                  id="new-org-name"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="e.g. Al Noor Restaurant Group"
                  maxLength={255}
                  autoFocus
                />
              </div>
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
            <Button type="submit" disabled={!canSubmit || approve.isPending}>
              {approve.isPending ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
