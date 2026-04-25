"use client";

/**
 * Admin users list.
 *
 * Search + role + active filter, click a row to navigate to detail,
 * Invite button at top-right. Same visual language as the /places list
 * so admins don't have to re-learn the shape.
 */

import Link from "next/link";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type UserAdminRead,
  type UserRole,
  useAdminUsers,
} from "@/lib/api/hooks";

import { InviteUserDialog } from "./_components/invite-user-dialog";
import { RoleBadge } from "./_components/role-badge";

// Radix Select can't hold an empty value, so the "All roles" option uses
// a sentinel we translate to ``undefined`` before calling the hook.
const ANY_ROLE = "__any__";

// "Active only" / "Inactive only" / "All" — three-state filter matching
// the boolean shape on the server (true / false / unset).
type ActiveFilter = "active" | "inactive" | "all";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function UsersPage() {
  const [rawQuery, setRawQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<string>(ANY_ROLE);
  const [activeFilter, setActiveFilter] =
    React.useState<ActiveFilter>("active");
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const query = useDebounced(rawQuery.trim(), 250);
  const effectiveRole =
    roleFilter === ANY_ROLE ? undefined : (roleFilter as UserRole);
  const effectiveIsActive =
    activeFilter === "all" ? undefined : activeFilter === "active";

  const { data, isLoading, error, isFetching } = useAdminUsers({
    q: query || undefined,
    role: effectiveRole,
    isActive: effectiveIsActive,
  });
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="mt-2 text-muted-foreground">
            Manage internal roles and audit actor history.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>Invite user</Button>
      </header>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      <div className="flex flex-wrap items-center gap-3 border-b pb-3">
        <div className="flex-1 min-w-[240px]">
          <Input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search email or display name"
          />
        </div>
        <div className="w-44">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger aria-label="Filter by role">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_ROLE}>All roles</SelectItem>
              <SelectItem value="CONSUMER">Consumer</SelectItem>
              <SelectItem value="OWNER">Owner</SelectItem>
              <SelectItem value="VERIFIER">Verifier</SelectItem>
              <SelectItem value="ADMIN">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={activeFilter === "active" ? "default" : "ghost"}
            onClick={() => setActiveFilter("active")}
          >
            Active only
          </Button>
          <Button
            size="sm"
            variant={activeFilter === "inactive" ? "default" : "ghost"}
            onClick={() => setActiveFilter("inactive")}
          >
            Inactive only
          </Button>
          <Button
            size="sm"
            variant={activeFilter === "all" ? "default" : "ghost"}
            onClick={() => setActiveFilter("all")}
          >
            All
          </Button>
        </div>
      </div>

      {error && <ErrorState error={error as Error} />}

      {isLoading && <LoadingState />}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          query={query}
          role={effectiveRole}
          isActive={effectiveIsActive}
        />
      )}

      {!isLoading && !error && rows.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>User id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <UserRow key={row.id} user={row} />
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

function UserRow({ user }: { user: UserAdminRead }) {
  return (
    <TableRow
      className={
        user.is_active
          ? "hover:bg-accent/50"
          : "bg-muted/30 text-muted-foreground hover:bg-accent/50"
      }
    >
      <TableCell className="font-medium">
        <Link
          href={`/users/${user.id}`}
          className={
            user.is_active
              ? "text-foreground hover:underline"
              : "text-muted-foreground hover:underline"
          }
        >
          {user.email}
        </Link>
      </TableCell>
      <TableCell className="text-sm">
        {user.display_name || (
          <span className="italic text-muted-foreground">&mdash;</span>
        )}
      </TableCell>
      <TableCell>
        <RoleBadge role={user.role} />
      </TableCell>
      <TableCell>
        {user.is_active ? (
          <Badge variant="default" className="uppercase tracking-wide">
            Active
          </Badge>
        ) : (
          <Badge variant="destructive" className="uppercase tracking-wide">
            Inactive
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs">{user.id.slice(0, 8)}…</code>
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

function EmptyState({
  query,
  role,
  isActive,
}: {
  query: string;
  role: UserRole | undefined;
  isActive: boolean | undefined;
}) {
  const parts: string[] = [];
  if (query) parts.push(`"${query}"`);
  if (role) parts.push(role);
  if (isActive === true) parts.push("active");
  if (isActive === false) parts.push("inactive");
  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <p className="text-sm text-muted-foreground">
        {parts.length > 0
          ? `No users match ${parts.join(" + ")}.`
          : "No users yet. Click Invite user to add one."}
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
        Failed to load users
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
    </div>
  );
}
