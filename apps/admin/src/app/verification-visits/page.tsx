"use client";

/**
 * Admin queue for verification-visit review.
 *
 * Lands on SUBMITTED — the "waiting on me" bucket — and lets admin
 * filter through the rest of the lifecycle for auditing. Per-row click
 * goes to /verification-visits/[id], the detail page where the full
 * visit renders and the Accept / Reject decision dialogs live.
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
import { VerificationVisitStatusBadge } from "./_components/verification-visit-status-badge";
import { ApiError } from "@/lib/api/client";
import {
  type VerificationVisitStatus,
  useVerificationVisits,
} from "@/lib/api/hooks";

type FilterKey =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN"
  | "ALL";

type Filter = {
  key: FilterKey;
  label: string;
  /** Passed to the API as ?status=...; undefined = no server filter. */
  apiStatus: VerificationVisitStatus | undefined;
};

const FILTERS: Filter[] = [
  { key: "SUBMITTED", label: "Submitted", apiStatus: "SUBMITTED" },
  { key: "UNDER_REVIEW", label: "Under review", apiStatus: "UNDER_REVIEW" },
  { key: "ACCEPTED", label: "Accepted", apiStatus: "ACCEPTED" },
  { key: "REJECTED", label: "Rejected", apiStatus: "REJECTED" },
  { key: "WITHDRAWN", label: "Withdrawn", apiStatus: "WITHDRAWN" },
  { key: "ALL", label: "All", apiStatus: undefined },
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  } catch {
    return iso;
  }
}

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

function placeLocation(city: string | null, region: string | null): string {
  return [city, region].filter(Boolean).join(", ");
}

export default function VerificationVisitsPage() {
  const [filterKey, setFilterKey] = React.useState<FilterKey>("SUBMITTED");
  const filter = FILTERS.find((f) => f.key === filterKey)!;

  const { data, isLoading, error } = useVerificationVisits(filter.apiStatus);

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Verification visits
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Review verification visits filed by Trust Halal verifiers.
          Accepting a visit reflects it on the place&apos;s halal profile.
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
                <TableHead>Visited</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const location = placeLocation(
                  row.place?.city ?? null,
                  row.place?.region ?? null,
                );
                return (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[320px]">
                      <Link
                        href={`/verification-visits/${row.id}`}
                        className="block font-medium hover:underline"
                      >
                        {row.place?.name ?? "Unknown place"}
                      </Link>
                      {location && (
                        <p className="truncate text-xs text-muted-foreground">
                          {location}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(row.visited_at)}
                    </TableCell>
                    <TableCell>
                      <VerificationVisitStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatRelative(row.submitted_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
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
        No verification visits match the {filterLabel.toLowerCase()} filter.
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
        Failed to load verification visits
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}
