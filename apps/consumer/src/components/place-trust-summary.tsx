/**
 * The halal verdict — the one thing a diner came to this page for.
 *
 * ## What changed and why
 *
 * This used to be five stacked blocks inside one card: a tier headline, a
 * kitchen/pantry list, a certification row, a four-tile slaughter grid, and a
 * freshness footer. Each was individually reasonable; together they said the
 * same thing four times ("Halal certified" / "certificate on file" /
 * "Certified by HMS" / "last verified 7 days ago") across ~260px of scroll,
 * with no single line that answered "can I eat here?".
 *
 * Now it's one block with a fixed shape:
 *
 *   1. **Banner** — what the kitchen is, in the largest type on the page,
 *      over a colour that encodes how well we know it.
 *   2. **Facts** — pork, alcohol, anything the owner flagged.
 *   3. **Meats** — only what's actually served.
 *   4. **Provenance** — who checked, when, and a way into the evidence.
 *
 * ## The one thing not to "simplify" later
 *
 * The headline says what the RESTAURANT claims; the colour and the sub-line
 * say how much PROOF we have. Those are deliberately separate. A self-attested
 * fully-halal kitchen and a verifier-inspected one make the identical claim
 * and are not the same fact, and this platform exists to keep that distinction
 * legible. A green banner on an unverified place would be the single most
 * damaging thing this component could do — it would launder the owner's word
 * into Trust Halal's endorsement.
 *
 * That's also why the banner never reads "safe to eat here". Safety is an
 * assertion we can only make at the verified tier, and even then it's the
 * evidence that's ours, not the guarantee.
 */
"use client";

import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Info,
  ShieldCheck,
  Wine,
  WineOff,
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

/**
 * Banner fill. Encodes how much proof we hold — NOT how halal the place
 * claims to be. See the note at the top of this file before changing it, and
 * docs/brand-tier-colors.md for the canonical palette.
 *
 * One hue per tier: emerald 160°, amber 26°, slate 240°. This used to be
 * `bg-primary` over `emerald-700` over slate — two greens a shade apart at
 * the top, which is a severity ramp. A ramp only works if you can see both
 * ends at once, and nobody ever does: a diner opens one restaurant and gets
 * one banner. The amber matches the pill this same place already wears on the
 * search card and the map pin, so the colour survives the tap instead of
 * changing family halfway through the journey.
 */
const TIER_BANNER: Record<ValidationTier, string> = {
  // Deeper than `bg-primary`: white on the brand emerald is 3.39:1, which
  // the ~14px proof sub-line under the headline fails. 5.48:1 here.
  TRUST_HALAL_VERIFIED: "bg-emerald-700 text-white dark:bg-emerald-800",
  CERTIFICATE_ON_FILE: "bg-amber-700 text-white dark:bg-amber-800",
  // Deliberately not green, not even a pale one. Nobody has checked this.
  SELF_ATTESTED: "bg-slate-700 text-white dark:bg-slate-800",
};

/** Border of the whole block, matched to the banner. */
const TIER_EDGE: Record<ValidationTier, string> = {
  TRUST_HALAL_VERIFIED: "border-emerald-700 dark:border-emerald-800",
  CERTIFICATE_ON_FILE: "border-amber-700 dark:border-amber-800",
  SELF_ATTESTED: "border-slate-700 dark:border-slate-800",
};

