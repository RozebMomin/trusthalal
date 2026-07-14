"use client";

/**
 * Admin queue for verifier-application review.
 *
 * Lands on PENDING — the "waiting on me" bucket — and lets admin filter
 * through the rest of the lifecycle for auditing. Per-row click goes to
 * /verifier-applications/[id], the detail page where the full
 * application renders and the Approve / Reject decision dialogs live.
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
import { VerifierApplicationStatusBadge } from "./_components/verifier-application-status-badge";
import { ApiError } from "@/lib/api/client";
import {
  type VerifierApplicationStatus,
  useVerifierApplications,
} from "@/lib/api/hooks";

type FilterKey = "PENDING" | "ALL" | "APPROVED" | "REJECTED" | "WITHDRAWN";

type Filter = {
  key: FilterKey;
  label: string;
  /** Passed to the API as ?status=...; undefined = no server filter. */
  apiStatus: VerifierApplicationStatus | undefined;
};

const FILTERS: Filter[] = [
  { key: "PENDING", label: "Pending", apiStatus: "PENDING" },
  { key: "APPROVED", label: "Approved", apiStatus: "APPROVED" },
  { key: "REJECTED", label: "Rejected", apiStatus: "REJECTED" },
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

function truncate(s: string | null | undefined, n = 90): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default function VerifierApplicationsPage() {
  const [filterKey, setFilterKey] = React.useState<FilterKey>("PENDING");
  const filter = FILTERS.find((f) => f.key === filterKey)!;

  const { data, isLoading, error } = useVerifierApplications({
    status: filter.apiStatus,
  });

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Verifier applications
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Review people applying to become Trust Halal verifiers.
          Approving an application provisions the applicant&apos;s
          verifier profile.
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
                <TableHead>Applicant</TableHead>
                <TableHead className="max-w-[360px]">Motivation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[280px]">
                    <Link
                      href={`/verifier-applications/${row.id}`}
                      className="block font-medium hover:underline"
                    >
                      {row.applicant_name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.applicant_email}
                    </p>
                  </TableCell>
                  <TableCell
                    className="max-w-[360px] text-sm text-muted-foreground"
                    title={row.motivation}
                  >
                    {truncate(row.motivation) || (
                      <span className="italic">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <VerifierApplicationStatusBadge status={row.status} />
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
        No verifier applications match the {filterLabel.toLowerCase()} filter.
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
        Failed to load verifier applications
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}
