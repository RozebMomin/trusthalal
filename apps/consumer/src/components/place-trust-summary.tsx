/**
 * Trust summary card for the place detail page — tightened pass.
 *
 * Information ordered by what a halal consumer scans for, not by what
 * the data model groups together:
 *
 *   1. **Headline** — a single sentence answering "is this halal?".
 *      Combines validation tier + menu posture into one statement
 *      ("Verified halal — fully halal kitchen") so the visitor doesn't
 *      have to mentally cross-reference two badges.
 *   2. **Dispute banner** — only when ``dispute_state !== "NONE"``.
 *      Surfaces above the meat grid so a disputed profile reads as
 *      "questioned" before the visitor commits to the rest.
 *   3. **Slaughter grid** — four meat tiles. Single most important
 *      detail beyond the headline for many observant consumers, so it
 *      lives high up. Skipped entirely on seafood-only kitchens.
 *   4. **Pork + alcohol line** — two short fact lines. Anything
 *      observant consumers expect to be a "yes/no/with caveat".
 *   5. **Certifications** — clickable. Opens a dialog with the
 *      issuer, expiration, and (eventually) the certificate document.
 *      Only rendered when ``has_certification`` is true.
 *   6. **Owner notes** — free-form caveats from the owner.
 *   7. **Last verified** — small footer.
 *
 * Copy is consciously tighter than the previous "What we know about
 * halal here" pass. Headers are short, paragraphs cap at one line
 * where possible, and the only rich-format block is the slaughter
 * grid (the one place where structure pays for itself).
 */
"use client";

import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Info,
  ShieldCheck,
  Wine,
} from "lucide-react";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  AlcoholPolicy,
  HalalProfileEmbed,
  MenuPosture,
  SlaughterMethod,
  ValidationTier,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Headline — one sentence built from the tier + posture combo. Same
// muscle as ``primaryHalalSignal`` but tuned for the detail page
// (longer pill, more verbose because real estate isn't constrained).
// ---------------------------------------------------------------------------

const TIER_HEADLINE: Record<ValidationTier, string> = {
  TRUST_HALAL_VERIFIED: "Verified halal",
  CERTIFICATE_ON_FILE: "Halal certificate on file",
  SELF_ATTESTED: "Owner-attested halal",
};

const TIER_DESCRIPTION: Record<ValidationTier, string> = {
  TRUST_HALAL_VERIFIED:
    "A Trust Halal verifier visited and confirmed the halal info in person.",
  CERTIFICATE_ON_FILE:
    "The owner has a current halal certificate on file with us.",
  SELF_ATTESTED:
    "The owner submitted this info themselves. No third-party verification.",
};

const TIER_TONE: Record<ValidationTier, string> = {
  TRUST_HALAL_VERIFIED:
    "border-primary/40 bg-primary/10 text-foreground",
  CERTIFICATE_ON_FILE:
    "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50",
  SELF_ATTESTED:
    "border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
};

const MENU_POSTURE_HEADLINE: Record<MenuPosture, string> = {
  FULLY_HALAL: "Fully halal kitchen",
  MIXED_SEPARATE_KITCHENS: "Halal in a separate kitchen",
  HALAL_OPTIONS_ADVERTISED: "Halal options on the menu",
  HALAL_UPON_REQUEST: "Halal options on request",
  MIXED_SHARED_KITCHEN: "Halal options · shared kitchen",
};

