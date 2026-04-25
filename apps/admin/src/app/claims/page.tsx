"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
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
  type ClaimAdminRead,
  useAdminClaims,
  useCurrentUser,
} from "@/lib/api/hooks";

import {
  ClaimActionDialog,
  type ClaimAction,
} from "./_components/claim-action-dialog";
import { ClaimDetailDialog } from "./_components/claim-detail-dialog";
import {
  ClaimStatusBadge,
  OPEN_CLAIM_STATUSES,
  TERMINAL_CLAIM_STATUSES,
  claimScopeLabel,
  claimTypeLabel,
} from "./_components/status-badge";

type FilterKey =
  | "OPEN"
  | "ALL"
  | "PENDING"
  | "VERIFIED"
  | "REJECTED"
  | "EXPIRED"
  | "DISPUTED";

type Filter = {
  key: FilterKey;
  label: string;
  apiStatus: string | undefined;
  clientPredicate?: (r: ClaimAdminRead) => boolean;
};

const FILTERS: Filter[] = [
  {
    key: "OPEN",
    label: "Open",
    apiStatus: undefined,
    clientPredicate: (r) =>
      (OPEN_CLAIM_STATUSES as readonly string[]).includes(r.status),
  },
  { key: "PENDING", label: "Pending", apiStatus: "PENDING" },
  { key: "VERIFIED", label: "Verified", apiStatus: "VERIFIED" },
  { key: "DISPUTED", label: "Disputed", apiStatus: "DISPUTED" },
  { key: "REJECTED", label: "Rejected", apiStatus: "REJECTED" },
  { key: "EXPIRED", label: "Expired", apiStatus: "EXPIRED" },
  { key: "ALL", label: "All", apiStatus: undefined },
];

function formatRelative(iso: string): string {
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

/** Days until `iso` — negative means already expired. */
function daysUntil(iso: string): number {
  const then = new Date(iso).getTime();
  return Math.round((then - Date.now()) / 86_400_000);
}

// Next.js 14 requires `useSearchParams()` to sit inside a Suspense boundary
// so the page can still be statically rendered. The inner component below
// reads the hook; the default export wraps it.
export default function ClaimsPage() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <ClaimsPageInner />
    </React.Suspense>
  );
}

function ClaimsPageInner() {
  // Deep-link support: `/claims?focus=<claim-id>` auto-opens the detail
  // dialog. We also force the filter to "All" when landing with a focus so
  // terminal claims (REJECTED/EXPIRED/VERIFIED) aren't hidden behind the
  // dialog by the default "Open" filter.
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");

  const [filterKey, setFilterKey] = React.useState<FilterKey>(
    focusId ? "ALL" : "OPEN",
  );
  const filter = FILTERS.find((f) => f.key === filterKey)!;

  const { data, isLoading, error } = useAdminClaims({
    status: filter.apiStatus,
  });

  // Verify/reject/expire are ADMIN-only on the server. Verifiers can
  // read the queue + detail + event history, but the moderation
  // actions route through a different (public) endpoint meant for
  // their role. Until that wiring exists on the admin panel too,
  // verifiers see the queue read-only; hiding the buttons prevents
  // them from clicking into a 403.
  const { data: me } = useCurrentUser();
  const canModerate = me?.role === "ADMIN";

  const rows = React.useMemo(() => {
    const base = data ?? [];
    return filter.clientPredicate ? base.filter(filter.clientPredicate) : base;
  }, [data, filter]);

  // Row-level dialog state. `undefined` == closed.
  const [detailTarget, setDetailTarget] = React.useState<
    ClaimAdminRead | undefined
  >();
  const [actionTarget, setActionTarget] = React.useState<
    { claim: ClaimAdminRead; action: ClaimAction } | undefined
  >();

  // Open the detail dialog once per page mount when `focus=` matches a row.
  // The ref guard prevents re-opening after the user closes the dialog.
  const focusHandled = React.useRef(false);
  React.useEffect(() => {
    if (!focusId || focusHandled.current || !data) return;
    const target = data.find((c) => c.id === focusId);
    if (target) {
      setDetailTarget(target);
      focusHandled.current = true;
    }
  }, [focusId, data]);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Claims</h1>
          <p className="mt-2 text-muted-foreground">
            {canModerate
              ? "Moderate halal claims: verify, reject, or force-expire with an audit reason."
              : "Browse halal claims and their event history. Moderation actions are admin-only."}
          </p>
        </div>
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
                <TableHead>Type</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Place</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Submitted</TableHead>
                {canModerate && (
                  <TableHead className="text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const terminal = (
                  TERMINAL_CLAIM_STATUSES as readonly string[]
                ).includes(row.status);
                const d = daysUntil(row.expires_at);
                return (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setDetailTarget(row)}
                  >
                    <TableCell className="font-medium">
                      {claimTypeLabel(row.claim_type)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {claimScopeLabel(row.scope)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/places/${row.place_id}`}
                        className="font-mono text-xs text-primary hover:underline"
                        title={row.place_id}
                      >
                        {row.place_id.slice(0, 8)}…
                      </Link>
                    </TableCell>
                    <TableCell>
                      <ClaimStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.evidence_count > 0 ? "secondary" : "outline"}
                      >
                        {row.evidence_count}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {d < 0 ? `${-d}d ago` : `in ${d}d`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatRelative(row.created_at)}
                    </TableCell>
                    {canModerate && (
                      <TableCell
                        className="space-x-2 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={terminal}
                          onClick={() =>
                            setActionTarget({ claim: row, action: "expire" })
                          }
                        >
                          Expire
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={terminal}
                          onClick={() =>
                            setActionTarget({ claim: row, action: "reject" })
                          }
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          disabled={terminal || row.status === "VERIFIED"}
                          onClick={() =>
                            setActionTarget({ claim: row, action: "verify" })
                          }
                        >
                          Verify
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {detailTarget && (
        <ClaimDetailDialog
          claim={detailTarget}
          open
          onOpenChange={(open) => !open && setDetailTarget(undefined)}
        />
      )}
      {actionTarget && (
        <ClaimActionDialog
          claim={actionTarget.claim}
          action={actionTarget.action}
          open
          onOpenChange={(open) => !open && setActionTarget(undefined)}
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
        No claims match the {filterLabel.toLowerCase()} filter.
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
        Failed to load claims
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}
