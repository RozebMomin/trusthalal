"use client";

/**
 * Admin queue for consumer dispute review.
 *
 * Phase 7 of the halal-trust v2 rebuild. Lands on OPEN — the
 * "waiting on me" bucket — with filters down to the rest of the
 * lifecycle for auditing or for picking back up disputes that
 * went to OWNER_RECONCILING / ADMIN_REVIEWING.
 *
 * Per-row click goes to /disputes/[id], the detail page where the
 * description + attachments + decision dialogs live.
 */

import Link from "next/link";
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DisputeStatusBadge,
  disputedAttributeLabel,
} from "@/components/dispute-status-badge";
import { ApiError } from "@/lib/api/client";
import {
  DISPUTE_OPEN_STATUSES,
  type ConsumerDisputeAdminRead,
  type DisputeStatus,
  useAdminDisputes,
} from "@/lib/api/hooks";

type FilterKey =
  | "OPEN_BUCKET"
  | "OPEN"
  | "OWNER_RECONCILING"
  | "ADMIN_REVIEWING"
  | "RESOLVED_UPHELD"
  | "RESOLVED_DISMISSED"
  | "WITHDRAWN"
  | "ALL";

type Filter = {
  key: FilterKey;
  label: string;
  /** Passed to the API as ?status=...; undefined = no server filter. */
  apiStatus: DisputeStatus | undefined;
  /** Optional client-side filter applied on top (multi-status buckets). */
  clientPredicate?: (r: ConsumerDisputeAdminRead) => boolean;
};

const FILTERS: Filter[] = [
  {
    key: "OPEN_BUCKET",
    label: "Open",
    apiStatus: undefined,
    clientPredicate: (r) =>
      (DISPUTE_OPEN_STATUSES as readonly string[]).includes(r.status),
  },
  { key: "OPEN", label: "New", apiStatus: "OPEN" },
  {
    key: "OWNER_RECONCILING",
    label: "Awaiting owner",
    apiStatus: "OWNER_RECONCILING",
  },
  {
    key: "ADMIN_REVIEWING",
    label: "Reviewing",
    apiStatus: "ADMIN_REVIEWING",
  },
  { key: "RESOLVED_UPHELD", label: "Upheld", apiStatus: "RESOLVED_UPHELD" },
  {
    key: "RESOLVED_DISMISSED",
    label: "Dismissed",
    apiStatus: "RESOLVED_DISMISSED",
  },
  { key: "WITHDRAWN", label: "Withdrawn", apiStatus: "WITHDRAWN" },
  { key: "ALL", label: "All", apiStatus: undefined },
];

function formatRelative(iso: string | null) {
  if (!iso) return "—";
  try {
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    const mins = Math.round(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function truncate(s: string | null | undefined, n = 80): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default function DisputesPage() {
  const [filterKey, setFilterKey] = React.useState<FilterKey>("OPEN_BUCKET");
  const filter = FILTERS.find((f) => f.key === filterKey)!;

  const { data, isLoading, error } = useAdminDisputes({
    status: filter.apiStatus,
  });

  const rows = React.useMemo(() => {
    const base = data ?? [];
    return filter.clientPredicate ? base.filter(filter.clientPredicate) : base;
  }, [data, filter]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Disputes</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Review consumer reports that a place&apos;s halal profile is
          wrong. Resolving uphold or dismiss clears the place&apos;s
          DISPUTED badge once no other active disputes remain.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 border-b pb-3">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={filterKey === f.key ? "default" : "ghost"}
            size="sm"
            onClick={() => setFilterKey(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {error && <ErrorState error={error as Error} />}

      {isLoading && <LoadingState />}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState filterLabel={filter.label} />
      )}

      {!isLoading && !error && rows.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Place</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="max-w-[320px]">Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Filed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/places/${row.place_id}`}
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                      title={row.place_id}
                    >
                      {row.place_id.slice(0, 8)}…
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/disputes/${row.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {disputedAttributeLabel(row.disputed_attribute)}
                    </Link>
                  </TableCell>
                  <TableCell
                    className="max-w-[320px] text-sm text-muted-foreground"
                    title={row.description}
                  >
                    {truncate(row.description) || (
                      <span className="italic">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DisputeStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatRelative(row.submitted_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

function EmptyState({ filterLabel }: { filterLabel: string }) {
  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <p className="text-sm text-muted-foreground">
        No disputes match the {filterLabel.toLowerCase()} filter.
      </p>
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  const hint =
    error.message === "Failed to fetch"
      ? "Check that trusthalal-api is running and CORS allows http://localhost:3001."
      : isApi && error.status === 401
        ? "Your session expired. Sign out and sign in again."
        : isApi && error.status === 403
          ? "Your account doesn't have admin access to this resource."
          : null;

  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p className="font-medium">
        Failed to load disputes
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}
