/**
 * "What we know about halal here" card — the consumer-facing trust
 * summary on the place detail page.
 *
 * Replaces the older multi-panel HalalProfileDetail. The earlier
 * layout stacked seven labelled sections vertically — accurate but
 * heavy, and most readers only need to scan one or two facts before
 * deciding whether to go. This card consolidates the same data into a
 * shorter, scannable shape:
 *
 *   1. Validation tier callout — who said this is halal, with a
 *      one-line justification ("Trust Halal verifier visited",
 *      "Owner-attested", etc.).
 *   2. Facts strip — the same chips the search result card uses, big
 *      enough to read but compact enough to fit in one or two rows.
 *   3. Per-meat slaughter table (when meat is served at all) — the
 *      one piece of info that genuinely benefits from a grid layout.
 *   4. "More details" pin-line for pork, alcohol, alcohol-in-cooking,
 *      cert specifics, and owner caveats — a single dense paragraph
 *      block instead of three sub-panels.
 *   5. Freshness footer — last verified + re-verification due.
 *
 * If the place has no halal_profile, this component renders the
 * "no profile yet" affordance instead of nothing — that decision
 * stays in the parent so it can pick a different element on a
 * design refresh, but the empty-state copy lives here too.
 */
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CircleAlert,
  Info,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";

import type {
  AlcoholPolicy,
  HalalProfileEmbed,
  MenuPosture,
  SlaughterMethod,
  ValidationTier,
} from "@/lib/api/hooks";
import { halalFactsFor, type HalalFactChip } from "@/lib/halal-display";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Label tables — same copy as the older detail component but trimmed
// for a single-line "more details" rendering.
// ---------------------------------------------------------------------------

const TIER_HEADLINE: Record<ValidationTier, string> = {
  SELF_ATTESTED: "Owner-attested",
  CERTIFICATE_ON_FILE: "Certificate on file",
  TRUST_HALAL_VERIFIED: "Verified by Trust Halal",
};

const TIER_DESCRIPTION: Record<ValidationTier, string> = {
  SELF_ATTESTED:
    "The restaurant owner submitted this information themselves. Trust Halal hasn't independently verified it.",
  CERTIFICATE_ON_FILE:
    "The restaurant submitted a halal certificate that's on file with Trust Halal. We haven't visited in person.",
  TRUST_HALAL_VERIFIED:
    "A Trust Halal verifier visited and confirmed the halal information in person.",
};

const TIER_TONE: Record<ValidationTier, string> = {
  SELF_ATTESTED:
    "border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
  CERTIFICATE_ON_FILE:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  TRUST_HALAL_VERIFIED:
    "border-primary/40 bg-primary/10 text-foreground dark:border-primary/40 dark:bg-primary/15",
};

const MENU_POSTURE_LABELS: Record<MenuPosture, string> = {
  FULLY_HALAL: "Every item on the menu is halal.",
  MIXED_SEPARATE_KITCHENS:
    "Halal and non-halal items are prepared in separate kitchens.",
  HALAL_OPTIONS_ADVERTISED:
    "Halal items are listed on the menu alongside non-halal ones.",
  HALAL_UPON_REQUEST:
    "Halal items aren't on the regular menu but are available on request.",
  MIXED_SHARED_KITCHEN:
    "Halal and non-halal items share kitchen equipment.",
};

const ALCOHOL_POLICY_LABELS: Record<AlcoholPolicy, string> = {
  NONE: "No alcohol served.",
  BEER_AND_WINE_ONLY: "Beer and wine served on premises.",
  FULL_BAR: "Full bar — beer, wine, and spirits served.",
};

const SLAUGHTER_LABELS: Record<SlaughterMethod, string> = {
  ZABIHAH: "Zabihah",
  MACHINE: "Machine",
  NOT_SERVED: "Not served",
};

