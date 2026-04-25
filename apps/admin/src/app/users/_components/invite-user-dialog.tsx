"use client";

/**
 * Invite User dialog.
 *
 * Two-step flow:
 *
 *   1. Admin fills in email / display_name / role and submits. The
 *      server creates the user row AND mints a single-use invite
 *      token, returning both in one response.
 *
 *   2. Dialog swaps to a success pane that shows the pre-baked
 *      set-password URL in a copy-to-clipboard box. The admin shares
 *      that link with the invitee via whatever channel makes sense
 *      (Slack DM, 1Password, in person). No email delivery —
 *      intentional scope cut; the URL is the deliverable today.
 *
 * Once closed, the dialog navigates to the new user's detail page,
 * same as the pre-invite version. "View the URL again" is not a
 * supported path — the server never exposes the token after this
 * response. If the admin loses it, they re-invite (a future
 * re-invite endpoint will burn the old token and mint a new one).
 *
 * Field-level validation errors from the server 422 land directly
 * under the relevant input (via fieldErrorsFromApiError), same
 * pattern as PlaceEditDialog.
 */

import { useRouter } from "next/navigation";
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
import {
  fieldErrorsFromApiError,
  friendlyApiError,
} from "@/lib/api/friendly-errors";
import {
  type UserAdminCreate,
  type UserAdminCreateResponse,
  type UserRole,
  useCreateUser,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Staff-only role list. The admin panel is an internal tool; this
// dialog onboards internal teammates. CONSUMER is deliberately absent
// — consumers self-register through the public catalog (separate
// product). OWNER is deliberately absent for now — they'll belong on
// the owner dashboard once that ships, and inviting them through the
// admin panel would land them on a page covered in 403s.
//
// Add OWNER back here when the owner dashboard exists + ``homeFor``
// in ``panel-access.ts`` returns a real path for the role.
const ROLE_OPTIONS: { value: UserRole; label: string; description: string }[] =
  [
    { value: "ADMIN", label: "Admin", description: "Full admin panel access" },
    {
      value: "VERIFIER",
      label: "Verifier",
      description: "Moderates halal claims in the claims queue",
    },
  ];

type FormState = {
  email: string;
  display_name: string;
  role: UserRole;
};

const INITIAL: FormState = {
  email: "",
  display_name: "",
  // Default to VERIFIER because the admin role should be a deliberate
  // choice — defaulting to ADMIN is the classic "I clicked Invite
  // without thinking and now this person has the keys" footgun.
  role: "VERIFIER",
};

export function InviteUserDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const create = useCreateUser();

  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<keyof FormState, string>>
  >({});
  // Holds the full create-response after a successful invite; the
  // dialog switches from form → "here's the link" pane based on this.
  // null === still on the form.
  const [invited, setInvited] = React.useState<UserAdminCreateResponse | null>(
    null,
  );

  React.useEffect(() => {
    if (open) {
      setForm(INITIAL);
      setFieldErrors({});
      setInvited(null);
    }
  }, [open]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (create.isPending) return;

    const payload: UserAdminCreate = {
      email: form.email.trim(),
      role: form.role,
      // Server accepts null for an unset display name — normalize empty
      // strings so we don't store whitespace-only names.
      display_name: form.display_name.trim() || null,
    };

    setFieldErrors({});

    try {
      const created = await create.mutateAsync(payload);
      toast({
        title: "User invited",
        description: `${created.email} added as ${created.role}.`,
        variant: "success",
      });
      // Switch to the success pane so the admin can copy the URL. We
      // do NOT close the dialog or navigate yet — the token is only
      // visible here once, so closing early would orphan it.
      setInvited(created);
    } catch (err) {
      const raw = fieldErrorsFromApiError(err);
      const narrowed: Partial<Record<keyof FormState, string>> = {};
      const keys: (keyof FormState)[] = ["email", "display_name", "role"];
      for (const k of keys) {
        if (raw[k]) narrowed[k] = raw[k];
      }
      setFieldErrors(narrowed);

      const msg = friendlyApiError(err, {
        defaultTitle: "Invite failed",
        overrides: {
          USER_EMAIL_EXISTS: {
            title: "Email already in use",
            description:
              "A user with that email is already in the system. Search for it on the users list.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  function finishAndGoToUser() {
    if (!invited) return;
    const userId = invited.id;
    onOpenChange(false);
    // Navigate to the new user's detail page so the admin can verify
    // / iterate on the role. The invited state resets via the
    // open-effect when the dialog closes.
    router.push(`/users/${userId}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {invited ? (
          <InviteSuccessPane
            invited={invited}
            onDone={finishAndGoToUser}
          />
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Invite a staff member</DialogTitle>
              <DialogDescription>
                Adds a teammate to Trust Halal&apos;s admin or
                moderation surface and generates a one-time set-password
                link. You&apos;ll see the link on the next screen — copy
                it and share it however makes sense (email, Slack, in
                person). Restaurant owners and consumers don&apos;t
                belong here; they&apos;ll have their own surfaces.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-user-email">Email</Label>
                <Input
                  id="invite-user-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="name@example.com"
                  autoFocus
                  required
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={
                    fieldErrors.email ? "invite-user-email-error" : undefined
                  }
                />
                <FieldError id="invite-user-email-error" message={fieldErrors.email} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-user-display-name">
                  Display name <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="invite-user-display-name"
                  value={form.display_name}
                  onChange={(e) => update("display_name", e.target.value)}
                  maxLength={120}
                  placeholder="Ada Admin"
                  aria-invalid={Boolean(fieldErrors.display_name)}
                  aria-describedby={
                    fieldErrors.display_name
                      ? "invite-user-display-name-error"
                      : undefined
                  }
                />
                <FieldError
                  id="invite-user-display-name-error"
                  message={fieldErrors.display_name}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-user-role">Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => update("role", v as UserRole)}
                >
                  <SelectTrigger id="invite-user-role">
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
                <FieldError id="invite-user-role-error" message={fieldErrors.role} />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Inviting…" : "Invite user"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Step 2 of the invite flow — shown after a successful POST
 * /admin/users. Renders the one-time set-password URL with a copy
 * button and a short explanation. The underlying plaintext token is
 * never reachable again; this is the only screen where it's visible.
 *
 * The copy button uses the async Clipboard API with a button-level
 * "Copied!" state so the admin gets visible feedback. We fall back to
 * a selectable input so "select-all + copy" still works in browsers
 * where clipboard-write is blocked (HTTP origins, permissions, etc).
 */
function InviteSuccessPane({
  invited,
  onDone,
}: {
  invited: UserAdminCreateResponse;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(invited.invite_url);
      setCopied(true);
      // Reset the label after a couple seconds so the admin sees the
      // confirmation but the button doesn't get stuck.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail on non-secure contexts or if the user
      // denied permission. Tell them and let them copy manually from
      // the input instead.
      toast({
        title: "Couldn't copy automatically",
        description:
          "Select the URL in the box and copy it manually (Cmd/Ctrl+C).",
        variant: "destructive",
      });
    }
  }

  const expires = new Date(invited.invite_expires_at).toLocaleString(
    undefined,
    { dateStyle: "medium", timeStyle: "short" },
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invite created</DialogTitle>
        <DialogDescription>
          Share this set-password link with{" "}
          <span className="font-medium text-foreground">{invited.email}</span>.
          This is the only time it&apos;ll be visible — if you lose it,
          you&apos;ll have to re-invite.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-3">
        <Label htmlFor="invite-url">Set-password URL</Label>
        <div className="flex gap-2">
          <Input
            id="invite-url"
            readOnly
            value={invited.invite_url}
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
          <span className="font-medium text-foreground">{expires}</span>. The
          invitee picks a password there and is signed in automatically.
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

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}
