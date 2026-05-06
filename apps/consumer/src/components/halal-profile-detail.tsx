/**
 * Detailed halal-profile renderer for the place detail page.
 *
 * The search-results page uses ``HalalProfileBadges`` — a compact
 * chip strip designed to scan in a list. The detail page wants more:
 * a callout for the validation tier, a labeled grid for per-meat
 * slaughter methods, certificate and caveat callouts, and
 * verification freshness metadata.
 *
 * Every label here is a full sentence consumers can understand
 * without halal terminology context. Enum values never leak through
 * to copy — if a new value lands server-side without a label entry,
 * the fallback shows the raw enum so we notice in QA but the page
 * doesn't crash.
 */
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CircleAlert,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";

import { HalalProfileBadges } from "@/components/halal-badges";
import type {
  AlcoholPolicy,
  HalalProfileEmbed,
  MenuPosture,
  SlaughterMethod,
  ValidationTier,
} from "@/lib/api/hooks";

// ---------------------------------------------------------------------------
// Label tables
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
    "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  TRUST_HALAL_VERIFIED:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
};

const MENU_POSTURE_LABELS: Record<MenuPosture, string> = {
  FULLY_HALAL: "Fully halal — every item on the menu is halal.",
  MIXED_SEPARATE_KITCHENS:
    "Halal and non-halal items are prepared in separate kitchens.",
  HALAL_OPTIONS_ADVERTISED:
    "Halal items are listed on the menu alongside non-halal ones.",
  HALAL_UPON_REQUEST:
    "Halal items aren't on the regular menu, but are available if you ask.",
  MIXED_SHARED_KITCHEN:
    "Halal and non-halal items share kitchen equipment.",
};

const ALCOHOL_POLICY_LABELS: Record<AlcoholPolicy, string> = {
  NONE: "No alcohol served.",
  BEER_AND_WINE_ONLY: "Beer and wine are served on premises.",
  FULL_BAR: "Full bar — beer, wine, and spirits served.",
};

const SLAUGHTER_LABELS: Record<SlaughterMethod, string> = {
  ZABIHAH: "Zabihah",
  MACHINE: "Machine-slaughtered",
  NOT_SERVED: "Not served",
};

const SLAUGHTER_TONE: Record<SlaughterMethod, string> = {
  ZABIHAH:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  MACHINE:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  NOT_SERVED:
    "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HalalProfileDetail({
  profile,
}: {
  profile: HalalProfileEmbed;
}) {
  return (
    <section className="space-y-6">
      <ValidationTierCallout profile={profile} />

      {profile.dispute_state !== "NONE" && (
        <DisputeBanner state={profile.dispute_state} />
      )}

      {/* Quick visual summary chips — same component used on the
          search list, repeated here so the detail page is
          self-contained when shared as a deep link. */}
      <HalalProfileBadges profile={profile} />

      <MenuPosturePanel profile={profile} />

      <SlaughterTable profile={profile} />

      <PorkAndAlcoholPanel profile={profile} />

      {profile.has_certification && (
        <CertificationPanel profile={profile} />
      )}

      {profile.caveats && <CaveatsPanel caveats={profile.caveats} />}

      <FreshnessFooter profile={profile} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-panels
// ---------------------------------------------------------------------------

function ValidationTierCallout({ profile }: { profile: HalalProfileEmbed }) {
  const headline =
    TIER_HEADLINE[profile.validation_tier] ?? profile.validation_tier;
  const description =
    TIER_DESCRIPTION[profile.validation_tier] ??
    "Trust tier for this halal profile.";
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 ${
        TIER_TONE[profile.validation_tier] ?? ""
      }`}
    >
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="text-base font-semibold">{headline}</p>
        <p className="text-sm">{description}</p>
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
      ? "A consumer reported that this profile may be inaccurate. Trust Halal is reviewing the dispute."
      : "The owner is updating their halal information in response to a consumer report.";

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-1 text-sm">
        <p className="font-semibold">Profile under review</p>
        <p>{copy}</p>
      </div>
    </div>
  );
}

function MenuPosturePanel({ profile }: { profile: HalalProfileEmbed }) {
  const text =
    MENU_POSTURE_LABELS[profile.menu_posture] ?? profile.menu_posture;
  return (
    <Panel title="Menu posture">
      <p className="text-sm">{text}</p>
    </Panel>
  );
}

function PorkAndAlcoholPanel({ profile }: { profile: HalalProfileEmbed }) {
  const alcoholText =
    ALCOHOL_POLICY_LABELS[profile.alcohol_policy] ?? profile.alcohol_policy;
  return (
    <Panel title="Pork and alcohol">
      <ul className="space-y-1 text-sm">
        <li>
          <strong>Pork:</strong>{" "}
          {profile.has_pork
            ? "Pork is served at this restaurant."
            : "No pork served."}
        </li>
        <li>
          <strong>Alcohol:</strong> {alcoholText}
        </li>
        {profile.alcohol_in_cooking && (
          <li>
            <strong>Cooking with alcohol:</strong> Some dishes are
            prepared with alcohol (wine, mirin, etc.).
          </li>
        )}
      </ul>
    </Panel>
  );
}

function SlaughterTable({ profile }: { profile: HalalProfileEmbed }) {
  // Seafood-only kitchens skip the meat grid entirely — the four
  // rows would all read "Not served" which adds noise.
  if (profile.seafood_only) {
    return (
      <Panel title="Slaughter method">
        <p className="text-sm">
          Seafood-only kitchen — no meat or poultry served.
        </p>
      </Panel>
    );
  }

  const rows: Array<{ label: string; method: SlaughterMethod }> = [
    { label: "Chicken", method: profile.chicken_slaughter },
    { label: "Beef", method: profile.beef_slaughter },
    { label: "Lamb", method: profile.lamb_slaughter },
    { label: "Goat", method: profile.goat_slaughter },
  ];

  return (
    <Panel title="Slaughter method">
      <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {rows.map((row) => {
          const label = SLAUGHTER_LABELS[row.method] ?? row.method;
          const tone =
            SLAUGHTER_TONE[row.method] ??
            "border-slate-300 bg-slate-50 text-slate-900";
          return (
            <li
              key={row.label}
              className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 ${tone}`}
            >
              <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                {row.label}
              </span>
              <span className="text-sm font-semibold">{label}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CertificationPanel({ profile }: { profile: HalalProfileEmbed }) {
  return (
    <Panel title="Certification">
      <div className="flex items-start gap-3 text-sm">
        <BadgeCheck
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
        <div className="space-y-1">
          {profile.certifying_body_name ? (
            <p>
              <strong>Certified by:</strong>{" "}
              {profile.certifying_body_name}
            </p>
          ) : (
            <p>The restaurant has a certificate on file.</p>
          )}
          {profile.certificate_expires_at && (
            <p className="text-muted-foreground">
              Certificate valid through{" "}
              {formatDateOnly(profile.certificate_expires_at)}.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

function CaveatsPanel({ caveats }: { caveats: string }) {
  return (
    <Panel title="Owner notes">
      <div className="flex items-start gap-3 text-sm">
        <CircleAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <p className="whitespace-pre-line">{caveats}</p>
      </div>
    </Panel>
  );
}

function FreshnessFooter({ profile }: { profile: HalalProfileEmbed }) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
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
// Atoms
// ---------------------------------------------------------------------------

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

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
