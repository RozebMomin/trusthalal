"use client";

/**
 * Admin organization detail (read + decide).
 *
 * Read-only audit surface for org review. Owners create + edit the
 * org and manage their team in the owner portal; admin reads what
 * they submitted, looks at the supporting attachments, and either
 * verifies or rejects. Members are visible (badge-rendered) so a
 * reviewer can see who's running the org, but admin can't add or
 * remove them from here.
 *
 * The two decision surfaces (Verify / Reject) live in the
 * VerificationSection and only act on UNDER_REVIEW orgs. Already-
 * VERIFIED or REJECTED orgs render the badge and history without
 * action buttons.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  type OrganizationAdminRead,
  type OrganizationDetailRead,
  type OrganizationMemberAdminRead,
  type OrganizationPlaceOwnerRead,
  useAdminOrganization,
  useAdminOrgPlaces,
} from "@/lib/api/hooks";

import {
  MemberRoleBadge,
  MemberStatusBadge,
} from "../_components/member-badges";
import { OrgEvidenceSection } from "../_components/org-evidence-section";
import { OrgStatusBadge } from "../_components/org-status-badge";
import { RejectOrgDialog } from "../_components/reject-org-dialog";
import { VerifyOrgDialog } from "../_components/verify-org-dialog";

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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/**
 * Multi-line address renderer that handles "every field is null"
 * gracefully (older rows don't have address data on file). Splits
 * "city, region postal_code" / country onto its own line for
 * readability.
 */
function OrgAddressView({
  org,
}: {
  org: OrganizationAdminRead | OrganizationDetailRead;
}) {
  const street = org.address;
  const localityParts = [
    org.city,
    [org.region, org.postal_code].filter(Boolean).join(" "),
  ].filter(Boolean);
  const country = org.country_code;

  if (!street && localityParts.length === 0 && !country) {
    return (
      <span className="italic text-muted-foreground">
        no address on file
      </span>
    );
  }

  return (
    <div className="space-y-0.5">
      {street && <div>{street}</div>}
      {localityParts.length > 0 && <div>{localityParts.join(", ")}</div>}
      {country && (
        <div className="text-xs text-muted-foreground">{country}</div>
      )}
    </div>
  );
}

export default function OrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: org, isLoading, error } = useAdminOrganization(id);
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/organizations"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All organizations
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {isLoading ? <Skeleton className="h-8 w-64" /> : org?.name}
          </h1>
          {org?.status && <OrgStatusBadge status={org.status} />}
        </div>
        {org?.contact_email && (
          <p className="mt-1 text-muted-foreground">
            <a
              href={`mailto:${org.contact_email}`}
              className="hover:underline"
            >
              {org.contact_email}
            </a>
          </p>
        )}
        {org?.id && (
          <p
            className="mt-1 font-mono text-[11px] text-muted-foreground/70"
            title="Organization ID"
          >
            {org.id}
          </p>
        )}
      </header>

      {error && <ErrorState error={error as Error} />}

      {org && (
        <>
          <section className="rounded-md border p-4">
            <h2 className="mb-2 text-sm font-semibold">Details</h2>
            <dl className="divide-y">
              <Field label="Contact email">
                {org.contact_email || (
                  <span className="italic text-muted-foreground">
                    no contact email
                  </span>
                )}
              </Field>
              <Field label="Address">
                <OrgAddressView org={org} />
              </Field>
              <Field label="Created">{formatTimestamp(org.created_at)}</Field>
              <Field label="Last updated">
                {formatTimestamp(org.updated_at)}
              </Field>
            </dl>
          </section>

          <VerificationSection
            org={org}
            onVerify={() => setVerifyOpen(true)}
            onReject={() => setRejectOpen(true)}
          />

          <OrgEvidenceSection
            organizationId={org.id}
            attachments={org.attachments ?? []}
          />

          <MembersSection org={org} />
          <PlacesSection orgId={org.id} />
        </>
      )}

      {org && (
        <>
          <VerifyOrgDialog
            org={org}
            open={verifyOpen}
            onOpenChange={setVerifyOpen}
          />
          <RejectOrgDialog
            org={org}
            open={rejectOpen}
            onOpenChange={setRejectOpen}
          />
        </>
      )}
    </div>
  );
}

