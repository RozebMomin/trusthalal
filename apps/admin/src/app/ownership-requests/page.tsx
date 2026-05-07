"use client";

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
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
  type OwnershipRequestAdminRead,
  useOwnershipRequests,
} from "@/lib/api/hooks";

import { ApproveDialog } from "./_components/approve-dialog";
import { CreateRequestDialog } from "./_components/create-request-dialog";
import { RejectDialog } from "./_components/reject-dialog";
import { RequestDetailDialog } from "./_components/request-detail-dialog";
import { RequestEvidenceDialog } from "./_components/request-evidence-dialog";
import {
  OPEN_STATUSES,
  StatusBadge,
  TERMINAL_STATUSES,
} from "./_components/status-badge";

type FilterKey = "OPEN" | "ALL" | (typeof OPEN_STATUSES)[number] | (typeof TERMINAL_STATUSES)[number];

type Filter = {
  key: FilterKey;
  label: string;
  /** Passed to the API as ?status=...; undefined = no filter */
  apiStatus: string | undefined;
  /** Optional client-side filter applied on top (e.g. to show multi-status buckets) */
  clientPredicate?: (r: OwnershipRequestAdminRead) => boolean;
};

const FILTERS: Filter[] = [
  {
    key: "OPEN",
    label: "Open",
    apiStatus: undefined,
    clientPredicate: (r) =>
      (OPEN_STATUSES as readonly string[]).includes(r.status),
  },
  { key: "SUBMITTED", label: "Submitted", apiStatus: "SUBMITTED" },
  { key: "UNDER_REVIEW", label: "Under review", apiStatus: "UNDER_REVIEW" },
  {
    key: "NEEDS_EVIDENCE",
    label: "Needs evidence",
    apiStatus: "NEEDS_EVIDENCE",
  },
  { key: "APPROVED", label: "Approved", apiStatus: "APPROVED" },
  { key: "REJECTED", label: "Rejected", apiStatus: "REJECTED" },
  { key: "ALL", label: "All", apiStatus: undefined },
];

function formatRelative(iso: string) {
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

function truncate(s: string | null | undefined, n = 60): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default function OwnershipRequestsPage() {
  const [filterKey, setFilterKey] = React.useState<FilterKey>("OPEN");
  const filter = FILTERS.find((f) => f.key === filterKey)!;
  const [createOpen, setCreateOpen] = React.useState(false);

  const { data, isLoading, error } = useOwnershipRequests({
    status: filter.apiStatus,
  });

  const rows = React.useMemo(() => {
    const base = data ?? [];
    return filter.clientPredicate ? base.filter(filter.clientPredicate) : base;
  }, [data, filter]);

  // Row-level dialog state. `undefined` == closed.
  const [detailTarget, setDetailTarget] = React.useState<
    OwnershipRequestAdminRead | undefined
  >();
  const [approveTarget, setApproveTarget] = React.useState<
    OwnershipRequestAdminRead | undefined
  >();
  const [rejectTarget, setRejectTarget] = React.useState<
    OwnershipRequestAdminRead | undefined
  >();
  const [evidenceTarget, setEvidenceTarget] = React.useState<
    OwnershipRequestAdminRead | undefined
  >();

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Ownership requests
          </h1>
          <p className="mt-2 text-muted-foreground">
            Review merchant-submitted claim-this-place requests.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          Create ownership request
        </Button>
      </header>

      <CreateRequestDialog open={createOpen} onOpenChange={setCreateOpen} />

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
                <TableHead>Contact</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Place</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const terminal = (
                  TERMINAL_STATUSES as readonly string[]
                ).includes(row.status);
                return (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setDetailTarget(row)}
                  >
                    <TableCell>
                      <div className="font-medium">{row.contact_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.contact_email}
                      </div>
                    </TableCell>
                    <TableCell
                      className="max-w-[280px] text-sm text-muted-foreground"
                      title={row.message ?? undefined}
                    >
                      {truncate(row.message) || (
                        <span className="italic">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      {/* Place name + a thin address line so staff
                          can disambiguate two same-named venues
                          across cities. Falls back to the UUID
                          chip only on the (defensive) case where
                          the embedded summary somehow didn't load. */}
                      <Link
                        href={`/places/${row.place.id}`}
                        className="font-medium text-primary hover:underline"
                        title={row.place.name}
                      >
                        {row.place.name}
                      </Link>
                      {(row.place.city || row.place.region) && (
                        <div className="truncate text-xs text-muted-foreground">
                          {[row.place.city, row.place.region]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatRelative(row.created_at)}
                    </TableCell>
                    <TableCell
                      className="space-x-2 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={terminal}
                        onClick={() => setEvidenceTarget(row)}
                      >
                        Evidence
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={terminal}
                        onClick={() => setRejectTarget(row)}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={terminal}
                        onClick={() => setApproveTarget(row)}
                      >
                        Approve
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {detailTarget && (
        <RequestDetailDialog
          request={detailTarget}
          open
          onOpenChange={(open) => !open && setDetailTarget(undefined)}
        />
      )}
      {approveTarget && (
        <ApproveDialog
          request={approveTarget}
          open
          onOpenChange={(open) => !open && setApproveTarget(undefined)}
        />
      )}
      {rejectTarget && (
        <RejectDialog
          request={rejectTarget}
          open
          onOpenChange={(open) => !open && setRejectTarget(undefined)}
        />
      )}
      {evidenceTarget && (
        <RequestEvidenceDialog
          request={evidenceTarget}
          open
          onOpenChange={(open) => !open && setEvidenceTarget(undefined)}
        />
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
        No ownership requests match the {filterLabel.toLowerCase()} filter.
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
        Failed to load ownership requests
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}
