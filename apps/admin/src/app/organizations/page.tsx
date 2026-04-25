"use client";

/**
 * Admin organizations list.
 *
 * Simple "search + table" shape, same visual language as /places and
 * /users. Click a row to navigate to the org detail page where members
 * and (eventually) owned places live. The Create button opens the
 * dialog and routes straight to the new org's detail page on success.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
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

import { CreateOrganizationDialog } from "./_components/create-org-dialog";

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
  const [createOpen, setCreateOpen] = React.useState(false);
  const query = useDebounced(rawQuery.trim(), 250);

  const { data, isLoading, error, isFetching } = useAdminOrganizations({
    q: query || undefined,
  });
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
          <p className="mt-2 text-muted-foreground">
            Curate the org directory and manage memberships.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create organization</Button>
      </header>

      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <div className="flex flex-wrap items-center gap-3 border-b pb-3">
        <div className="flex-1 min-w-[240px]">
          <Input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search organization name"
          />
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
                <TableHead>Contact email</TableHead>
                <TableHead>Created</TableHead>
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
  return (
    <TableRow className="hover:bg-accent/50">
      <TableCell className="font-medium">
        <Link
          href={`/organizations/${org.id}`}
          className="text-foreground hover:underline"
        >
          {org.name}
        </Link>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {org.contact_email ? (
          <a href={`mailto:${org.contact_email}`} className="hover:underline">
            {org.contact_email}
          </a>
        ) : (
          <span className="italic">&mdash;</span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatTimestamp(org.created_at)}
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
