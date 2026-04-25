"use client";

/**
 * Admin organization detail page.
 *
 * Header with name + org id chip, Edit button in the corner. Details
 * section shows contact email + created/updated timestamps. Members
 * section lists OrganizationMember rows with add/remove actions; the
 * underlying ``organization_members.status='REMOVED'`` keeps
 * historical relationships on the record, so removed members surface
 * as "REMOVED" badges instead of vanishing.
 *
 * (We may want to hide REMOVED rows behind an "include removed" toggle
 * once these lists grow; for now showing everything is the simpler
 * default and matches the Ownership section's "include historical" feel.)
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
  type OrganizationAdminRead,
  type OrganizationMemberAdminRead,
  type OrganizationPlaceOwnerRead,
  useAdminOrganization,
  useAdminOrgPlaces,
  useRemoveOrgMember,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

import { AddMemberDialog } from "../_components/add-member-dialog";
import { EditOrganizationDialog } from "../_components/edit-org-dialog";
import {
  MemberRoleBadge,
  MemberStatusBadge,
} from "../_components/member-badges";

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

export default function OrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: org, isLoading, error } = useAdminOrganization(id);
  const [editOpen, setEditOpen] = React.useState(false);
  const [addMemberOpen, setAddMemberOpen] = React.useState(false);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/organizations"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← All organizations
          </Link>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            {isLoading ? <Skeleton className="h-8 w-64" /> : org?.name}
          </h1>
          {org?.contact_email && (
            <p className="mt-1 text-muted-foreground">
              <a
                href={`mailto:${org.contact_email}`}
                className="hover:underline"
              >
                {org.contact_email}
              </a>
            </p>
          )}
          {org?.id && (
            <p
              className="mt-1 font-mono text-[11px] text-muted-foreground/70"
              title="Organization ID"
            >
              {org.id}
            </p>
          )}
        </div>
        {org && (
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        )}
      </header>

      {error && <ErrorState error={error as Error} />}

      {org && (
        <>
          <section className="rounded-md border p-4">
            <h2 className="mb-2 text-sm font-semibold">Details</h2>
            <dl className="divide-y">
              <Field label="Contact email">
                {org.contact_email || (
                  <span className="italic text-muted-foreground">
                    no contact email
                  </span>
                )}
              </Field>
              <Field label="Created">{formatTimestamp(org.created_at)}</Field>
              <Field label="Last updated">
                {formatTimestamp(org.updated_at)}
              </Field>
            </dl>
          </section>

          <MembersSection org={org} onAdd={() => setAddMemberOpen(true)} />
          <PlacesSection orgId={org.id} />
        </>
      )}

      {org && (
        <>
          <EditOrganizationDialog
            organization={org}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
          <AddMemberDialog
            orgId={org.id}
            orgName={org.name}
            open={addMemberOpen}
            onOpenChange={setAddMemberOpen}
          />
        </>
      )}
    </div>
  );
}

function MembersSection({
  org,
  onAdd,
}: {
  org: OrganizationAdminRead & {
    members?: OrganizationMemberAdminRead[];
  };
  onAdd: () => void;
}) {
  const members = org.members ?? [];
  // Sort active rows to the top so "who's actually running this today"
  // is visible without scrolling past historical removed members.
  const sorted = [...members].sort((a, b) => {
    const aActive = a.status.toUpperCase() === "ACTIVE" ? 0 : 1;
    const bActive = b.status.toUpperCase() === "ACTIVE" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.created_at.localeCompare(b.created_at);
  });

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Members{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({sorted.filter((m) => m.status.toUpperCase() === "ACTIVE").length}{" "}
            active)
          </span>
        </h2>
        <Button size="sm" variant="outline" onClick={onAdd}>
          Add member
        </Button>
      </div>

      {sorted.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No members linked to this organization yet. Click{" "}
          <span className="font-medium text-foreground">Add member</span>{" "}
          to add one.
        </div>
      )}

      {sorted.length > 0 && (
        <ul className="space-y-3">
          {sorted.map((m) => (
            <MemberRow key={m.id} orgId={org.id} member={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberRow({
  orgId,
  member,
}: {
  orgId: string;
  member: OrganizationMemberAdminRead;
}) {
  const { toast } = useToast();
  const remove = useRemoveOrgMember();
  const isRemoved = member.status.toUpperCase() === "REMOVED";

  async function onRemove() {
    if (
      !window.confirm(
        "Remove this member from the organization? Their row is kept with status=REMOVED for audit.",
      )
    ) {
      return;
    }
    try {
      await remove.mutateAsync({ orgId, userId: member.user_id });
      toast({ title: "Member removed" });
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't remove member",
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Link to the user's admin detail page — makes "check who
              this user is" a one-click action without needing their
              email rendered in the row.
            */}
            <Link
              href={`/users/${member.user_id}`}
              className="font-medium hover:underline"
            >
              User{" "}
              <code className="font-mono text-xs text-muted-foreground">
                {member.user_id.slice(0, 8)}…
              </code>
            </Link>
            <MemberRoleBadge role={member.role} />
            <MemberStatusBadge status={member.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Added {formatTimestamp(member.created_at)}
          </p>
        </div>
        {!isRemoved && (
          <Button
            size="sm"
            variant="destructive"
            onClick={onRemove}
            disabled={remove.isPending}
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </Button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Places owned by this org
// ---------------------------------------------------------------------------

/**
 * Lists PlaceOwner rows with the place nested inline. Server sorts
 * ACTIVE-first, then name-asc within a status group — this component
 * just renders the order it's handed.
 *
 * Management (link / unlink / revoke) happens on the place detail
 * page's Ownership section, not here. That keeps "where an org runs"
 * read-only from this angle and prevents two entry points from
 * fighting over the same PlaceOwner row. An admin who wants to revoke
 * clicks through to the place, which has the full dialog + audit
 * reason capture.
 */
function PlacesSection({ orgId }: { orgId: string }) {
  const { data, isLoading, error } = useAdminOrgPlaces(orgId);
  const rows = data ?? [];
  const activeCount = rows.filter(
    (r) => r.status.toUpperCase() === "ACTIVE",
  ).length;

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Places{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({activeCount} active)
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Manage ownership from each place&apos;s detail page.
        </span>
      </div>

      {isLoading && <Skeleton className="h-16 w-full" />}

      {error && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load places: {(error as Error).message}
        </p>
      )}

      {data && rows.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          This organization doesn&apos;t own any places yet. Places get
          linked when an ownership request for the org is approved, or
          via an admin action on the place detail page.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => (
            <OrgPlaceRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OrgPlaceRow({ row }: { row: OrganizationPlaceOwnerRead }) {
  const { place } = row;
  const isRevoked = row.status.toUpperCase() === "REVOKED";
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/places/${place.id}`}
              className={
                isRevoked || place.is_deleted
                  ? "font-medium text-muted-foreground hover:underline"
                  : "font-medium hover:underline"
              }
            >
              {place.name}
            </Link>
            <MemberRoleBadge role={row.role} />
            <MemberStatusBadge status={row.status} />
            {place.is_deleted && (
              <Badge variant="destructive" className="uppercase tracking-wide">
                Deleted
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {place.address ? (
              <>{place.address}</>
            ) : (
              <span className="italic">no address</span>
            )}
            {(place.city || place.country_code) && (
              <>
                {" · "}
                {[place.city, place.country_code].filter(Boolean).join(", ")}
              </>
            )}
            {" · linked "}
            {formatTimestamp(row.created_at)}
          </p>
        </div>
      </div>
    </li>
  );
}

function ErrorState({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p className="font-medium">
        Failed to load organization
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
    </div>
  );
}
