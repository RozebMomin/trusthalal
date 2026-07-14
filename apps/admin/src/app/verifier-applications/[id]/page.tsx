"use client";

/**
 * Verifier-application review detail page.
 *
 * Single-application surface where admin reads the applicant's
 * motivation + background, follows their social links, and runs one of
 * the two decision actions (Approve / Reject).
 *
 * The decision dialogs ride on the page-level ``action`` state which
 * doubles as "which dialog is open" and "should it render at all". Each
 * dialog invalidates the query cache on success, so the detail page
 * picks up the new status / timestamps without an extra round-trip.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";

import { VerifierApplicationStatusBadge } from "../_components/verifier-application-status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  type VerifierApplicationRead,
  useVerifierApplication,
} from "@/lib/api/hooks";

import { ApproveDialog } from "../_components/approve-dialog";
import { RejectDialog } from "../_components/reject-dialog";

type Action = "approve" | "reject" | null;

function formatTimestamp(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/**
 * Build an href for a social entry. Full URLs pass through; bare handles
 * on known platforms get expanded to their canonical profile URL.
 * Unknown platforms with a bare handle just render as text (no link).
 */
function socialHref(platform: string, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const handle = value.replace(/^@/, "");
  switch (platform.toLowerCase()) {
    case "instagram":
      return `https://instagram.com/${handle}`;
    case "tiktok":
      return `https://tiktok.com/@${handle}`;
    case "youtube":
      return `https://youtube.com/@${handle}`;
    case "twitter":
    case "x":
      return `https://x.com/${handle}`;
    case "website":
    case "site":
    case "url":
      return `https://${value.replace(/^\/\//, "")}`;
    default:
      return null;
  }
}

function socialEntries(
  links: VerifierApplicationRead["social_links"],
): Array<{ platform: string; value: string; href: string | null }> {
  if (!links) return [];
  return Object.entries(links)
    .filter(([, v]) => v != null && String(v).trim().length > 0)
    .map(([platform, v]) => {
      const value = String(v);
      return { platform, value, href: socialHref(platform, value) };
    });
}

export default function VerifierApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const applicationId = params?.id;
  const [action, setAction] = React.useState<Action>(null);

  const {
    data: application,
    isLoading,
    error,
  } = useVerifierApplication(applicationId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    const isApi = error instanceof ApiError;
    return (
      <div className="space-y-4">
        <BackLink />
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p className="font-medium">
            Couldn&apos;t load this application
            {isApi && ` (HTTP ${error.status})`}
          </p>
          <p className="mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">Application not found.</p>
      </div>
    );
  }

  const reviewable = application.status === "PENDING";
  const socials = socialEntries(application.social_links);

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Header */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {application.applicant_name}
          </h1>
          <VerifierApplicationStatusBadge status={application.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          <a
            href={`mailto:${application.applicant_email}`}
            className="hover:underline"
          >
            {application.applicant_email}
          </a>
        </p>
      </header>

      {/* Quick facts */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact
          label="Submitted"
          value={formatTimestamp(application.submitted_at) ?? "—"}
        />
        <Fact
          label="Decided"
          value={formatTimestamp(application.decided_at) ?? "—"}
        />
        <Fact
          label="Last updated"
          value={formatTimestamp(application.updated_at) ?? "—"}
        />
      </section>

      {/* Motivation */}
      <section className="rounded-md border bg-card p-4">
        <h3 className="text-sm font-semibold">Motivation</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm">
          {application.motivation}
        </p>
      </section>

      {/* Background */}
      {application.background && (
        <section className="rounded-md border bg-card p-4">
          <h3 className="text-sm font-semibold">Background</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {application.background}
          </p>
        </section>
      )}

      {/* Social links */}
      {socials.length > 0 && (
        <section className="rounded-md border bg-card p-4">
          <h3 className="text-sm font-semibold">Social links</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {socials.map((s) => (
              <li key={s.platform} className="flex flex-wrap gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {s.platform}
                </span>
                {s.href ? (
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-primary hover:underline"
                  >
                    {s.value}
                  </a>
                ) : (
                  <span className="break-all">{s.value}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Decision note (applicant-visible) */}
      {application.decision_note && (
        <section className="rounded-md border bg-card p-4">
          <h3 className="text-sm font-semibold">
            Decision note (applicant-visible)
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {application.decision_note}
          </p>
        </section>
      )}

      {/* Decision panel */}
      <section className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
        <p className="text-sm text-muted-foreground">
          {reviewable
            ? "Approve or reject this application."
            : `This application is ${application.status}; no further actions available.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {reviewable ? (
            <>
              <Button variant="outline" onClick={() => setAction("reject")}>
                Reject
              </Button>
              <Button onClick={() => setAction("approve")}>Approve</Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => router.push("/verifier-applications")}
            >
              Back to queue
            </Button>
          )}
        </div>
      </section>

      {/* Decision dialogs */}
      {action === "approve" && (
        <ApproveDialog
          application={application}
          open
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
      {action === "reject" && (
        <RejectDialog
          application={application}
          open
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/verifier-applications"
      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      ← All verifier applications
    </Link>
  );
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm">{value}</p>
    </div>
  );
}
