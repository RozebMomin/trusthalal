"use client";

/**
 * Admin organizations review queue.
 *
 * Search + table over the org directory, defaulting to UNDER_REVIEW
 * (the work queue). Org creation, edits, and member management
 * happen on the owner portal — admin staff don't author rows here;
 * they review what owners submit. The detail page surfaces the
 * decision actions (verify / reject) and the read-only audit data.
 */

import Link from "next/link";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api/client";
import {
  type OrganizationAdminRead,
  useAdminOrganizations,
} from "@/lib/api/hooks";
import type { components } from "@/lib/api/schema";

import { OrgStatusBadge } from "./_components/org-status-badge";

type OrganizationStatus = components["schemas"]["OrganizationStatus"];

// Order matches the natural admin workflow: Under review first
// (the queue), then Verified (the bulk of healthy orgs), then the
// edge cases. Empty string = "All", which the server treats as no
// filter.
const STATUS_OPTIONS: ReadonlyArray<{
  value: "" | OrganizationStatus;
  label: string;
}> = [
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

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

export default function OrganizationsPage() {
  const [rawQuery, setRawQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<
    "" | OrganizationStatus
  >("UNDER_REVIEW");
  const query = useDebounced(rawQuery.trim(), 250);

  const { data, isLoading, error, isFetching } = useAdminOrganizations({
    q: query || undefined,
    status: statusFilter || undefined,
  });
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Organizations</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Review owner-submitted organizations. Verify them so they can
          sponsor halal claims and ownership requests.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b pb-3">
        <div className="flex-1 min-w-[240px]">
          <Input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search organization name"
          />
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="org-status-filter"
            className="text-xs text-muted-foreground"
          >
            Status
          </label>
          <select
            id="org-status-filter"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "" | OrganizationStatus)
            }
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorState error={error as Error} />}

      {isLoading && <LoadingState />}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState query={query} />
      )}

      {!isLoading && !error && rows.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Documents</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Org id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <OrgRow key={row.id} org={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {isFetching && !isLoading && (
        <p className="text-xs text-muted-foreground">Refreshing…</p>
      )}
    </div>
  );
}

function OrgRow({ org }: { org: OrganizationAdminRead }) {
  const attachmentCount = org.attachments?.length ?? 0;
  return (
    <TableRow className="hover:bg-accent/50">
      <TableCell className="font-medium">
        <Link
          href={`/organizations/${org.id}`}
          className="text-foreground hover:underline"
        >
          {org.name}
        </Link>
        {org.contact_email && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {org.contact_email}
          </p>
        )}
      </TableCell>
      <TableCell>
        <OrgStatusBadge status={org.status} />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {attachmentCount === 0 ? (
          <span className="italic">none</span>
        ) : (
          `${attachmentCount} file${attachmentCount === 1 ? "" : "s"}`
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {org.submitted_at ? (
          formatTimestamp(org.submitted_at)
        ) : (
          <span className="italic">&mdash;</span>
        )}
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs text-muted-foreground">
          {org.id.slice(0, 8)}…
        </code>
      </TableCell>
    </TableRow>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <p className="text-sm text-muted-foreground">
        {query
          ? `No organizations match "${query}".`
          : "No organizations yet. Click Create organization to add one."}
      </p>
    </div>
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
        Failed to load organizations
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
    </div>
  );
}
