"use client";

/**
 * Verifier dashboard — the home surface after login.
 *
 * Two things at a glance:
 *   1. Your profile status card (are you set up? is your bio done?
 *      is your handle visible on your public page?)
 *   2. Your recent visits (SUBMITTED / UNDER_REVIEW / ACCEPTED /
 *      REJECTED / WITHDRAWN), with quick links to detail views.
 *
 * Primary CTA: "Submit a new visit" — the action verifiers came
 * here to take.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type VerificationVisitStatus,
  useCurrentUser,
  useMyVerificationVisits,
  useVerifierProfile,
} from "@/lib/api/hooks";

export default function VerifierDashboardPage() {
  const { data: me } = useCurrentUser();
  const { data: profile } = useVerifierProfile();
  const { data: visits, isLoading, error } = useMyVerificationVisits();

  const firstName =
    me?.display_name?.split(" ")[0] ?? me?.email?.split("@")[0] ?? "verifier";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="mb-2 tracking-tight text-3xl font-semibold sm:text-4xl">
          Welcome back, {firstName}.
        </h1>
        <p className="text-muted-foreground">
          Your verifier dashboard. Submit visits, update your profile,
          and see how your work is landing.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/verifier/visits/new">Submit a new visit</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/verifier/profile">Edit your profile</Link>
        </Button>
      </div>

      <ProfileStatusCard profile={profile ?? null} />

      <BadgeCard hasPublicHandle={Boolean(profile?.public_handle)} />


      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="tracking-tight text-2xl font-semibold">
            Your recent visits
          </h2>
        </div>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
          >
            Couldn&apos;t load your visits. Refresh the page or try again
            in a moment.
          </p>
        )}

        {visits && visits.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-8 text-center">
            <p className="mb-3 text-muted-foreground">
              You haven&apos;t submitted a visit yet.
            </p>
            <Button asChild>
              <Link href="/verifier/visits/new">Submit your first visit</Link>
            </Button>
          </div>
        )}

        {visits && visits.length > 0 && (
          <ul className="space-y-2">
            {visits.map((visit) => (
              <li
                key={visit.id}
                className="rounded-md border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      Visit on{" "}
                      {new Date(visit.visited_at).toLocaleDateString(
                        undefined,
                        {
                          dateStyle: "medium",
                        },
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Submitted{" "}
                      {new Date(visit.submitted_at).toLocaleDateString(
                        undefined,
                        { dateStyle: "medium" },
                      )}{" "}
                      &middot; Disclosure:{" "}
                      {formatDisclosure(visit.disclosure)}
                    </p>
                  </div>
                  <VisitStatusBadge status={visit.status} />
                </div>
                {visit.notes_for_admin && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    &ldquo;{visit.notes_for_admin}&rdquo;
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ProfileStatusCard({
  profile,
}: {
  profile: {
    public_handle: string | null;
    bio: string | null;
    is_public: boolean;
  } | null;
}) {
  if (!profile) return null;

  const missingHandle = !profile.public_handle;
  const missingBio = !profile.bio;
  const notPublic = !profile.is_public;

  const complete = !missingHandle && !missingBio && !notPublic;

  return (
    <section
      className={`rounded-lg border p-6 ${
        complete
          ? "border-primary/30 bg-primary/5"
          : "border-amber-500/40 bg-amber-50/60"
      }`}
    >
      <h2 className="mb-2 tracking-tight text-lg font-semibold">
        {complete ? "Your public profile is live" : "Finish your public profile"}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {complete
          ? "Your handle, bio, and visits are visible to anyone who visits your verifier page. You can link to it from your Instagram bio or blog."
          : "A public profile makes your work visible and gives you something to link from your Instagram bio, blog, and community shares. Two minutes to finish."}
      </p>
      {!complete && (
        <ul className="mb-4 space-y-1 text-sm text-muted-foreground">
          {missingHandle && (
            <li>&mdash; Pick a public handle (e.g. your name or IG handle)</li>
          )}
          {missingBio && <li>&mdash; Add a short bio</li>}
          {notPublic && <li>&mdash; Turn on public visibility</li>}
        </ul>
      )}
      <Button asChild variant={complete ? "outline" : "default"} size="sm">
        <Link href="/verifier/profile">
          {complete ? "Edit your profile" : "Finish setting up"}
        </Link>
      </Button>
    </section>
  );
}

function BadgeCard({ hasPublicHandle }: { hasPublicHandle: boolean }) {
  // The verifier badge is the ambassador asset — the graphic they
  // put in their IG bio, YouTube description, blog footer.
  // Deep-link the "download" as a right-click hint; the actual SVG
  // sits at /verifier-badge.svg in the consumer app's public dir.
  return (
    <section className="mt-8 rounded-lg border border-border bg-card p-6">
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/verifier-badge.svg"
          alt="Trust Halal Verifier badge"
          width="120"
          height="120"
          className="shrink-0"
        />
        <div className="flex-1">
          <h2 className="mb-2 tracking-tight text-lg font-semibold">
            Your Trust Halal Verifier badge
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            The community-facing badge you can put in your Instagram
            bio, YouTube description, personal blog, or wherever your
            work lives. Right-click / long-press to save.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href="/verifier-badge.svg" download="trust-halal-verifier-badge.svg">
                Download badge
              </a>
            </Button>
            {hasPublicHandle && (
              <Button asChild size="sm" variant="ghost">
                <Link href="/verifier/profile">Copy your public link</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function VisitStatusBadge({ status }: { status: VerificationVisitStatus }) {
  const label = status.replaceAll("_", " ").toLowerCase();
  const classes: Record<VerificationVisitStatus, string> = {
    SUBMITTED: "border-sky-500/40 bg-sky-50 text-sky-900",
    UNDER_REVIEW: "border-amber-500/40 bg-amber-50 text-amber-900",
    ACCEPTED: "border-emerald-500/40 bg-emerald-50 text-emerald-900",
    REJECTED: "border-destructive/40 bg-destructive/5 text-destructive",
    WITHDRAWN: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${classes[status]}`}
    >
      {label}
    </span>
  );
}

function formatDisclosure(d: string): string {
  switch (d) {
    case "SELF_FUNDED":
      return "self-funded";
    case "MEAL_COMPED":
      return "meal comped";
    case "PAID_PARTNERSHIP":
      return "paid partnership";
    case "OTHER_DISCLOSURE":
      return "other";
    default:
      return d.toLowerCase();
  }
}
