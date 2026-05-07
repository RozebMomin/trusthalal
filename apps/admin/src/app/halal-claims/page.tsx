"use client";

/**
 * Admin queue for halal-claim review.
 *
 * Phase 6 of the halal-trust v2 rebuild. Lands on PENDING_REVIEW —
 * the "waiting on me" bucket — and lets admin filter through the
 * other lifecycle states for auditing or for picking up
 * NEEDS_MORE_INFO claims an owner re-submitted.
 *
 * Per-row click goes to /halal-claims/[id], the detail page where
 * the questionnaire renders, attachments are viewable, and the four
 * decision dialogs (Approve / Reject / Request more info / Revoke)
 * live. Listing the action buttons inline on the queue would crowd
 * the table and force admins into half-formed decisions; the
 * detail page is where the actual review happens.
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
import { HalalClaimStatusBadge } from "@/components/halal-claim-status-badge";
import { ApiError } from "@/lib/api/client";
import {
  HALAL_CLAIM_OPEN_STATUSES,
  type HalalClaimAdminRead,
  type HalalClaimStatus,
  useAdminHalalClaims,
} from "@/lib/api/hooks";

type FilterKey =
  | "OPEN"
  | "ALL"
  | "PENDING_REVIEW"
  | "NEEDS_MORE_INFO"
  | "APPROVED"
  | "REJECTED"
  | "REVOKED"
  | "EXPIRED"
  | "SUPERSEDED";

type Filter = {
  key: FilterKey;
  label: string;
  /** Passed to the API as ?status=...; undefined = no filter. */
  apiStatus: HalalClaimStatus | undefined;
  /** Optional client-side filter applied on top (multi-status buckets). */
  clientPredicate?: (r: HalalClaimAdminRead) => boolean;
};

const FILTERS: Filter[] = [
  {
    key: "OPEN",
    label: "Open",
    apiStatus: undefined,
    clientPredicate: (r) =>
      (HALAL_CLAIM_OPEN_STATUSES as readonly string[]).includes(r.status),
  },
  { key: "PENDING_REVIEW", label: "Pending review", apiStatus: "PENDING_REVIEW" },
  {
    key: "NEEDS_MORE_INFO",
    label: "Needs more info",
    apiStatus: "NEEDS_MORE_INFO",
  },
  { key: "APPROVED", label: "Approved", apiStatus: "APPROVED" },
  { key: "REJECTED", label: "Rejected", apiStatus: "REJECTED" },
  { key: "REVOKED", label: "Revoked", apiStatus: "REVOKED" },
  { key: "EXPIRED", label: "Expired", apiStatus: "EXPIRED" },
  { key: "SUPERSEDED", label: "Superseded", apiStatus: "SUPERSEDED" },
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

function placeAddressLine(claim: HalalClaimAdminRead): string {
  if (!claim.place) return "";
  return [claim.place.address, claim.place.city, claim.place.country_code]
    .filter(Boolean)
    .join(" · ");
}

export default function HalalClaimsPage() {
  const [filterKey, setFilterKey] = React.useState<FilterKey>("OPEN");
  const filter = FILTERS.find((f) => f.key === filterKey)!;

  const { data, isLoading, error } = useAdminHalalClaims({
    status: filter.apiStatus,
  });

  const rows = React.useMemo(() => {
    const base = data ?? [];
    return filter.clientPredicate ? base.filter(filter.clientPredicate) : base;
  }, [data, filter]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Halal claims</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Review owner-submitted halal-posture verifications. Approving
          a claim updates the place&apos;s consumer-facing halal profile.
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
                <TableHead>Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Last update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const addressLine = placeAddressLine(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[280px]">
                      <Link
                        href={`/halal-claims/${row.id}`}
                        className="block font-medium hover:underline"
                      >
                        {row.place?.name ?? "Unknown place"}
                      </Link>
                      {addressLine && (
                        <p className="truncate text-xs text-muted-foreground">
                          {addressLine}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.organization ? (
                        <Link
                          href={`/organizations/${row.organization.id}`}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.organization.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <HalalClaimStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
                      {row.claim_type}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatRelative(row.submitted_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatRelative(row.updated_at)}
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
        No halal claims match the {filterLabel.toLowerCase()} filter.
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
        Failed to load halal claims
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}