const SLAUGHTER_TONE: Record<SlaughterMethod, string> = {
  ZABIHAH:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  MACHINE:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  NOT_SERVED:
    "border-slate-200 bg-muted/40 text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Top-level renderer
// ---------------------------------------------------------------------------

export function PlaceTrustSummary({
  profile,
}: {
  profile: HalalProfileEmbed;
}) {
  const facts = halalFactsFor(profile);

  return (
    <section
      aria-labelledby="trust-summary-heading"
      className="space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <header className="space-y-1">
        <h2
          id="trust-summary-heading"
          className="text-base font-semibold tracking-tight"
        >
          What we know about halal here
        </h2>
        <p className="text-sm text-muted-foreground">
          Pulled from the owner&rsquo;s halal claim and (where available)
          a Trust Halal verifier visit.
        </p>
      </header>

      <ValidationTierCallout profile={profile} />

      {profile.dispute_state !== "NONE" && (
        <DisputeBanner state={profile.dispute_state} />
      )}

      {facts.length > 0 && <FactsStrip facts={facts} />}

      <SlaughterTable profile={profile} />

      <MoreDetails profile={profile} />

      {profile.caveats && <CaveatsCallout caveats={profile.caveats} />}

      <FreshnessFooter profile={profile} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// "No halal profile yet" empty-state. Surfaced by the parent when
// place.halal_profile is null. Lives here so the empty + populated
// states share a visual idiom.
// ---------------------------------------------------------------------------
export function PlaceNoTrustSummary() {
  return (
    <section className="rounded-xl border border-dashed bg-muted/30 p-6 text-center">
      <Info
        className="mx-auto h-6 w-6 text-muted-foreground/70"
        aria-hidden
      />
      <p className="mt-3 text-sm font-medium text-foreground">
        No halal profile yet.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        This restaurant hasn&rsquo;t been verified by Trust Halal. If
        you own or know this place, ask the owner to submit a halal
        claim through the owner portal.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Validation tier callout — the single most-important line in the
// summary, so it gets its own bordered block at the top.
// ---------------------------------------------------------------------------
function ValidationTierCallout({
  profile,
}: {
  profile: HalalProfileEmbed;
}) {
  const headline =
    TIER_HEADLINE[profile.validation_tier] ?? profile.validation_tier;
  const description =
    TIER_DESCRIPTION[profile.validation_tier] ??
    "Trust tier for this halal profile.";
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        TIER_TONE[profile.validation_tier] ?? "",
      )}
    >
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="text-base font-semibold leading-tight">
          {headline}
        </p>
        <p className="text-sm leading-snug">{description}</p>
      </div>
    </div>
  );
}

function DisputeBanner({
  state,
}: {
  state: HalalProfileEmbed["dispute_state"];
}) {
  const copy =
    state === "DISPUTED"
      ? "A consumer reported that this profile may be inaccurate. Trust Halal is reviewing."
      : "The owner is updating their halal information in response to a consumer report.";
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900",
        "dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
      )}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-1 text-sm">
        <p className="font-semibold">Profile under review</p>
        <p>{copy}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Facts strip — chip per true-only attribute. Renders bigger than the
// result-card chips because they're the headline information on this
// page; the chips' ``hint`` lands in ``title`` for desktop hover and
// ``aria-label`` for screen readers.
// ---------------------------------------------------------------------------
function FactsStrip({ facts }: { facts: HalalFactChip[] }) {
  return (
    <ul
      className="flex flex-wrap items-center gap-2"
      aria-label="Halal facts on file"
    >
      {facts.map((f) => (
        <li
          key={f.label}
          title={f.hint}
          aria-label={f.hint ?? f.label}
          className={cn(
            "inline-flex items-center rounded-md border bg-background px-2.5 py-1 text-xs font-medium",
            "shadow-sm",
          )}
        >
          {f.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Per-meat slaughter grid. Seafood-only kitchens skip the grid (every
// row would read "Not served" — visual noise without information).
// ---------------------------------------------------------------------------
function SlaughterTable({ profile }: { profile: HalalProfileEmbed }) {
  if (profile.seafood_only) {
    return null;
  }

  const rows: Array<{ label: string; method: SlaughterMethod }> = [
    { label: "Chicken", method: profile.chicken_slaughter },
    { label: "Beef", method: profile.beef_slaughter },
    { label: "Lamb", method: profile.lamb_slaughter },
    { label: "Goat", method: profile.goat_slaughter },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Slaughter method
      </h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map((row) => {
          const label = SLAUGHTER_LABELS[row.method] ?? row.method;
          const tone =
            SLAUGHTER_TONE[row.method] ??
            "border-slate-200 bg-muted/40 text-muted-foreground";
          return (
            <li
              key={row.label}
              className={cn(
                "flex flex-col gap-0.5 rounded-md border px-3 py-2",
                tone,
              )}
            >
              <span className="text-[11px] font-medium uppercase tracking-wide opacity-70">
                {row.label}
              </span>
              <span className="text-sm font-semibold">{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "More details" — the catch-all dense block for pork, alcohol,
// cert specifics, and seafood-only mention. One paragraph block
// instead of three labelled sub-panels: each line carries a strong
// label so the contents are still scannable, but they share the same
// visual container.
// ---------------------------------------------------------------------------
function MoreDetails({ profile }: { profile: HalalProfileEmbed }) {
  const lines: Array<{ label: string; body: React.ReactNode }> = [];

  // Menu posture is on the facts strip when it's "fully halal" or
  // "separate kitchens"; surface the full sentence here regardless so
  // the long-form description is one tap away.
  lines.push({
    label: "Menu",
    body:
      MENU_POSTURE_LABELS[profile.menu_posture] ?? profile.menu_posture,
  });

  if (profile.seafood_only) {
    lines.push({
      label: "Kitchen",
      body: "Seafood-only — no land meat or poultry served.",
    });
  }

  lines.push({
    label: "Pork",
    body: profile.has_pork
      ? "Pork is served at this restaurant."
      : "No pork served.",
  });

  lines.push({
    label: "Alcohol",
    body:
      ALCOHOL_POLICY_LABELS[profile.alcohol_policy] ??
      profile.alcohol_policy,
  });

  if (profile.alcohol_in_cooking) {
    lines.push({
      label: "Cooking with alcohol",
      body: "Some dishes are prepared with alcohol (wine, mirin, etc.).",
    });
  }

  if (profile.has_certification) {
    const body = (
      <span className="inline-flex items-center gap-1.5">
        <BadgeCheck
          className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
        <span>
          {profile.certifying_body_name
            ? `Certified by ${profile.certifying_body_name}`
            : "Halal certificate on file"}
          {profile.certificate_expires_at && (
            <span className="text-muted-foreground">
              {" "}
              · Valid through{" "}
              {formatDateOnly(profile.certificate_expires_at)}
            </span>
          )}
        </span>
      </span>
    );
    lines.push({ label: "Certification", body });
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Details
      </h3>
      <dl className="space-y-1.5 text-sm leading-relaxed">
        {lines.map((line) => (
          <div
            key={line.label}
            className="flex flex-col gap-0.5 sm:flex-row sm:gap-2"
          >
            <dt className="font-medium text-foreground sm:w-44 sm:shrink-0">
              {line.label}
            </dt>
            <dd className="text-muted-foreground">{line.body}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Owner-supplied caveats — free-form text the owner adds to clarify
// edge cases ("hot dogs are turkey", "beef bacon only on weekends").
// Rendered as a dedicated callout so it doesn't get buried under the
// structured fields.
// ---------------------------------------------------------------------------
function CaveatsCallout({ caveats }: { caveats: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm",
      )}
    >
      <CircleAlert
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Notes from the owner
        </p>
        <p className="whitespace-pre-line text-foreground">{caveats}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Freshness footer — last verified + re-verification due. Lives at
// the bottom because it's metadata about the profile, not part of
// the profile itself.
// ---------------------------------------------------------------------------
function FreshnessFooter({ profile }: { profile: HalalProfileEmbed }) {
  return (
    <div className="flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
      <CalendarClock
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        aria-hidden
      />
      <p>
        Last verified {formatDateRelative(profile.last_verified_at)}
        {profile.expires_at && (
          <>
            {" "}
            · Re-verification due{" "}
            {formatDateOnly(profile.expires_at)}
          </>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateOnly(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} month${months === 1 ? "" : "s"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  } catch {
    return iso;
  }
}
