"use client";

/**
 * `/get-verified` — the onboarding HUB (parallel flow).
 *
 * Reads the owner's real state across all three stages and renders a
 * roadmap that always makes the gates obvious: "waiting on you" vs
 * "waiting on us", unlocking each stage only when the prior review
 * clears. Once everything is approved it flips to a steady-state
 * dashboard variant.
 *
 * This surface is additive — it reuses the same hooks + status enums
 * the existing pages use and never mutates anything itself. The old
 * flow stays 100% intact and reachable; this is only reachable by
 * navigating to /get-verified.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { OrgStatusBadge } from "@/components/org-status-badge";
import {
  type AlcoholPolicy,
  type MenuPosture,
  type MyHalalClaimRead,
  type MyOrganizationRead,
  type OwnedPlaceRead,
  ORG_ELIGIBLE_FOR_CLAIM,
  useCurrentUser,
  useMyHalalClaims,
  useMyOrganizations,
  useMyOwnedPlaces,
  useMyOwnershipRequests,
} from "@/lib/api/hooks";

import {
  LockNote,
  Roadmap,
  RoadmapStage,
  StagePill,
  type StageState,
} from "./_components/wizard";

export default function GetVerifiedHubPage() {
  const { data: me } = useCurrentUser();
  const orgs = useMyOrganizations();
  const claims = useMyOwnershipRequests();
  const ownedPlaces = useMyOwnedPlaces();
  const halalClaims = useMyHalalClaims();

  const isLoading =
    orgs.isLoading ||
    claims.isLoading ||
    ownedPlaces.isLoading ||
    halalClaims.isLoading;

  const firstName = (me?.display_name ?? "").trim().split(/\s+/)[0];

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Loading your roadmap…</p>
      </div>
    );
  }

  const orgList = orgs.data ?? [];
  const claimList = claims.data ?? [];
  const places = ownedPlaces.data ?? [];
  const halalList = halalClaims.data ?? [];

  // Primary org = most recently created.
  const primaryOrg =
    [...orgList].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0] ?? null;

  const orgVerified = primaryOrg?.status === "VERIFIED";
  const orgEligible = orgList.some((o) =>
    ORG_ELIGIBLE_FOR_CLAIM.includes(o.status),
  );

  const anyApprovedClaim = claimList.some((c) => c.status === "APPROVED");
  const anyPendingClaim = claimList.some((c) =>
    ["SUBMITTED", "UNDER_REVIEW"].includes(c.status),
  );
  const anyClaimNeedsFix = claimList.some((c) =>
    ["NEEDS_EVIDENCE", "REJECTED"].includes(c.status),
  );

  const stage3Unlocked = places.length > 0 || anyApprovedClaim;
  const approvedHalal = halalList.filter((h) => h.status === "APPROVED");
  const anyHalalPending = halalList.some((h) =>
    ["PENDING_REVIEW", "NEEDS_MORE_INFO"].includes(h.status),
  );

  const allDone = approvedHalal.length > 0 && places.length > 0;

  if (allDone) {
    return (
      <Dashboard
        firstName={firstName}
        org={primaryOrg}
        orgs={orgList}
        places={places}
        halalClaims={halalList}
      />
    );
  }

  // ---- Stage states -------------------------------------------------------
  const stage1 = deriveStage1(primaryOrg);
  const stage2 = deriveStage2({
    orgEligible,
    anyApprovedClaim,
    anyPendingClaim,
    anyClaimNeedsFix,
  });
  const stage3 = deriveStage3({
    unlocked: stage3Unlocked,
    approvedCount: approvedHalal.length,
    anyHalalPending,
  });

  // Heading tracks the furthest un-cleared step.
  const heading = !stage1.done
    ? `Welcome${firstName ? `, ${firstName}` : ""}. Three steps to your verified badge.`
    : !stage2.done
      ? "Your business is verified — now claim your restaurant."
      : "Almost there — confirm your halal details.";

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
        Get verified
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        {heading}
      </h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Each step is quick, but we review a couple of them by hand — so
        there&apos;s a short wait between some. We&apos;ll email you the moment
        the ball&apos;s back in your court.
      </p>

      <Roadmap>
        {/* Stage 1 — business */}
        <RoadmapStage index={1} state={stage1.state} title="Register your business">
          <StageBody pill={stage1.pill}>
            {stage1.state === "review" ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {primaryOrg?.name ?? "Your business"} is with our team — usually
                2–3 business days. We&apos;ll email you the moment it clears and
                unlock your next step.
              </p>
            ) : stage1.state === "done" ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {primaryOrg?.name}
              </p>
            ) : stage1.state === "fix" ? (
              <>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Trust Halal couldn&apos;t verify this business.
                  {primaryOrg?.decision_note
                    ? ` Their note: ${primaryOrg.decision_note}`
                    : " Reach out to support if you need context."}
                </p>
                <CtaRow>
                  <Link href="/get-verified/business">
                    <Button>Fix &amp; resubmit →</Button>
                  </Link>
                </CtaRow>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Tell us about the legal entity that operates your
                  restaurant(s). We verify it once — then every location you
                  claim rolls up under it.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  📎 You&apos;ll upload <strong className="text-foreground">articles of organization</strong>{" "}
                  or a <strong className="text-foreground">certificate of formation</strong>.
                </p>
                <CtaRow>
                  <Link href="/get-verified/business">
                    <Button>
                      {stage1.state === "now" && primaryOrg?.status === "DRAFT"
                        ? "Resume →"
                        : "Start now →"}
                    </Button>
                  </Link>
                  <span className="text-xs text-muted-foreground">~5 min</span>
                </CtaRow>
              </>
            )}
          </StageBody>
        </RoadmapStage>

        {/* Stage 2 — claim */}
        <RoadmapStage index={2} state={stage2.state} title="Claim your restaurant">
          <StageBody pill={stage2.pill}>
            {stage2.state === "lock" ? (
              <>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Link a specific location to your verified business.
                </p>
                <LockNote>Unlocks once your business is submitted for review.</LockNote>
              </>
            ) : stage2.state === "review" ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                Your claim is with our team. We&apos;ll email you when it&apos;s
                decided.
              </p>
            ) : stage2.state === "done" ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {places[0]?.place_name ?? "Your restaurant"}
              </p>
            ) : (
              <>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {stage2.state === "fix"
                    ? "Your claim needs another look — add what we asked for and resubmit."
                    : "Link a specific location to your verified business."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  📎 You&apos;ll upload a <strong className="text-foreground">business license</strong>,
                  lease, or sales-tax permit.
                </p>
                <CtaRow>
                  <Link href="/get-verified/claim">
                    <Button>
                      {stage2.state === "fix" ? "Update claim →" : "Claim a restaurant →"}
                    </Button>
                  </Link>
                </CtaRow>
              </>
            )}
          </StageBody>
        </RoadmapStage>

        {/* Stage 3 — halal */}
        <RoadmapStage index={3} state={stage3.state} title="Confirm halal details" isLast>
          <StageBody pill={stage3.pill}>
            {stage3.state === "lock" ? (
              <>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  A few plain questions + your halal certificate, so diners see
                  the right info.
                </p>
                <LockNote>Unlocks once we approve your restaurant claim.</LockNote>
              </>
            ) : stage3.state === "review" ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                Your halal details are under review. We&apos;ll email you when
                they&apos;re approved.
              </p>
            ) : stage3.state === "done" ? (
              <p className="mt-1.5 text-sm text-muted-foreground">Verified.</p>
            ) : (
              <>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  A few plain questions + your halal certificate, so diners see
                  the right info.
                </p>
                <CtaRow>
                  <Link href="/get-verified/halal">
                    <Button>Confirm halal details →</Button>
                  </Link>
                </CtaRow>
              </>
            )}
          </StageBody>
        </RoadmapStage>
      </Roadmap>

      {/* Multi-entity owners: an at-a-glance list of every business on the
          account with its live status. The roadmap above only tracks the
          most-recent entity, so without this an owner who registers a
          second business loses sight of the first. */}
      {orgList.length >= 2 && (
        <BusinessesOverview orgs={orgList} activeOrgId={primaryOrg?.id ?? null} />
      )}

      {/* Once a business is verified, multi-entity owners can branch off to
          register another legal entity (a store under a different company). */}
      {orgVerified && (
        <div className="mt-6 text-center">
          <Link
            href="/get-verified/business?new=1"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Own a store under a different business? Register another →
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Your-businesses overview — every org on the account + its live status.
// ---------------------------------------------------------------------------

function BusinessesOverview({
  orgs,
  activeOrgId,
}: {
  orgs: MyOrganizationRead[];
  activeOrgId: string | null;
}) {
  const sorted = [...orgs].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Your businesses</h2>
        <Link
          href="/my-organizations"
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Manage all →
        </Link>
      </div>
      <ul className="mt-3 space-y-2">
        {sorted.map((o) => (
          <li key={o.id}>
            <Link
              href={`/my-organizations/${o.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {o.name}
                </span>
                {o.id === activeOrgId && (
                  <span className="text-[11px] text-muted-foreground">
                    Currently setting up
                  </span>
                )}
              </span>
              <OrgStatusBadge status={o.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function StageBody({
  pill,
  children,
}: {
  pill: { tone: "action" | "review" | "done" | "lock" | "fix"; label: string };
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="mt-2 flex">
        <StagePill tone={pill.tone}>{pill.label}</StagePill>
      </div>
      {children}
    </>
  );
}

function CtaRow({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 flex items-center gap-3">{children}</div>;
}

// ---------------------------------------------------------------------------
// Stage derivation
// ---------------------------------------------------------------------------

type Pill = {
  tone: "action" | "review" | "done" | "lock" | "fix";
  label: string;
};

function deriveStage1(org: MyOrganizationRead | null): {
  state: StageState;
  done: boolean;
  pill: Pill;
} {
  if (!org) {
    return { state: "now", done: false, pill: { tone: "action", label: "Start here" } };
  }
  switch (org.status) {
    case "VERIFIED":
      return { state: "done", done: true, pill: { tone: "done", label: "✓ Verified" } };
    case "UNDER_REVIEW":
      return { state: "review", done: false, pill: { tone: "review", label: "In review" } };
    case "REJECTED":
      return { state: "fix", done: false, pill: { tone: "fix", label: "Needs fix" } };
    case "DRAFT":
    default:
      return { state: "now", done: false, pill: { tone: "action", label: "Continue" } };
  }
}

function deriveStage2({
  orgEligible,
  anyApprovedClaim,
  anyPendingClaim,
  anyClaimNeedsFix,
}: {
  orgEligible: boolean;
  anyApprovedClaim: boolean;
  anyPendingClaim: boolean;
  anyClaimNeedsFix: boolean;
}): { state: StageState; done: boolean; pill: Pill } {
  if (!orgEligible) {
    return { state: "lock", done: false, pill: { tone: "lock", label: "🔒 Locked" } };
  }
  if (anyApprovedClaim) {
    return { state: "done", done: true, pill: { tone: "done", label: "✓ Approved" } };
  }
  if (anyPendingClaim) {
    return { state: "review", done: false, pill: { tone: "review", label: "In review" } };
  }
  if (anyClaimNeedsFix) {
    return { state: "fix", done: false, pill: { tone: "fix", label: "Needs fix" } };
  }
  return { state: "now", done: false, pill: { tone: "action", label: "Your turn" } };
}

function deriveStage3({
  unlocked,
  approvedCount,
  anyHalalPending,
}: {
  unlocked: boolean;
  approvedCount: number;
  anyHalalPending: boolean;
}): { state: StageState; done: boolean; pill: Pill } {
  if (!unlocked) {
    return { state: "lock", done: false, pill: { tone: "lock", label: "🔒 Locked" } };
  }
  if (approvedCount > 0) {
    return { state: "done", done: true, pill: { tone: "done", label: "✓ Verified" } };
  }
  if (anyHalalPending) {
    return { state: "review", done: false, pill: { tone: "review", label: "In review" } };
  }
  return { state: "now", done: false, pill: { tone: "action", label: "Your turn" } };
}

// ---------------------------------------------------------------------------
// Steady-state dashboard (all three cleared)
// ---------------------------------------------------------------------------

const MENU_LABELS: Partial<Record<MenuPosture, string>> = {
  FULLY_HALAL: "Fully halal",
  MIXED_SEPARATE_KITCHENS: "Halal — separate kitchen",
  HALAL_OPTIONS_ADVERTISED: "Halal options",
  HALAL_UPON_REQUEST: "Halal on request",
  MIXED_SHARED_KITCHEN: "Halal options",
};

const ALCOHOL_LABELS: Partial<Record<AlcoholPolicy, string>> = {
  NONE: "No alcohol",
  BEER_AND_WINE_ONLY: "Beer & wine",
  FULL_BAR: "Full bar",
};

function Dashboard({
  firstName,
  org,
  orgs,
  places,
  halalClaims,
}: {
  firstName: string;
  org: MyOrganizationRead | null;
  orgs: MyOrganizationRead[];
  places: OwnedPlaceRead[];
  halalClaims: MyHalalClaimRead[];
}) {
  const approvedByPlace = new Map<string, MyHalalClaimRead>();
  for (const claim of halalClaims) {
    if (claim.status === "APPROVED" && claim.place_id) {
      if (!approvedByPlace.has(claim.place_id)) {
        approvedByPlace.set(claim.place_id, claim);
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
        All set
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        Welcome back{firstName ? `, ${firstName}` : ""}.
      </h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground">
          ✓ VERIFIED BUSINESS
        </span>
        {org?.name}
        {places.length > 0 && (
          <span>
            · {places.length} location{places.length === 1 ? "" : "s"}
          </span>
        )}
      </p>

      <div className="mt-6 space-y-3">
        {places.map((place) => {
          const claim = approvedByPlace.get(place.place_id);
          const q = claim?.structured_response ?? null;
          const chips: string[] = [];
          if (q?.menu_posture && MENU_LABELS[q.menu_posture]) {
            chips.push(MENU_LABELS[q.menu_posture]!);
          }
          if (q?.alcohol_policy && ALCOHOL_LABELS[q.alcohol_policy]) {
            chips.push(ALCOHOL_LABELS[q.alcohol_policy]!);
          }
          if (q?.has_certification) {
            chips.push(
              q.certifying_body_name
                ? `Certified · ${q.certifying_body_name}`
                : "Certified",
            );
          }
          return (
            <div key={place.place_id} className="rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{place.place_name}</h2>
                {claim ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground">
                    ✓ VERIFIED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    Halal pending
                  </span>
                )}
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {[place.place_address, place.place_city, place.place_country_code]
                  .filter(Boolean)
                  .join(", ") || "No address on file"}
              </p>
              {chips.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-md bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={claim ? `/my-halal-claims/${claim.id}` : "/get-verified/halal"}
                >
                  <Button variant="outline" size="sm">
                    Edit halal details
                  </Button>
                </Link>
                <Link href={`/my-places/${place.place_id}`}>
                  <Button variant="outline" size="sm">
                    View listing
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed bg-muted/30 p-5">
          <div>
            <p className="text-sm font-semibold">Run another location?</p>
            <p className="text-[13px] text-muted-foreground">
              Claim it under {org?.name ?? "your business"} — no need to
              re-verify.
            </p>
          </div>
          <Link href="/get-verified/claim">
            <Button>Claim a restaurant →</Button>
          </Link>
        </div>

        {/* Multi-entity owners: a store run under a different legal entity
            needs its own verified business first. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed bg-muted/30 p-5">
          <div>
            <p className="text-sm font-semibold">
              Own a store under a different business?
            </p>
            <p className="text-[13px] text-muted-foreground">
              Register another legal entity — we&apos;ll verify it, then you can
              claim locations under it.
            </p>
          </div>
          <Link href="/get-verified/business?new=1">
            <Button variant="outline">Register a new business →</Button>
          </Link>
        </div>
      </div>

      {orgs.length >= 2 && (
        <BusinessesOverview orgs={orgs} activeOrgId={org?.id ?? null} />
      )}
    </div>
  );
}