/** The proof line under the headline — short, and always says who. */
const TIER_PROOF: Record<ValidationTier, string> = {
  TRUST_HALAL_VERIFIED: "A Trust Halal verifier checked this in person",
  CERTIFICATE_ON_FILE: "Halal certificate on file with us",
  SELF_ATTESTED: "The owner's own description — nobody has verified it",
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
      aria-label="Halal verdict"
      className={cn(
        "overflow-hidden rounded-xl border-2 shadow-sm",
        TIER_EDGE[profile.validation_tier],
      )}
    >
      {/* The claim, in the largest type on the page. Colour behind it is the
          proof level — see the note at the top of this file. */}
      <div className={cn("px-5 py-4", TIER_BANNER[profile.validation_tier])}>
        <h2 className="flex items-start gap-2.5 text-lg font-bold leading-tight tracking-tight sm:text-xl">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>{MENU_POSTURE_HEADLINE[profile.menu_posture]}</span>
        </h2>
        <p className="mt-1 pl-[30px] text-sm opacity-90">
          {TIER_PROOF[profile.validation_tier]}
        </p>
      </div>

      <div className="space-y-3 bg-card p-5">
        {profile.dispute_state !== "NONE" && (
          <DisputeBanner state={profile.dispute_state} />
        )}

        <KitchenAndPantry profile={profile} />

        {!profile.seafood_only && <ServedMeats profile={profile} />}

        {profile.seafood_only && (
          <p className="text-sm text-muted-foreground">
            Seafood-only kitchen — no land meat or poultry served.
          </p>
        )}

        {profile.caveats && <Caveats text={profile.caveats} />}

        <ProvenanceFooter profile={profile} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty-state when no halal profile exists. Same shape as the populated
// card so the page rhythm doesn't break.
// ---------------------------------------------------------------------------
export function PlaceNoTrustSummary() {
  return (
    <section className="rounded-xl border-2 border-dashed bg-muted/30 p-6 text-center">
      <Info
        className="mx-auto h-6 w-6 text-muted-foreground/70"
        aria-hidden
      />
      <p className="mt-3 text-sm font-medium text-foreground">
        No halal information yet
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Nobody has told us how this kitchen works, so we can&rsquo;t say
        anything about it either way. If you own this restaurant, you can add
        your halal details.
      </p>
    </section>
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
// What's actually served, and how it was slaughtered.
//
// The old version was a four-tile grid always showing chicken / beef / lamb /
// goat. On a typical place two of those read "Not served", so half of the most
// important widget on the page was spent rendering the absence of a fact in a
// bordered box the same size as a real one.
//
// Now: served meats get a chip each, and everything not served collapses into
// one sentence underneath. The information is identical — a diner looking for
// lamb still learns there isn't any — it just stops occupying the same visual
// weight as "beef is zabihah".
//
// Machine-slaughtered meat keeps its amber chip. That's a real distinction
// many observant diners care about and it must never quietly read as zabihah.
// ---------------------------------------------------------------------------
function ServedMeats({ profile }: { profile: HalalProfileEmbed }) {
  const rows: Array<{ label: string; method: SlaughterMethod }> = [
    { label: "Chicken", method: profile.chicken_slaughter },
    { label: "Beef", method: profile.beef_slaughter },
    { label: "Lamb", method: profile.lamb_slaughter },
    { label: "Goat", method: profile.goat_slaughter },
  ];

  const served = rows.filter((r) => r.method !== "NOT_SERVED");
  const absent = rows.filter((r) => r.method === "NOT_SERVED");

  // Nothing on the list is served and it isn't a seafood kitchen — say so
  // plainly rather than rendering an empty row.
  if (served.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No chicken, beef, lamb or goat is served here.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <ul className="flex flex-wrap gap-1.5">
        {served.map((row) => (
          <li
            key={row.label}
            className={cn(
              "inline-flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 text-sm",
              SLAUGHTER_TONE[row.method],
            )}
          >
            <span className="opacity-75">{row.label}</span>
            <span className="font-semibold">
              {SLAUGHTER_LABELS[row.method] ?? row.method}
            </span>
          </li>
        ))}
      </ul>
      {absent.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {absent.map((r) => r.label.toLowerCase()).join(", ")}
          {absent.length === 1 ? " isn't" : " aren't"} served here.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kitchen + pantry summary — the menu-posture line followed by the
// pork and alcohol lines. Three to four compact rows, each a single
// sentence the consumer can scan as a yes/no signal.
//
// Menu posture leads here (used to be a clause on the headline) so the
// "what kind of halal kitchen is this?" question gets answered before
// the line-item details below.
// ---------------------------------------------------------------------------

function KitchenAndPantry({ profile }: { profile: HalalProfileEmbed }) {
  // Menu posture is NOT repeated here — it's the banner headline above. It
  // used to lead this list back when the banner said something else, and
  // leaving it would print the same sentence twice, 40px apart.
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
      // ``WineOff`` is a wine glass with a strikethrough — reads as
      // "no alcohol" at a glance. Plain ``Wine`` keeps the served
      // states recognizable as a wine glass (the glass is the carrier
      // signal — strike vs. not is the polarity bit).
      icon:
        profile.alcohol_policy === "NONE" ? (
          <WineOff
            className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
        ) : (
          <Wine
            className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
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
      <DialogContent className="sm:max-w-lg">
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

        <CertificateViewer profile={profile} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Render the cert document itself when we have one. Branches on the
 * MIME type the API stored alongside the URL:
 *
 *   * ``image/*``        → inline <img> (works for jpg / png / heic
 *                          once the upload pipeline supports it).
 *   * ``application/pdf`` → embedded <iframe> so the consumer can
 *                          flip pages without leaving the dialog.
 *                          The browser's native PDF viewer carries
 *                          a download button if needed.
 *   * anything else      → "Open certificate" link that lets the
 *                          browser handle the unknown type natively.
 *
 * When the URL is null (cert not yet copied to the public bucket —
 * approval failed, profile predates the cert-publish backend slice,
 * etc.) the visitor still sees the metadata above; the viewer falls
 * back to a small "viewer coming soon" callout so the dialog feels
 * complete instead of empty.
 */
function CertificateViewer({
  profile,
}: {
  profile: HalalProfileEmbed;
}) {
  const url = profile.certificate_url;
  const ct = profile.certificate_content_type ?? "";

  if (!url) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          Certificate document
        </p>
        <p className="mt-1">
          The certificate file isn&rsquo;t available to view yet.
          Trust Halal staff can request a fresh copy from the owner.
        </p>
      </div>
    );
  }

  if (ct.startsWith("image/")) {
    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-lg border bg-muted/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Halal certificate"
            loading="eager"
            decoding="async"
            className="block h-auto w-full"
          />
        </div>
        <CertificateOpenLink url={url} />
      </div>
    );
  }

  if (ct === "application/pdf") {
    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-lg border bg-muted/20">
          <iframe
            src={url}
            title="Halal certificate"
            // 16:11ish keeps a typical letter-size cert page legible
            // inside the dialog without dominating the viewport.
            className="h-[420px] w-full"
          />
        </div>
        <CertificateOpenLink url={url} />
      </div>
    );
  }

  // Unknown MIME — render a clean call-to-action that lets the
  // browser handle the file natively.
  return <CertificateOpenLink url={url} prominent />;
}

function CertificateOpenLink({
  url,
  prominent = false,
}: {
  url: string;
  prominent?: boolean;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        prominent
          ? "rounded-md border bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      Open certificate in a new tab
    </a>
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

/**
 * Who checked this, when, and a way into the evidence — one line.
 *
 * Replaces two separate blocks (a full-width "Certified by X ›" button and a
 * bordered "Last verified N days ago" footer). They were always answering the
 * same question, and splitting them meant the page said "we checked" twice
 * without either one being a complete answer.
 */
function ProvenanceFooter({ profile }: { profile: HalalProfileEmbed }) {
  const [certOpen, setCertOpen] = React.useState(false);

  const checked = formatDateRelative(profile.last_verified_at);
  const issuer = profile.certifying_body_name;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {issuer ? (
              <>
                Certified by{" "}
                <span className="font-medium text-foreground">{issuer}</span> ·{" "}
              </>
            ) : null}
            Checked {checked}
            {profile.expires_at && (
              <> · due again {formatDateOnly(profile.expires_at)}</>
            )}
          </span>
        </span>

        {/* Only offered when there's something to look at. A button that opens
            a dialog saying "no document" is worse than no button. */}
        {profile.has_certification && (
          <button
            type="button"
            onClick={() => setCertOpen(true)}
            className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
          >
            See the evidence
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <CertificateDialog
        open={certOpen}
        onOpenChange={setCertOpen}
        profile={profile}
      />
    </>
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
