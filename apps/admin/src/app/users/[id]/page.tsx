"use client";

/**
 * Admin user detail page.
 *
 * Shows the user's canonical metadata (email, display name, role, active
 * status) with inline actions: Edit (opens EditUserDialog for role /
 * display_name / active) and a quick Deactivate / Activate toggle that
 * PATCHes ``is_active`` without opening a dialog.
 *
 * A self-demotion guard hides the role dropdown inside the edit dialog,
 * and the deactivate button disappears for the current user so an admin
 * can't lock themselves out from the detail page either.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type UserAdminRead,
  type UserOrganizationMembershipRead,
  useAdminUser,
  useCurrentUser,
  usePatchUser,
  useUserOrganizations,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

import {
  MemberRoleBadge,
  MemberStatusBadge,
} from "../../organizations/_components/member-badges";
import { EditUserDialog } from "../_components/edit-user-dialog";
import { RoleBadge } from "../_components/role-badge";

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: user, isLoading, error } = useAdminUser(id);
  const [editOpen, setEditOpen] = React.useState(false);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/users"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← All users
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              {isLoading ? <Skeleton className="h-8 w-64" /> : user?.email}
            </h1>
            {user && <RoleBadge role={user.role} />}
            {user && !user.is_active && (
              <Badge
                variant="destructive"
                className="uppercase tracking-wide"
              >
                Inactive
              </Badge>
            )}
          </div>
          {user?.display_name && (
            <p className="mt-1 text-muted-foreground">{user.display_name}</p>
          )}
          {user?.id && (
            <p
              className="mt-1 font-mono text-[11px] text-muted-foreground/70"
              title="User ID"
            >
              {user.id}
            </p>
          )}
        </div>
        {user && <UserActions user={user} onEdit={() => setEditOpen(true)} />}
      </header>

      {error && <ErrorState error={error as Error} />}

      {user && (
        <>
          <section className="rounded-md border p-4">
            <h2 className="mb-2 text-sm font-semibold">Details</h2>
            <dl className="divide-y">
              <Field label="Role">
                <RoleBadge role={user.role} />
              </Field>
              <Field label="Status">
                {user.is_active ? (
                  <Badge variant="default" className="uppercase tracking-wide">
                    Active
                  </Badge>
                ) : (
                  <Badge
                    variant="destructive"
                    className="uppercase tracking-wide"
                  >
                    Inactive
                  </Badge>
                )}
              </Field>
              <Field label="Created">{formatTimestamp(user.created_at)}</Field>
              <Field label="Last updated">
                {formatTimestamp(user.updated_at)}
              </Field>
            </dl>
          </section>

          <OrganizationsSection userId={user.id} userRole={user.role} />
        </>
      )}

      {user && (
        <EditUserDialog
          user={user}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </div>
  );
}

function UserActions({
  user,
  onEdit,
}: {
  user: UserAdminRead;
  onEdit: () => void;
}) {
  const { toast } = useToast();
  const { data: me } = useCurrentUser();
  const patch = usePatchUser();

  // Self-deactivation is the other half of the self-demotion footgun:
  // hide the deactivate button when viewing yourself. The edit dialog
  // already hides the is_active checkbox in the same case.
  const isSelf = me?.id === user.id;

  async function toggleActive() {
    try {
      await patch.mutateAsync({
        id: user.id,
        payload: { is_active: !user.is_active },
      });
      toast({
        title: user.is_active ? "User deactivated" : "User activated",
        variant: user.is_active ? undefined : "success",
      });
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: user.is_active
          ? "Couldn't deactivate"
          : "Couldn't activate",
        overrides: {
          // The button is hidden for self in the normal UI flow, but a
          // stale `me` cache or direct API call can still end up here.
          // Speak plainly when the server catches it.
          SELF_DEACTIVATION_FORBIDDEN: {
            title: "Can't deactivate yourself",
            description:
              "Ask another admin to deactivate your account. The server blocks self-deactivation because it would end your current session.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={onEdit}>
        Edit
      </Button>
      {!isSelf && (
        <Button
          size="sm"
          variant={user.is_active ? "destructive" : "default"}
          onClick={toggleActive}
          disabled={patch.isPending}
        >
          {patch.isPending
            ? user.is_active
              ? "Deactivating…"
              : "Activating…"
            : user.is_active
              ? "Deactivate"
              : "Activate"}
        </Button>
      )}
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  const hint =
    isApi && error.status === 404
      ? "That user id doesn't exist. Check the URL or go back to the list."
      : null;
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p className="font-medium">
        Failed to load user
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organizations — user's membership in orgs (if any)
// ---------------------------------------------------------------------------

/**
 * Show the user's org memberships inline. Every user can *technically*
 * be a member of an org, but the common case is OWNERs — so the empty
 * state for non-OWNER roles is a bit softer ("no memberships, and
 * consumers/admins/verifiers typically don't need any"). Management
 * happens from the org detail page; this section is read-only plus a
 * link out to that org.
 */
function OrganizationsSection({
  userId,
  userRole,
}: {
  userId: string;
  userRole: string;
}) {
  const { data, isLoading, error } = useUserOrganizations(userId);
  const memberships = data ?? [];
  const isOwner = userRole === "OWNER";

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Organizations</h2>
        <Link
          href="/organizations"
          className="text-xs text-muted-foreground hover:underline"
        >
          Manage in organizations →
        </Link>
      </div>

      {isLoading && <Skeleton className="h-20 w-full" />}

      {error && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load organizations: {(error as Error).message}
        </p>
      )}

      {data && memberships.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {isOwner
            ? "This owner isn't linked to any organization yet. Open an org and use Add member to link them."
            : "No organization memberships. Typically only OWNER users have these; admins/verifiers/consumers don't need one."}
        </div>
      )}

      {data && memberships.length > 0 && (
        <ul className="space-y-3">
          {memberships.map((m) => (
            <MembershipRow key={m.id} membership={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MembershipRow({
  membership,
}: {
  membership: UserOrganizationMembershipRead;
}) {
  const { organization: org, role, status } = membership;
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/organizations/${org.id}`}
              className="font-medium hover:underline"
            >
              {org.name}
            </Link>
            <MemberRoleBadge role={role} />
            <MemberStatusBadge status={status} />
          </div>
          {org.contact_email && (
            <p className="mt-1 text-xs text-muted-foreground">
              <a
                href={`mailto:${org.contact_email}`}
                className="hover:underline"
              >
                {org.contact_email}
              </a>
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