const ALCOHOL_POLICY_LINE: Record<AlcoholPolicy, string> = {
  NONE: "No alcohol served",
  BEER_AND_WINE_ONLY: "Beer and wine served",
  FULL_BAR: "Full bar — beer, wine, spirits",
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
  return (
    <section
      aria-label="Halal trust summary"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <Headline profile={profile} />

      {profile.dispute_state !== "NONE" && (
        <DisputeBanner state={profile.dispute_state} />
      )}

      {!profile.seafood_only && <SlaughterGrid profile={profile} />}

      {profile.seafood_only && (
        <p className="text-sm text-muted-foreground">
          Seafood-only kitchen — no land meat or poultry served.
        </p>
      )}

      <PorkAndAlcohol profile={profile} />

      {profile.has_certification && (
        <CertificationRow profile={profile} />
      )}

      {profile.caveats && <Caveats text={profile.caveats} />}

      <FreshnessFooter profile={profile} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty-state when no halal profile exists. Same shape as the populated
// card so the page rhythm doesn't break.
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
        This restaurant hasn&rsquo;t been verified by Trust Halal. Owners
        can submit a halal claim through the owner portal.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Headline: tier + posture combined into one statement. The bordered
// callout's tone is driven by the validation tier so the visual carries
// trust ranking without a second badge to parse.
// ---------------------------------------------------------------------------
function Headline({ profile }: { profile: HalalProfileEmbed }) {
  const tier = TIER_HEADLINE[profile.validation_tier];
  const posture = MENU_POSTURE_HEADLINE[profile.menu_posture];
  const description = TIER_DESCRIPTION[profile.validation_tier];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        TIER_TONE[profile.validation_tier],
      )}
    >
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="text-base font-semibold leading-snug">
          {tier}
          <span className="font-normal opacity-80"> · {posture}</span>
        </p>
        <p className="text-sm leading-snug opacity-90">{description}</p>
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
      ? "A consumer reported this profile may be inaccurate. Trust Halal is reviewing."
      : "The owner is updating their halal info in response to a consumer report.";
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>{copy}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-meat slaughter grid. Single most-loaded section after the headline
// — Zabihah is the gold standard for many observant consumers and the
// per-meat granularity matters (a place might be Zabihah for chicken
// but machine for beef).
// ---------------------------------------------------------------------------
function SlaughterGrid({ profile }: { profile: HalalProfileEmbed }) {
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
// Pork + alcohol — two compact lines. Tight by design: each is a single
// sentence the consumer either takes as a green light or doesn't.
// ---------------------------------------------------------------------------
function PorkAndAlcohol({ profile }: { profile: HalalProfileEmbed }) {
  const lines: Array<{ icon: React.ReactNode; text: string }> = [
    {
      icon: (
        <span
          aria-hidden
          className={cn(
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            profile.has_pork
              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
          )}
        >
          {profile.has_pork ? "✕" : "✓"}
        </span>
      ),
      text: profile.has_pork ? "Pork is served" : "No pork on the menu",
    },
    {
      icon: (
        <Wine
          className={cn(
            "h-5 w-5 shrink-0",
            profile.alcohol_policy === "NONE"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400",
          )}
          aria-hidden
        />
      ),
      text: ALCOHOL_POLICY_LINE[profile.alcohol_policy],
    },
  ];

  if (profile.alcohol_in_cooking) {
    lines.push({
      icon: (
        <CircleAlert
          className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
      ),
      text: "Some dishes are cooked with alcohol (wine reductions, mirin, etc.).",
    });
  }

  return (
    <ul className="space-y-1.5 text-sm">
      {lines.map((line, i) => (
        <li key={i} className="flex items-center gap-2">
          {line.icon}
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Certifications — clickable row that opens a dialog with the cert
// metadata we have on file. The actual cert document URL isn't on the
// public embed yet; the dialog is structured so wiring it up is a one-
// line swap (the placeholder card becomes an <img>/<iframe>).
// ---------------------------------------------------------------------------
function CertificationRow({
  profile,
}: {
  profile: HalalProfileEmbed;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 text-left",
          "transition hover:border-foreground/30 hover:shadow-sm",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label="View halal certificate details"
      >
        <span className="flex min-w-0 items-start gap-3">
          <BadgeCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          <span className="min-w-0 space-y-0.5">
            <span className="block text-sm font-semibold">
              {profile.certifying_body_name
                ? `Certified by ${profile.certifying_body_name}`
                : "Halal certificate on file"}
            </span>
            {profile.certificate_expires_at && (
              <span className="block text-xs text-muted-foreground">
                Valid through{" "}
                {formatDateOnly(profile.certificate_expires_at)}
              </span>
            )}
          </span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground"
          aria-hidden
        />
      </button>

      <CertificateDialog
        open={open}
        onOpenChange={setOpen}
        profile={profile}
      />
    </>
  );
}

function CertificateDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  profile: HalalProfileEmbed;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Halal certification</DialogTitle>
          <DialogDescription>
            What Trust Halal has on file for this restaurant.
          </DialogDescription>
        </DialogHeader>

        <dl className="space-y-3 text-sm">
          {profile.certifying_body_name && (
            <Row label="Issued by">{profile.certifying_body_name}</Row>
          )}
          {profile.certificate_expires_at && (
            <Row label="Valid through">
              {formatDateOnly(profile.certificate_expires_at)}
            </Row>
          )}
          <Row label="Validation tier">
            {TIER_HEADLINE[profile.validation_tier]} —{" "}
            {TIER_DESCRIPTION[profile.validation_tier]}
          </Row>
        </dl>

        {/* The actual certificate document isn't on the public embed
            yet — backend slice TODO. The placeholder reserves the
            visual real estate so we don't have to redesign the dialog
            once the URL is wired in. */}
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            Certificate document
          </p>
          <p className="mt-1">
            Viewing the certificate file directly is coming soon.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-32 sm:shrink-0">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Owner-supplied caveats. Free-form so we render plain text on a soft
// callout — no markdown or rich text.
// ---------------------------------------------------------------------------
function Caveats({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-muted/40 p-3 text-sm">
      <CircleAlert
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Notes from the owner
        </p>
        <p className="whitespace-pre-line">{text}</p>
      </div>
    </div>
  );
}

function FreshnessFooter({ profile }: { profile: HalalProfileEmbed }) {
  return (
    <div className="flex items-start gap-1.5 border-t pt-3 text-xs text-muted-foreground">
      <CalendarClock
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        aria-hidden
      />
      <p>
        Last verified {formatDateRelative(profile.last_verified_at)}
        {profile.expires_at && (
          <>
            {" "}
            · re-verification due {formatDateOnly(profile.expires_at)}
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