// Read-only members listing. Owners manage their team in the owner
// portal — the admin role for this section is "see who's running the
// org" while reviewing, not "edit the roster."
function MembersSection({
  org,
}: {
  org: OrganizationAdminRead & {
    members?: OrganizationMemberAdminRead[];
  };
}) {
  const members = org.members ?? [];
  // Sort active rows to the top so "who's actually running this today"
  // is visible without scrolling past historical removed members.
  const sorted = [...members].sort((a, b) => {
    const aActive = a.status.toUpperCase() === "ACTIVE" ? 0 : 1;
    const bActive = b.status.toUpperCase() === "ACTIVE" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.created_at.localeCompare(b.created_at);
  });
  const activeCount = sorted.filter(
    (m) => m.status.toUpperCase() === "ACTIVE",
  ).length;

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Members{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({activeCount} active)
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Members are managed by the owner in the owner portal.
        </span>
      </div>

      {sorted.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No members linked to this organization yet.
        </div>
      )}

      {sorted.length > 0 && (
        <ul className="space-y-3">
          {sorted.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberRow({ member }: { member: OrganizationMemberAdminRead }) {
  // Server-side now denormalizes display_name + email onto the
  // member row so we can render a human label without an extra
  // /admin/users/{id} round-trip. Falls back to the UUID prefix if
  // both are missing (legacy rows or a rare null).
  const label =
    member.user_display_name ||
    member.user_email ||
    `User ${member.user_id.slice(0, 8)}…`;
  return (
    <li className="rounded-md border p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/users/${member.user_id}`}
            className="font-medium hover:underline"
            title={member.user_email ?? member.user_id}
          >
            {label}
          </Link>
          {member.user_email && member.user_display_name && (
            <span className="text-xs text-muted-foreground">
              {member.user_email}
            </span>
          )}
          <MemberRoleBadge role={member.role} />
          <MemberStatusBadge status={member.status} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Added {formatTimestamp(member.created_at)}
        </p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Places owned by this org
// ---------------------------------------------------------------------------

/**
 * Lists PlaceOwner rows with the place nested inline. Server sorts
 * ACTIVE-first, then name-asc within a status group — this component
 * just renders the order it's handed.
 *
 * Management (link / unlink / revoke) happens on the place detail
 * page's Ownership section, not here. That keeps "where an org runs"
 * read-only from this angle and prevents two entry points from
 * fighting over the same PlaceOwner row. An admin who wants to revoke
 * clicks through to the place, which has the full dialog + audit
 * reason capture.
 */
function PlacesSection({ orgId }: { orgId: string }) {
  const { data, isLoading, error } = useAdminOrgPlaces(orgId);
  const rows = data ?? [];
  const activeCount = rows.filter(
    (r) => r.status.toUpperCase() === "ACTIVE",
  ).length;

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Places{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({activeCount} active)
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Manage ownership from each place&apos;s detail page.
        </span>
      </div>

      {isLoading && <Skeleton className="h-16 w-full" />}

      {error && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load places: {(error as Error).message}
        </p>
      )}

      {data && rows.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          This organization doesn&apos;t own any places yet. Places get
          linked when an ownership request for the org is approved, or
          via an admin action on the place detail page.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => (
            <OrgPlaceRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OrgPlaceRow({ row }: { row: OrganizationPlaceOwnerRead }) {
  const { place } = row;
  const isRevoked = row.status.toUpperCase() === "REVOKED";
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/places/${place.id}`}
              className={
                isRevoked || place.is_deleted
                  ? "font-medium text-muted-foreground hover:underline"
                  : "font-medium hover:underline"
              }
            >
              {place.name}
            </Link>
            <MemberRoleBadge role={row.role} />
            <MemberStatusBadge status={row.status} />
            {place.is_deleted && (
              <Badge variant="destructive" className="uppercase tracking-wide">
                Deleted
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {place.address ? (
              <>{place.address}</>
            ) : (
              <span className="italic">no address</span>
            )}
            {(place.city || place.country_code) && (
              <>
                {" · "}
                {[place.city, place.country_code].filter(Boolean).join(", ")}
              </>
            )}
            {" · linked "}
            {formatTimestamp(row.created_at)}
          </p>
        </div>
      </div>
    </li>
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
        Failed to load organization
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Verification — status-aware section with Verify/Reject actions
// ---------------------------------------------------------------------------

/**
 * Status-aware verification panel. Behavior per state:
 *
 *   * UNDER_REVIEW — submitted_at + Verify and Reject buttons.
 *   * VERIFIED / REJECTED — read-only summary with the deciding admin
 *     id, decision timestamp, and decision_note (the reason).
 *   * DRAFT — placeholder text noting the owner hasn't submitted yet.
 *
 * The Evidence section above this one is the actual document
 * viewer; this component just owns the decision metadata + the
 * Verify/Reject buttons that open the confirm dialogs.
 */
function VerificationSection({
  org,
  onVerify,
  onReject,
}: {
  org: OrganizationAdminRead;
  onVerify: () => void;
  onReject: () => void;
}) {
  if (org.status === "DRAFT") {
    return (
      <section className="rounded-md border p-4">
        <h2 className="mb-2 text-sm font-semibold">Verification</h2>
        <p className="text-sm text-muted-foreground">
          The owner hasn&apos;t submitted this organization for review
          yet. They can still upload supporting documents and finalize
          details on their portal.
        </p>
      </section>
    );
  }

  if (org.status === "UNDER_REVIEW") {
    return (
      <section className="rounded-md border border-blue-300 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Verification queue</h2>
          {org.submitted_at && (
            <span className="text-xs text-muted-foreground">
              Submitted {formatTimestamp(org.submitted_at)}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm">
          Review the supporting documents below, then verify or reject.
          Verifying makes this organization eligible to sponsor place
          claims; rejecting locks it as a read-only artifact and
          surfaces the reason to the owner.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={onVerify}>
            Verify
          </Button>
          <Button size="sm" variant="destructive" onClick={onReject}>
            Reject
          </Button>
        </div>
      </section>
    );
  }

  // VERIFIED / REJECTED — read-only audit summary.
  const decidedTone =
    org.status === "VERIFIED"
      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
      : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30";

  return (
    <section className={`rounded-md border p-4 ${decidedTone}`}>
      <h2 className="mb-2 text-sm font-semibold">Verification</h2>
      <dl className="divide-y">
        {org.submitted_at && (
          <Field label="Submitted">{formatTimestamp(org.submitted_at)}</Field>
        )}
        {org.decided_at && (
          <Field label="Decided">{formatTimestamp(org.decided_at)}</Field>
        )}
        {org.decided_by_user_id && (
          <Field label="Decided by">
            <Link
              href={`/users/${org.decided_by_user_id}`}
              className="font-mono text-xs hover:underline"
            >
              {org.decided_by_user_id.slice(0, 8)}…
            </Link>
          </Field>
        )}
        {org.decision_note && (
          <Field
            label={org.status === "REJECTED" ? "Reason" : "Note"}
          >
            <p className="whitespace-pre-wrap">{org.decision_note}</p>
          </Field>
        )}
      </dl>
    </section>
  );
}
