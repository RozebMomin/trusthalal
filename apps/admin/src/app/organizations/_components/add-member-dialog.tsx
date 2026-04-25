"use client";

/**
 * Add Member to Organization dialog.
 *
 * Two-step pattern:
 *   1. Admin types into a search box; useAdminUsers with a debounced q
 *      surfaces a short list of matches.
 *   2. Admin picks one + chooses their role inside the org; submit
 *      sends {user_id, role} to POST /admin/organizations/{id}/members.
 *
 * We intentionally don't offer "invite by email address that doesn't
 * exist yet" here — that's what the Users > Invite flow is for. This
 * dialog adds *existing* users to an org.
 *
 * The server flips a deactivated member back to ACTIVE on add, so
 * re-adding someone who was removed previously works cleanly. We
 * surface ``ORGANIZATION_MEMBER_EXISTS`` (409) with helpful copy for
 * the already-active case.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type MemberAdminCreate,
  type UserAdminRead,
  useAdminUsers,
  useAddOrgMember,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  orgId: string;
  orgName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Allowed values per the CHECK constraint (see migration
// d1f9a9091e2f). Keep in sync if the constraint evolves.
const ROLE_OPTIONS: { value: string; label: string; description: string }[] = [
  {
    value: "OWNER_ADMIN",
    label: "Owner Admin",
    description: "Full control over the org's places + members",
  },
  {
    value: "MANAGER",
    label: "Manager",
    description: "Day-to-day ops, limited member management",
  },
  {
    value: "STAFF",
    label: "Staff",
    description: "Read-only access",
  },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function AddMemberDialog({ orgId, orgName, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const add = useAddOrgMember();

  const [rawQuery, setRawQuery] = React.useState("");
  const [pickedUser, setPickedUser] = React.useState<UserAdminRead | null>(null);
  const [role, setRole] = React.useState<string>("OWNER_ADMIN");

  const query = useDebounced(rawQuery.trim(), 250);
  // Only fire the search once the admin's typed something meaningful;
  // otherwise an empty-q listing would dump 200 users into the dropdown.
  const { data: matches } = useAdminUsers({
    q: query.length >= 2 ? query : undefined,
  });

  React.useEffect(() => {
    if (open) {
      setRawQuery("");
      setPickedUser(null);
      setRole("OWNER_ADMIN");
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pickedUser || add.isPending) return;

    const payload: MemberAdminCreate = {
      user_id: pickedUser.id,
      role,
    };

    try {
      await add.mutateAsync({ orgId, payload });
      toast({
        title: "Member added",
        description: `${pickedUser.email} joined ${orgName} as ${role}.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't add member",
        overrides: {
          ORGANIZATION_MEMBER_EXISTS: {
            title: "Already a member",
            description:
              "That user is already an active member of this organization.",
          },
          USER_NOT_FOUND: {
            title: "User not found",
            description:
              "That user id no longer exists — refresh the search and pick again.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  // Hide the already-picked user from the match list so clicking them
  // again doesn't visually disappear (confusing). Small UX thing.
  const filteredMatches = (matches ?? []).filter(
    (u) => !pickedUser || u.id !== pickedUser.id,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add a member to {orgName}</DialogTitle>
            <DialogDescription>
              Search for an existing user by email or display name, pick
              their role inside this org, then save.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="add-member-search">Find user</Label>
              <Input
                id="add-member-search"
                type="search"
                value={rawQuery}
                onChange={(e) => {
                  setRawQuery(e.target.value);
                  // Re-typing invalidates the prior pick so the submit
                  // button doesn't commit a stale selection.
                  if (pickedUser) setPickedUser(null);
                }}
                placeholder="Email or display name"
                autoFocus
                disabled={add.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Type at least 2 characters. Need to invite someone new?
                Use{" "}
                <span className="text-foreground">Users → Invite user</span>{" "}
                first.
              </p>
            </div>

            {pickedUser ? (
              <div
                className="rounded-md border bg-muted/30 p-3"
                role="status"
                aria-live="polite"
              >
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Selected
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {pickedUser.display_name || pickedUser.email}
                </p>
                {pickedUser.display_name && (
                  <p className="text-sm text-muted-foreground">
                    {pickedUser.email}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Role:{" "}
                  <span className="font-medium text-foreground">
                    {pickedUser.role}
                  </span>{" "}
                  (user account role — different from org role below)
                </p>
              </div>
            ) : (
              query.length >= 2 && (
                <div className="rounded-md border">
                  {filteredMatches.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      No users match &ldquo;{query}&rdquo;.
                    </p>
                  ) : (
                    <ul className="divide-y text-sm">
                      {filteredMatches.slice(0, 8).map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            onClick={() => setPickedUser(u)}
                            className="block w-full px-3 py-2 text-left hover:bg-accent/50"
                          >
                            <div className="font-medium">
                              {u.display_name || u.email}
                            </div>
                            {u.display_name && (
                              <div className="text-xs text-muted-foreground">
                                {u.email}
                              </div>
                            )}
                            <div className="text-xs text-muted-foreground">
                              {u.role}
                              {!u.is_active && " · inactive"}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            )}

            <div className="space-y-2">
              <Label htmlFor="add-member-role">Role in {orgName}</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="add-member-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      <span className="font-medium">{r.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.description}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={add.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!pickedUser || add.isPending}>
              {add.isPending ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
