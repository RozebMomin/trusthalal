"use client";

/**
 * Owner portal — my organizations.
 *
 * Lists every Organization the signed-in user is an active member
 * of, with status badges and "Manage" links into the detail page.
 *
 * Empty-state CTA points to the create page. The /claim flow will
 * also link here when the owner has no eligible orgs to sponsor a
 * claim.
 *
 * Status filter mirrors the /my-claims page pattern (single
 * dropdown, default "Verified", in-progress / rejected behind it).
 * Switching between the two surfaces feels consistent — same
 * affordance, same default-to-the-working-set posture.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { OrgStatusBadge, orgStatusDescription } from "@/components/org-status-badge";
import {
  type MyOrganizationRead,
  type OrganizationStatus,
  useMyOrganizations,
} from "@/lib/api/hooks";

// Status filter buckets — same shape as the /my-claims page so the
// owner doesn't have to re-learn a different control on each
// surface. "Verified" is the default working set; everything else
// stays one click away in the dropdown.
type StatusFilter = "verified" | "in_progress" | "rejected" | "all";

const STATUS_FILTERS: ReadonlyArray<{
  value: StatusFilter;
  label: string;
  /** Predicate against a single org's status. */
  match: (status: OrganizationStatus) => boolean;
}> = [
  {
    value: "verified",
    label: "Verified",
    match: (s) => s === "VERIFIED",
  },
  {
    value: "in_progress",
    label: "In progress",
    match: (s) => s === "DRAFT" || s === "UNDER_REVIEW",
  },
  {
    value: "rejected",
    label: "Rejected",
    match: (s) => s === "REJECTED",
  },
  { value: "all", label: "All", match: () => true },
];

export default function MyOrganizationsPage() {
  const { data, isLoading, isError } = useMyOrganizations();
  // Memoize so the ``data ?? []`` substitution doesn't allocate a
  // fresh array literal on every render.
  const orgs = React.useMemo(() => data ?? [], [data]);

  // Default to "Verified" — the working set most owners visit
  // /my-organizations to look at. DRAFT / UNDER_REVIEW / REJECTED
  // are still one click away in the dropdown.
  const [statusFilter, setStatusFilter] =
    React.useState<StatusFilter>("verified");
  const activeFilter =
    STATUS_FILTERS.find((f) => f.value === statusFilter) ?? STATUS_FILTERS[0];
  const visibleOrgs = orgs.filter((o) =>
    activeFilter.match(o.status as OrganizationStatus),
  );

  // Counts per bucket so each option in the dropdown carries the
  // size hint inline. Computed off the unfiltered list so the
  // numbers don't shift when the user switches buckets.
  const counts = React.useMemo(() => {
    const out: Record<StatusFilter, number> = {
      verified: 0,
      in_progress: 0,
      rejected: 0,
      all: orgs.length,
    };
    for (const o of orgs) {
      const s = o.status as OrganizationStatus;
      if (STATUS_FILTERS[0].match(s)) out.verified += 1;
      else if (STATUS_FILTERS[1].match(s)) out.in_progress += 1;
      else if (STATUS_FILTERS[2].match(s)) out.rejected += 1;
    }
    return out;
  }, [orgs]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Organizations
          </h1>
          <p className="mt-2 text-muted-foreground">
            The business entities you operate. Trust Halal verifies
            each one before it can sponsor a place claim.
          </p>
        </div>
        <Link href="/my-organizations/new">
          <Button>Add organization</Button>
        </Link>
      </header>

      {/* Status filter — mirrors the /my-claims dropdown so the
          owner gets a consistent affordance across both surfaces.
          Hidden when the owner has no orgs at all (nothing to
          filter on a fresh account). */}
      {!isLoading && !isError && orgs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="org-status-filter"
            className="text-xs text-muted-foreground"
          >
            Show
          </label>
          <select
            id="org-status-filter"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as StatusFilter)
            }
            className="flex h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label} ({counts[f.value]})
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading your organizations…
        </p>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-md border bg-card px-4 py-3 text-sm text-destructive"
        >
          We couldn&apos;t load your organizations. Try refreshing the
          page; if it keeps happening, contact{" "}
          <a
            href="mailto:support@trusthalal.org"
            className="underline-offset-4 hover:underline"
          >
            support@trusthalal.org
          </a>
          .
        </p>
      ) : orgs.length === 0 ? (
        <EmptyState />
      ) : visibleOrgs.length === 0 ? (
        <FilteredEmptyState
          filter={statusFilter}
          onShowAll={() => setStatusFilter("all")}
        />
      ) : (
        <ul className="space-y-3">
          {visibleOrgs.map((o) => (
            <OrgRow key={o.id} org={o} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Empty state when the active filter excluded every org, vs the
 * default ``EmptyState`` which fires only when the owner has no
 * orgs at all. Different copy + a "Show all" shortcut so the owner
 * doesn't have to hunt for the dropdown to confirm their other
 * orgs still exist. Same shape the /my-claims page uses for
 * symmetry.
 */
function FilteredEmptyState({
  filter,
  onShowAll,
}: {
  filter: StatusFilter;
  onShowAll: () => void;
}) {
  const label =
    STATUS_FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ??
    filter;
  return (
    <div className="rounded-md border border-dashed bg-card px-6 py-10 text-center">
      <p className="text-base font-medium">
        No {label} organizations right now.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Switch the filter above to see your other organizations.
      </p>
      <div className="mt-4">
        <Button variant="outline" size="sm" onClick={onShowAll}>
          Show all organizations
        </Button>
      </div>
    </div>
  );
}

function OrgRow({ org }: { org: MyOrganizationRead }) {
  const createdAt = new Date(org.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <li className="rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/my-organizations/${org.id}`}
            className="truncate font-medium text-foreground hover:underline"
          >
            {org.name}
          </Link>
          {org.contact_email && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {org.contact_email}
            </p>
          )}
        </div>
        <OrgStatusBadge status={org.status} />
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {orgStatusDescription(org.status)}
      </p>

      <p className="mt-3 text-xs text-muted-foreground">
        {org.attachments.length === 0
          ? "No documents attached yet."
          : `${org.attachments.length} document${
              org.attachments.length === 1 ? "" : "s"
            } attached.`}{" "}
        Created {createdAt}.
      </p>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed bg-card px-6 py-10 text-center">
      <p className="text-base font-medium">No organizations yet.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Add the business entity that operates your restaurant — an LLC,
        DBA, sole proprietorship, etc. Trust Halal verifies each
        entity before claims can be filed under it.
      </p>
      <div className="mt-4">
        <Link href="/my-organizations/new">
          <Button>Add an organization</Button>
        </Link>
      </div>
    </div>
  );
}
