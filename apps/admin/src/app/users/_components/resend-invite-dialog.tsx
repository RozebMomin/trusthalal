"use client";

/**
 * Resend Invite dialog — for users stuck on INVITE_PENDING or
 * INVITE_EXPIRED.
 *
 * Two-step flow, mirrors InviteUserDialog so the admin's muscle
 * memory carries over:
 *
 *   1. Confirmation pane explains what'll happen (mint a fresh
 *      invite, revoke the prior live one, send the email).
 *   2. On success, swap to the "here's the URL" pane with copy
 *      button — the plaintext token is visible only here, same
 *      as the create-user flow.
 *
 * Server-side gates already 409 for ALREADY_ONBOARDED / INACTIVE,
 * so the admin opening this dialog on the wrong row gets a clean
 * error toast and a closed dialog. The button that opens this
 * dialog also hides itself when the state is ACTIVE / DEACTIVATED,
 * so reaching this surface for an ineligible user requires going
 * around the UI.
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
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type ResendInviteResponse,
  type UserAdminRead,
  useResendInvite,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  user: UserAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ResendInviteDialog({ user, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const resend = useResendInvite();

  // null === still on the confirm pane. Set to the response after
  // a successful mint so we can show the URL.
  const [resent, setResent] = React.useState<ResendInviteResponse | null>(
    null,
  );

  // Reset the dialog state whenever it reopens so a previously-shown
  // URL pane doesn't leak across opens.
  React.useEffect(() => {
    if (open) setResent(null);
  }, [open]);

  async function onConfirm() {
    if (resend.isPending) return;
    try {
      const out = await resend.mutateAsync({ id: user.id });
      toast({
        title: "Invite resent",
        description: `Fresh set-password link minted for ${user.email}.`,
        variant: "success",
      });
      setResent(out);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't resend invite",
        overrides: {
          // Server-side gates. The button that opened this dialog
          // already hides itself for these states, but a stale cache
          // or race can still land us here — speak plainly when it
          // does.
          USER_ALREADY_ONBOARDED: {
            title: "User has already set a password",
            description:
              "Re-inviting users who finished onboarding isn't supported — use the password-reset flow when it ships.",
          },
          USER_INACTIVE: {
            title: "User is deactivated",
            description:
              "Reactivate this user before sending a fresh invite.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
      // Close on failure so the admin can re-evaluate without staring
      // at a stuck dialog.
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {resent ? (
          <ResendSuccessPane
            email={user.email}
            resent={resent}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Resend invite</DialogTitle>
              <DialogDescription>
                A fresh single-use set-password link will be minted for{" "}
                <span className="font-medium text-foreground">
                  {user.email}
                </span>
                . Any outstanding invite for this user will be revoked,
                and a new invite email will be sent. You&apos;ll also
                see the link on the next screen so you can share it
                manually if email isn&apos;t enough.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={resend.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={onConfirm}
                disabled={resend.isPending}
              >
                {resend.isPending ? "Sending…" : "Resend invite"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Success pane — same UI shape as InviteUserDialog's pane so the
 * admin sees a consistent "here's the URL, copy it" workflow whether
 * they just created the user or re-invited an existing one.
 */
function ResendSuccessPane({
  email,
  resent,
  onDone,
}: {
  email: string;
  resent: ResendInviteResponse;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(resent.invite_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Same fallback strategy as InviteSuccessPane.
      toast({
        title: "Couldn't copy automatically",
        description:
          "Select the URL in the box and copy it manually (Cmd/Ctrl+C).",
        variant: "destructive",
      });
    }
  }

  const expires = new Date(resent.invite_expires_at).toLocaleString(
    undefined,
    { dateStyle: "medium", timeStyle: "short" },
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invite resent</DialogTitle>
        <DialogDescription>
          New set-password link for{" "}
          <span className="font-medium text-foreground">{email}</span>.
          This is the only time it&apos;ll be visible — if you lose
          it, you&apos;ll have to resend again.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-3">
        <Label htmlFor="resend-invite-url">Set-password URL</Label>
        <div className="flex gap-2">
          <Input
            id="resend-invite-url"
            readOnly
            value={resent.invite_url}
            className="font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            onClick={copyUrl}
            aria-live="polite"
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Valid until{" "}
          <span className="font-medium text-foreground">{expires}</span>.
          The invitee picks a password there and is signed in automatically.
        </p>
      </div>

      <DialogFooter className="mt-6">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
