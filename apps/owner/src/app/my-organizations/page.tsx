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
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { OrgStatusBadge, orgStatusDescription } from "@/components/org-status-badge";
import {
  type MyOrganizationRead,
  useMyOrganizations,
} from "@/lib/api/hooks";

export default function MyOrganizationsPage() {
  const { data, isLoading, isError } = useMyOrganizations();
  // Memoize so the ``orgs ?? []`` substitution doesn't allocate a
  // fresh array literal on every render — the downstream useMemo
  // for ``verifiedOrgs`` depends on a stable reference.
  const orgs = React.useMemo(() => data ?? [], [data]);

  // Default-filter to the VERIFIED bucket when the owner has any
  // verified orgs — that's "the orgs you can actually file claims
  // under." DRAFT / UNDER_REVIEW / REJECTED are still reachable
  // via the toggle so the owner can pick up an in-flight submission
  // or revisit a rejection. When the owner has no verified orgs we
  // default to "All" instead so the page isn't empty out of the box.
  const verifiedOrgs = React.useMemo(
    () => orgs.filter((o) => o.status === "VERIFIED"),
    [orgs],
  );
  const hasVerified = verifiedOrgs.length > 0;
  const [showAll, setShowAll] = React.useState(false);

  // Initial show-all flips to true when the user has zero verified
  // orgs; flips back to false once at least one verified row lands.
  // A ref keeps the latest "did the user click toggle?" state so we
  // don't fight their explicit choice.
  const userToggledRef = React.useRef(false);
  React.useEffect(() => {
    if (!userToggledRef.current) {
      setShowAll(!hasVerified);
    }
  }, [hasVerified]);

  function onToggle(next: boolean) {
    userToggledRef.current = true;
    setShowAll(next);
  }

  const visibleOrgs = showAll ? orgs : verifiedOrgs;

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

      {/* Filter chips. Hidden when the user has no orgs at all —
          there's nothing to filter on a fresh account. */}
      {!isLoading && !isError && orgs.length > 0 && hasVerified && (
        <div className="flex items-center gap-2 border-b pb-3">
          <Button
            variant={showAll ? "ghost" : "default"}
            size="sm"
            onClick={() => onToggle(false)}
          >
            Verified
            <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 text-[10px] font-medium">
              {verifiedOrgs.length}
            </span>
          </Button>
          <Button
            variant={showAll ? "default" : "ghost"}
            size="sm"
            onClick={() => onToggle(true)}
          >
            All
            <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 text-[10px] font-medium">
              {orgs.length}
            </span>
          </Button>
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
        <FilterEmptyState onShowAll={() => onToggle(true)} />
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

function FilterEmptyState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="rounded-md border border-dashed bg-card px-6 py-8 text-center text-sm text-muted-foreground">
      <p>No verified organizations yet.</p>
      <button
        type="button"
        onClick={onShowAll}
        className="mt-2 text-xs underline-offset-4 hover:underline"
      >
        Show all organizations
      </button>
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
