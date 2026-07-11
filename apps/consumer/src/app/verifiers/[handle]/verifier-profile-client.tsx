"use client";

/**
 * Public verifier profile — /verifiers/[handle]
 *
 * This is the ambassador page. Verifiers link to it from their
 * Instagram bio, YouTube description, personal blog. The point is
 * that a fellow community member can see who's behind a visit
 * report and decide for themselves whether to trust it.
 *
 * Shows:
 *   - Header with handle, "Trust Halal Verifier" identifier, join date
 *   - Bio (if provided)
 *   - Social links (if provided)
 *   - Headline count: "N visits verified"
 *   - Recent accepted visits with place, date, disclosure
 *
 * 404 handling: the backend returns 404 for private profiles OR
 * suspended/revoked verifiers OR non-existent handles. We render
 * the same friendly "not found" state for all three — no
 * existence-leaks.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type VisitDisclosure,
  type VerifierPublicVisitSummary,
  usePublicVerifierProfile,
} from "@/lib/api/hooks";

export function VerifierProfileClient({ handle }: { handle: string }) {
  const { data: profile, isLoading, error } = usePublicVerifierProfile(handle);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="mb-8 h-4 w-full" />
        <Skeleton className="h-32 w-full" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-muted-foreground">
          Couldn&apos;t load this verifier profile. Please try again.
        </p>
      </main>
    );
  }

  if (!profile) {
    return <NotFoundPage />;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <ProfileHeader profile={profile} />
      {profile.bio && <BioSection bio={profile.bio} />}
      <SocialLinks links={profile.social_links} />
      <VisitsSection
        visits={profile.recent_visits}
        totalAccepted={profile.total_accepted_visits}
      />
      <TrustFooter />
    </main>
  );
}

function ProfileHeader({
  profile,
}: {
  profile: {
    public_handle: string;
    joined_as_verifier_at: string;
    total_accepted_visits: number;
  };
}) {
  const joinedYear = new Date(profile.joined_as_verifier_at).getFullYear();

  return (
    <section className="mb-8 border-b border-border pb-8">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
        Trust Halal Verifier
      </p>
      <h1 className="mb-3 tracking-tight text-4xl font-semibold sm:text-5xl">
        @{profile.public_handle}
      </h1>
      <p className="text-muted-foreground">
        Verifying halal restaurants since {joinedYear} ·{" "}
        <strong className="text-foreground">
          {profile.total_accepted_visits}
        </strong>{" "}
        {profile.total_accepted_visits === 1 ? "visit" : "visits"} verified
      </p>
    </section>
  );
}

function BioSection({ bio }: { bio: string }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 tracking-tight text-xl font-semibold">About</h2>
      <p className="whitespace-pre-wrap text-base text-muted-foreground">
        {bio}
      </p>
    </section>
  );
}

function SocialLinks({
  links,
}: {
  links: Record<string, unknown> | null;
}) {
  if (!links || Object.keys(links).length === 0) return null;

  const entries: { key: string; label: string; href: string }[] = [];
  for (const [k, v] of Object.entries(links)) {
    if (typeof v !== "string" || !v.trim()) continue;
    entries.push({ key: k, label: v, href: linkifyHandle(k, v) });
  }
  if (entries.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 tracking-tight text-xl font-semibold">Elsewhere</h2>
      <ul className="flex flex-wrap gap-2">
        {entries.map((e) => (
          <li key={e.key}>
            <a
              href={e.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent/40"
            >
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {platformLabel(e.key)}
              </span>
              <span>{e.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function VisitsSection({
  visits,
  totalAccepted,
}: {
  visits: VerifierPublicVisitSummary[];
  totalAccepted: number;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 tracking-tight text-xl font-semibold">
        Recent verified visits
      </h2>
      {visits.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No verified visits yet. Check back soon.
        </p>
      ) : (
        <>
          <ul className="space-y-3">
            {visits.map((v) => (
              <VisitRow key={v.id} visit={v} />
            ))}
          </ul>
          {totalAccepted > visits.length && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Showing the {visits.length} most recent of {totalAccepted}{" "}
              verified visits.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function VisitRow({ visit }: { visit: VerifierPublicVisitSummary }) {
  const location = [visit.place.city, visit.place.region]
    .filter(Boolean)
    .join(", ");
  const visitedAt = new Date(visit.visited_at).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
  return (
    <li className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/places/${visit.place.id}`}
            className="text-base font-medium hover:underline"
          >
            {visit.place.name}
          </Link>
          {location && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {location}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Verified on {visitedAt} · Disclosure:{" "}
            <span className="font-medium">
              {formatDisclosure(visit.disclosure)}
            </span>
          </p>
        </div>
        {visit.public_review_url && (
          <a
            href={visit.public_review_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            Public review ↗
          </a>
        )}
      </div>
    </li>
  );
}

function TrustFooter() {
  return (
    <section className="mt-12 rounded-md border border-primary/20 bg-primary/5 p-6 text-center">
      <p className="mb-4 text-sm text-muted-foreground">
        Verifier reports feed the halal profiles at halalfoodnearme.com.
        Every visit is admin-reviewed before it counts.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild size="sm">
          <Link href="/">Browse verified restaurants</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/become-a-verifier">Become a verifier</Link>
        </Button>
      </div>
    </section>
  );
}

function NotFoundPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-center">
      <h1 className="mb-3 tracking-tight text-3xl font-semibold">
        Verifier not found
      </h1>
      <p className="mb-6 text-muted-foreground">
        This verifier profile doesn&apos;t exist, or the verifier hasn&apos;t
        made their profile public.
      </p>
      <Button asChild>
        <Link href="/">Back to the directory</Link>
      </Button>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDisclosure(d: VisitDisclosure): string {
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
      return String(d).toLowerCase();
  }
}

function platformLabel(key: string): string {
  const label = key.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Turn a stored handle-or-URL into a clickable URL. Verifiers may
 * store either raw handles (``@yasmeen_eats``) or full URLs — we
 * normalize so the link works either way.
 */
function linkifyHandle(platform: string, value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const cleaned = trimmed.replace(/^@/, "");
  switch (platform) {
    case "instagram":
      return `https://instagram.com/${cleaned}`;
    case "tiktok":
      return `https://tiktok.com/@${cleaned}`;
    case "youtube":
      return `https://youtube.com/${cleaned.startsWith("@") ? cleaned : "@" + cleaned}`;
    case "website":
      return `https://${cleaned}`;
    default:
      return trimmed;
  }
}
