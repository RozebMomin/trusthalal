/**
 * The halal verdict, the one thing a diner came to this page for.
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
 *   1. **Banner**, what the kitchen is, in the largest type on the page,
 *      over a colour that encodes how well we know it.
 *   2. **Facts**, pork, alcohol, anything the owner flagged.
 *   3. **Meats**, only what's actually served.
 *   4. **Provenance**, who checked, when, and a way into the evidence.
 *
 * ## The one thing not to "simplify" later
 *
 * The headline says what the RESTAURANT claims; the colour and the sub-line
 * say how much PROOF we have. Those are deliberately separate. A self-attested
 * fully-halal kitchen and a verifier-inspected one make the identical claim
 * and are not the same fact, and this platform exists to keep that distinction
 * legible. A green banner on an unverified place would be the single most
 * damaging thing this component could do, it would launder the owner's word
 * into Trust Halal's endorsement.
 *
 * That's also why the banner never reads "safe to eat here". Safety is an
 * assertion we can only make at the verified tier, and even then it's the
 * evidence that's ours, not the guarantee.
 */
"use client";

import {
  AlertTriangle,
  Award,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  Info,
  ShieldCheck,
  Users,
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
  MeatProduct,
  MenuPosture,
  SlaughterMethod,
  SupplierProvenance,
  ValidationTier,
  ZabihahStatus,
} from "@/lib/api/hooks";
import { amenityBadgesFor } from "@/lib/amenities";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Headline, one sentence built from the tier + posture combo. Same
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
 * Banner fill. Encodes how much proof we hold, NOT how halal the place
 * claims to be. See the note at the top of this file before changing it, and
 * docs/brand-tier-colors.md for the canonical palette.
 *
 * One hue per tier: emerald 160°, amber 26°, slate 240°. This used to be
 * `bg-primary` over `emerald-700` over slate, two greens a shade apart at
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

/** The proof line under the headline, short, and always says who. */
const TIER_PROOF: Record<ValidationTier, string> = {
  TRUST_HALAL_VERIFIED: "A Trust Halal verifier checked this in person",
  CERTIFICATE_ON_FILE: "Halal certificate on file with us",
  SELF_ATTESTED: "The owner's own description, nobody has verified it",
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
  FULL_BAR: "Full bar, beer, wine, spirits",
};

const SLAUGHTER_LABELS: Record<SlaughterMethod, string> = {
  HAND_CUT: "Hand-slaughtered",
  MACHINE_CUT: "Machine-slaughtered",
  NOT_SERVED: "Not served",
  NOT_DISCLOSED: "Method not confirmed",
};

// Fully neutral: hand-slaughtered and machine-slaughtered get identical
// treatment, the label states the fact, the chip doesn't rank one above the
// other (per the redefinition doc: "present both as neutral facts"). Only
// "not served" is visually muted. "Method not confirmed" gets a soft amber
// so it reads as a caveat (served, but unverified) rather than a positive.
// Red-meat axis. Hand/machine doesn't apply to beef/lamb/goat; the restaurant
// declares zabihah status (optionally naming a certifying body). "Zabihah
// status unconfirmed" gets the same soft amber caveat as chicken's "Method not
// confirmed".
const RED_MEATS = new Set(["BEEF", "LAMB", "GOAT"]);

/** Species-aware label for a per-product method. Owners record hand/machine for
 *  every meat, but for red meat that maps to the zabihah axis (hand/machine →
 *  Zabihah; not disclosed → status unconfirmed). Chicken keeps hand/machine. */
function productMethodText(meatType: string, method: string): string {
  if (RED_MEATS.has(meatType)) {
    if (method === "HAND_CUT" || method === "MACHINE_CUT") return "Zabihah";
    if (method === "NOT_DISCLOSED") return "Zabihah status unconfirmed";
    return ZABIHAH_LABELS[method as ZabihahStatus] ?? method;
  }
  return SLAUGHTER_LABELS[method as SlaughterMethod] ?? method;
}

const ZABIHAH_LABELS: Record<ZabihahStatus, string> = {
  ZABIHAH: "Zabihah",
  NOT_ZABIHAH: "Not zabihah",
  UNSURE: "Zabihah status unconfirmed",
  NOT_SERVED: "Not served",
};
const ZABIHAH_TONE: Record<ZabihahStatus, string> = {
  ZABIHAH: "border-border bg-muted/30 text-foreground",
  NOT_ZABIHAH: "border-slate-200 bg-muted/40 text-muted-foreground",
  UNSURE: "border-amber-200 bg-amber-50 text-amber-800",
  NOT_SERVED: "border-slate-200 bg-muted/40 text-muted-foreground",
};

const SLAUGHTER_TONE: Record<SlaughterMethod, string> = {
  HAND_CUT: "border-border bg-muted/30 text-foreground",
  MACHINE_CUT: "border-border bg-muted/30 text-foreground",
  NOT_SERVED: "border-slate-200 bg-muted/40 text-muted-foreground",
  NOT_DISCLOSED: "border-amber-200 bg-amber-50 text-amber-800",
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
          proof level, see the note at the top of this file. */}
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

        {/* Two renderings, one DOM, switched at `sm` by CSS rather than by a
            media-query hook, this page is server-rendered, and reading the
            viewport in JS would mean the first paint is always the wrong one
            for somebody. `hidden` is display:none, so assistive tech is
            offered exactly one of these at any width, never both. */}

        {/* >=640px: unchanged. The fold below answers vertical space being
            scarce, and on a desktop it isn't, there is nothing to buy by
            hiding the pantry list, so it stays open. */}
        <div className="hidden sm:block">
          <KitchenAndPantry profile={profile} />
        </div>
        {/* <640px: exceptions only; confirmations move into the disclosure. */}
        <div className="sm:hidden">
          <KitchenExceptions profile={profile} />
        </div>

        {!profile.seafood_only &&
          ((profile.meat_products?.length ?? 0) > 0 ? (
            // One grouped list — the restaurant's products under each meat, with
            // the registry-backed cert + confidence on the header. Same at all
            // widths (no fold: the list is the substance, not overhead).
            <GroupedSourcing profile={profile} />
          ) : (
            // No product-level claim (community / verifier-visit place): render
            // the composed per-meat method + supplier in the SAME grouped-card
            // shape as the owner view, so the two surfaces look identical.
            <GroupedProvenanceSourcing profile={profile} />
          ))}

        {profile.seafood_only && (
          <p className="text-sm text-muted-foreground">
            Seafood-only kitchen, no land meat or poultry served.
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
// one sentence underneath. The information is identical, a diner looking for
// lamb still learns there isn't any, it just stops occupying the same visual
// weight as "beef is zabihah".
//
// Machine-slaughtered meat keeps its amber chip. That's a real distinction
// many observant diners care about and it must never quietly read as zabihah.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Supplier-backed sourcing. Additive to the slaughter grid above: when a served
// meat is traced to a registry supplier via a sourcing link, we say who and how
// well-evidenced it is. Method is NEUTRAL (no hand-vs-machine ranking); the
// confidence chip carries the honesty caveat, a self-stated link never gets a
// confirming treatment, matching the rest of the product. Only supplier-backed
// meats appear here; self-attested ones already live in the grid.
// ---------------------------------------------------------------------------
const PROVENANCE_METHOD_LABEL: Record<string, string> = {
  HAND_CUT: "hand-slaughtered",
  MACHINE_CUT: "machine-slaughtered",
  NOT_DISCLOSED: "method not disclosed",
  // Red-meat zabihah axis (composed value for beef/lamb/goat).
  ZABIHAH: "zabihah",
  NOT_ZABIHAH: "not zabihah",
  UNSURE: "zabihah status unconfirmed",
};

function provenanceMeatLabel(meat: string): string {
  return meat.charAt(0) + meat.slice(1).toLowerCase();
}

function ConfidenceChip({
  confidence,
  ownerAttested,
}: {
  confidence: "SELF_STATED" | "DOCUMENTED" | "VERIFIED";
  ownerAttested: boolean;
}) {
  const map = {
    VERIFIED: {
      label: "verified",
      cls: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
    },
    DOCUMENTED: {
      label: "documented",
      cls: "border-sky-500/40 text-sky-700 dark:text-sky-400",
    },
    SELF_STATED: {
      // Weakest tier: attribute it to whoever the source actually is. An
      // owner-claimed place is the owner's word; an unclaimed one was
      // established by a verifier / the community.
      label: ownerAttested ? "as stated by the owner" : "reported by the community",
      cls: "border-border text-muted-foreground",
    },
  } as const;
  const { label, cls } = map[confidence];
  return (
    <span className={cn("rounded-full border px-1.5 py-0.5 text-[11px]", cls)}>
      {label}
    </span>
  );
}

function SupplierBackedSourcing({ profile }: { profile: HalalProfileEmbed }) {
  const backed = (profile.supplier_provenance ?? []).filter(
    (p) => p.source === "supplier",
  );
  if (backed.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5 rounded-md border bg-muted/20 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Supplier sourcing
      </p>
      <ul className="space-y-1 text-sm">
        {backed.map((p) => (
          <li key={p.meat_type} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <span className="font-medium">{provenanceMeatLabel(p.meat_type)}</span>
            <span>{PROVENANCE_METHOD_LABEL[p.method] ?? p.method}</span>
            {p.supplier_name && (
              <span className="text-muted-foreground">· {p.supplier_name}</span>
            )}
            {p.certifying_body_name && (
              <span className="text-muted-foreground">
                · certified by {p.certifying_body_name}
              </span>
            )}
            <ConfidenceChip
              confidence={p.confidence}
              ownerAttested={profile.owner_attested ?? false}
            />
            {p.as_of && (
              <span className="text-xs text-muted-foreground">
                · as of{" "}
                {new Date(p.as_of).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Order meats appear in the grouped sourcing view.
const SOURCING_MEAT_ORDER = [
  "CHICKEN",
  "TURKEY",
  "DUCK",
  "BEEF",
  "LAMB",
  "GOAT",
  "FISH",
  "OTHER",
];
// Core meats with a profile column, for the "not served" footnote.
const CORE_MEATS: ReadonlyArray<{ key: string; label: string; col: keyof HalalProfileEmbed }> = [
  { key: "CHICKEN", label: "chicken", col: "chicken_slaughter" },
  { key: "BEEF", label: "beef", col: "beef_zabihah" },
  { key: "LAMB", label: "lamb", col: "lamb_zabihah" },
  { key: "GOAT", label: "goat", col: "goat_zabihah" },
];

/**
 * The single sourcing view: every product the restaurant listed, grouped under
 * its meat, with the registry-backed cert + confidence on the group header.
 * Replaces the old per-product list + separate composed box, which duplicated
 * the same data and collapsed multiple suppliers for one meat into one row.
 */
function GroupedSourcing({ profile }: { profile: HalalProfileEmbed }) {
  const products = profile.meat_products ?? [];
  if (products.length === 0) return null;

  // Registry-backed signal per meat (a live supplier link composed it).
  const provByMeat = new Map<string, SupplierProvenance>();
  for (const p of profile.supplier_provenance ?? []) {
    if (p.source === "supplier") provByMeat.set(p.meat_type, p);
  }

  const groups = SOURCING_MEAT_ORDER.map((meat) => ({
    meat,
    items: products.filter((p) => p.meat_type === meat),
  })).filter((g) => g.items.length > 0);

  // "lamb, goat aren't served here" — core meats with no product and a
  // NOT_SERVED column.
  const absent = CORE_MEATS.filter(
    (m) =>
      String(profile[m.col]) === "NOT_SERVED" &&
      !products.some((p) => p.meat_type === m.key),
  ).map((m) => m.label);

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Meat sourcing
      </p>
      <div className="space-y-2">
        {groups.map((g) => {
          const prov = provByMeat.get(g.meat);
          return (
            <div key={g.meat} className="overflow-hidden rounded-md border">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b bg-muted/40 px-2.5 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {provenanceMeatLabel(g.meat)}
                </span>
                {prov && (
                  <ConfidenceChip
                    confidence={prov.confidence}
                    ownerAttested={profile.owner_attested ?? false}
                  />
                )}
              </div>
              <ul>
                {g.items.map((p, i) => {
                  const where = [p.supplier_city, p.supplier_state]
                    .filter(Boolean)
                    .join(", ");
                  const supplierLine = [p.supplier_name, where]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li
                      key={`${p.product_name}-${i}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-t border-border/60 px-2.5 py-2 first:border-t-0"
                    >
                      <span className="text-sm font-medium">{p.product_name}</span>
                      <span className="shrink-0 text-xs font-semibold">
                        {productMethodText(p.meat_type, p.slaughter_method)}
                      </span>
                      {supplierLine && (
                        <span className="w-full text-xs text-muted-foreground">
                          {supplierLine}
                        </span>
                      )}
                      {p.certifying_authority && (
                        <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <ShieldCheck className="h-3 w-3" />
                          {p.certifying_authority}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {absent.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {absent.join(", ")}
          {absent.length === 1 ? " isn't" : " aren't"} served here.
        </p>
      )}
    </div>
  );
}

/**
 * The no-owner fallback (community / verifier-visit places with no product-level
 * claim), rendered in the SAME grouped-card shape as GroupedSourcing. There are
 * no per-product rows here — only the composed per-meat method + supplier — so
 * each meat card holds a single row, but the look matches the owner view.
 */
function GroupedProvenanceSourcing({ profile }: { profile: HalalProfileEmbed }) {
  const provByMeat = new Map<string, SupplierProvenance>();
  for (const p of profile.supplier_provenance ?? []) {
    if (p.source === "supplier") provByMeat.set(p.meat_type, p);
  }

  // Method per column meat, and which are served.
  const methodByMeat = new Map<string, string>();
  const served = new Set<string>();
  const chickenServed = profile.chicken_slaughter !== "NOT_SERVED";
  methodByMeat.set(
    "CHICKEN",
    SLAUGHTER_LABELS[profile.chicken_slaughter] ?? profile.chicken_slaughter,
  );
  if (chickenServed) served.add("CHICKEN");
  for (const m of ["beef", "lamb", "goat"] as const) {
    const status = profile[`${m}_zabihah`];
    methodByMeat.set(m.toUpperCase(), ZABIHAH_LABELS[status] ?? status);
    if (status !== "NOT_SERVED") served.add(m.toUpperCase());
  }
  // Supplier-linked meats without a column (turkey, duck, …) are served too.
  for (const meat of provByMeat.keys()) served.add(meat);

  const groups = SOURCING_MEAT_ORDER.filter((m) => served.has(m));
  if (groups.length === 0) return null;

  const absent = CORE_MEATS.filter(
    (m) => String(profile[m.col]) === "NOT_SERVED" && !served.has(m.key),
  ).map((m) => m.label);

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Meat sourcing
      </p>
      <div className="space-y-2">
        {groups.map((meat) => {
          const prov = provByMeat.get(meat);
          const methodText =
            methodByMeat.get(meat) ??
            (prov ? productMethodText(meat, prov.method) : "");
          return (
            <div key={meat} className="overflow-hidden rounded-md border">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b bg-muted/40 px-2.5 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {provenanceMeatLabel(meat)}
                </span>
                {prov && (
                  <ConfidenceChip
                    confidence={prov.confidence}
                    ownerAttested={profile.owner_attested ?? false}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-2.5 py-2">
                <span className="text-sm font-medium">{methodText}</span>
                {prov?.supplier_name && (
                  <span className="w-full text-xs text-muted-foreground">
                    {prov.supplier_name}
                  </span>
                )}
                {prov?.certifying_body_name && (
                  <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="h-3 w-3" />
                    {prov.certifying_body_name}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {absent.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {absent.join(", ")}
          {absent.length === 1 ? " isn't" : " aren't"} served here.
        </p>
      )}
    </div>
  );
}

function ServedMeats({ profile }: { profile: HalalProfileEmbed }) {
  // Chicken uses the hand/machine axis; beef/lamb/goat use the zabihah axis.
  const rows: Array<{ label: string; text: string; tone: string; served: boolean; zabihah: boolean }> = [
    {
      label: "Chicken",
      text: SLAUGHTER_LABELS[profile.chicken_slaughter] ?? profile.chicken_slaughter,
      tone: SLAUGHTER_TONE[profile.chicken_slaughter],
      served: profile.chicken_slaughter !== "NOT_SERVED",
      zabihah: false,
    },
    ...(["beef", "lamb", "goat"] as const).map((m) => {
      const status = profile[`${m}_zabihah`];
      return {
        label: m.charAt(0).toUpperCase() + m.slice(1),
        text: ZABIHAH_LABELS[status] ?? status,
        tone: ZABIHAH_TONE[status],
        served: status !== "NOT_SERVED",
        zabihah: status === "ZABIHAH",
      };
    }),
  ];

  const served = rows.filter((r) => r.served);
  const absent = rows.filter((r) => !r.served);
  // Attributed certifying body for zabihah red meat (relayed, not verified).
  const zabihahBody =
    rows.some((r) => r.zabihah) && profile.certifying_body_name
      ? profile.certifying_body_name
      : null;

  // Prefer the per-product list when the restaurant supplied one. The rollup
  // above is least-conservative-wins, so a kitchen with zabihah breast and
  // machine nuggets reports MACHINE for all chicken, the safe direction to
  // round, but it leaves a diner unable to see which product is which. It
  // also covers turkey, duck and fish, which have no profile column and are
  // otherwise invisible entirely.
  const products = profile.meat_products ?? [];
  if (products.length > 0) {
    return <ServedProducts products={products} absent={absent} />;
  }

  // Nothing on the list is served and it isn't a seafood kitchen, say so
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
              row.tone,
            )}
          >
            <span className="opacity-75">{row.label}</span>
            <span className="font-semibold">{row.text}</span>
          </li>
        ))}
      </ul>
      {zabihahBody && (
        <p className="text-xs text-muted-foreground">
          Zabihah meat certified by {zabihahBody}, as stated by the restaurant.
        </p>
      )}
      {absent.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {absent.map((r) => r.label.toLowerCase()).join(", ")}
          {absent.length === 1 ? " isn't" : " aren't"} served here.
        </p>
      )}
    </div>
  );
}


/**
 * Per-product sourcing: what the restaurant serves, and where they say it
 * comes from.
 *
 * ## The attribution is the whole point
 *
 * "Chicken · Zabihah" with nothing behind it asks to be taken on faith,
 * which is the one thing this platform exists not to do. But the fix isn't
 * to state the supplier as fact, nobody has checked it. Verifier visits
 * record observations as free text, so there is no structured confirmation
 * that a named supplier is real or that the restaurant actually buys from
 * them.
 *
 * So the supplier line is explicitly framed as the restaurant's own account,
 * set muted, and placed under the product rather than beside it. A reader
 * should be able to tell at a glance which half we stand behind and which
 * half we're relaying. Presenting the supplier flatly would launder the
 * owner's word into our finding, the same mistake as a green banner on a
 * self-attested place, which the note at the top of this file exists to
 * prevent.
 */
function ServedProducts({
  products,
  absent,
}: {
  products: MeatProduct[];
  absent: Array<{ label: string }>;
}) {
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {products.map((p, i) => {
          const where = [p.supplier_city, p.supplier_state]
            .filter(Boolean)
            .join(", ");
          return (
            <li
              key={`${p.product_name}-${i}`}
              className={cn(
                "rounded-md border px-2.5 py-2",
                SLAUGHTER_TONE[p.slaughter_method],
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{p.product_name}</span>
                <span className="shrink-0 text-xs font-semibold">
                  {productMethodText(p.meat_type, p.slaughter_method)}
                </span>
              </div>
              {p.supplier_name ? (
                <p className="mt-0.5 text-xs opacity-75">
                  Restaurant says: {p.supplier_name}
                  {where && ` · ${where}`}
                  {p.certifying_authority &&
                    ` · certified by ${p.certifying_authority}`}
                </p>
              ) : (
                /* Silence here would read as "supplier withheld". This reads
                   as "we asked and they left it blank", which is both true
                   and itself worth knowing. */
                <p className="mt-0.5 text-xs opacity-60">No supplier listed</p>
              )}
            </li>
          );
        })}
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
// Kitchen + pantry summary, the menu-posture line followed by the
// pork and alcohol lines. Three to four compact rows, each a single
// sentence the consumer can scan as a yes/no signal.
//
// Menu posture leads here (used to be a clause on the headline) so the
// "what kind of halal kitchen is this?" question gets answered before
// the line-item details below.
// ---------------------------------------------------------------------------

function KitchenAndPantry({ profile }: { profile: HalalProfileEmbed }) {
  // Menu posture is NOT repeated here, it's the banner headline above. It
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
      // ``WineOff`` is a wine glass with a strikethrough, reads as
      // "no alcohol" at a glance. Plain ``Wine`` keeps the served
      // states recognizable as a wine glass (the glass is the carrier
      // signal, strike vs. not is the polarity bit).
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

// ---------------------------------------------------------------------------
// Phone-width disclosure (<640px)
//
// Everything below renders only under `sm:hidden`. The desktop card is
// deliberately untouched: the fold exists because a phone has ~600px of
// vertical space and this card was spending three lines of it confirming what
// the banner already implied, then pushing the meat sourcing, the part people
// came for, below the fold. A desktop card is not making that trade, so it
// does not get the fix for it.
// ---------------------------------------------------------------------------

/**
 * The rule that keeps "concise" from turning into "evasive".
 *
 * Confirmations fold into the disclosure; exceptions never do. Anything amber
 * or red renders here at full size whatever it costs in height, because an app
 * that goes quietest about the facts a diner most needs has been made to read
 * clean by withholding. Folding good news is editing. Folding bad news is
 * lying by layout.
 *
 * One thing that is not a confirmation: "no pork" at a kitchen that is not
 * fully halal. "Fully halal kitchen" entails it, so repeating it there is
 * noise, but nothing entails it at a shared or options-only kitchen, where it
 * is real news and stays visible.
 */
function KitchenExceptions({ profile }: { profile: HalalProfileEmbed }) {
  const alcohol = profile.alcohol_policy !== "NONE";
  const parts: string[] = [];
  if (profile.has_pork) parts.push("Pork is served");
  if (alcohol) parts.push(ALCOHOL_POLICY_LINE[profile.alcohol_policy]);
  if (profile.alcohol_in_cooking) parts.push("Alcohol used in some cooking");

  if (parts.length > 0) {
    const severe = profile.has_pork;
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-md px-3 py-2.5 text-sm",
          severe
            ? "bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-200"
            : "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
        )}
      >
        {severe ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        )}
        <span>{parts.join(" · ")}</span>
      </div>
    );
  }

  if (profile.menu_posture !== "FULLY_HALAL") {
    return (
      <p className="flex items-center gap-2 text-sm">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        >
          ✓
        </span>
        <span>No pork on the menu</span>
      </p>
    );
  }

  return null;
}

/** The good news, shown inside the disclosure. Nothing is removed from the
 *  page, only demoted, so a reader who wants to confirm still can. */
function KitchenConfirmations({ profile }: { profile: HalalProfileEmbed }) {
  const lines: string[] = [];
  if (!profile.has_pork && profile.menu_posture === "FULLY_HALAL") {
    lines.push("No pork on the menu");
  }
  if (profile.alcohol_policy === "NONE") lines.push("No alcohol served");
  if (lines.length === 0) return null;

  return (
    <ul className="space-y-1.5 text-sm text-muted-foreground">
      {lines.map((line) => (
        <li key={line} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          >
            ✓
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function sentenceCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type MeatSummary = { text: string; machine: boolean; collapsible: boolean };

/**
 * One line standing in for the whole meat block.
 *
 * `machine` is true whenever ANY item is machine-slaughtered, deliberately.
 * A summary that averaged to green would let "6 products" read as uniformly
 * fine while two of them were not, the exact rounding error the per-product
 * data was added to fix.
 *
 * `collapsible` is false when a slaughter method arrives that this build does
 * not recognise. The union type is closed at compile time and the API is not,
 * so rather than fold an unknown into "zabihah" and state something we cannot
 * support, the section gives up on summarising and renders itself open.
 */
function meatSummary(profile: HalalProfileEmbed): MeatSummary {
  const known = (m: string) => m === "HAND_CUT" || m === "MACHINE_CUT";
  const products = profile.meat_products ?? [];

  if (products.length > 0) {
    // Red-meat products are on the zabihah axis, not hand/machine — don't fold
    // two axes into one count; render open so each product shows its own label.
    if (products.some((p) => RED_MEATS.has(p.meat_type))) {
      return { text: "Meat sourcing", machine: true, collapsible: false };
    }
    if (!products.every((p) => known(p.slaughter_method))) {
      return { text: "Meat sourcing", machine: true, collapsible: false };
    }
    const machine = products.filter(
      (p) => p.slaughter_method === "MACHINE_CUT",
    ).length;
    const hand = products.length - machine;
    const n = `${products.length} product${products.length === 1 ? "" : "s"}`;
    if (machine === 0)
      return { text: `${n} · all hand-cut`, machine: false, collapsible: true };
    if (hand === 0)
      return { text: `${n} · all machine-cut`, machine: true, collapsible: true };
    return {
      text: `${n} · ${hand} hand-cut, ${machine} machine-cut`,
      machine: true,
      collapsible: true,
    };
  }

  // Chicken uses the hand/machine axis; beef/lamb/goat use the zabihah axis.
  // Two axes don't fold into one tidy summary, so when red meat is served we
  // don't try — we render the section open (ServedMeats shows each correctly).
  const chicken = profile.chicken_slaughter;
  const chickenServed = chicken !== "NOT_SERVED";
  const redServed = (["beef", "lamb", "goat"] as const).some(
    (m) => profile[`${m}_zabihah`] !== "NOT_SERVED",
  );

  if (!chickenServed && !redServed) {
    return {
      text: "No chicken, beef, lamb or goat served",
      machine: false,
      collapsible: false,
    };
  }
  if (redServed) {
    return { text: "Meat sourcing", machine: true, collapsible: false };
  }
  // Chicken-only: summarise its method.
  if (!known(chicken)) {
    return { text: "Meat sourcing", machine: true, collapsible: false };
  }
  return chicken === "HAND_CUT"
    ? { text: "Chicken · hand-cut", machine: false, collapsible: true }
    : { text: "Chicken · machine-cut", machine: true, collapsible: true };
}

/**
 * The summary doubles as the disclosure control.
 *
 * What you click is the fact you came for, not a generic "Details", so the
 * row earns its height whether or not anyone opens it, and mixed sourcing,
 * the case that actually rewards a click, says so before you click.
 *
 * The trigger is labelled "Sources" rather than left as a bare chevron: this
 * line reads like a finished sentence, and nothing about "all zabihah"
 * suggests there is more behind it.
 */
function MeatDisclosure({ profile }: { profile: HalalProfileEmbed }) {
  const summary = meatSummary(profile);
  const [open, setOpen] = React.useState(!summary.collapsible);
  const panelId = React.useId();

  const detail = (
    <div className="mt-2.5 space-y-3">
      <ServedMeats profile={profile} />
      <SupplierBackedSourcing profile={profile} />
      <KitchenConfirmations profile={profile} />
    </div>
  );

  if (!summary.collapsible) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">{summary.text}</p>
        {detail}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        <Award
          className={cn(
            "h-4 w-4 shrink-0",
            summary.machine
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400",
          )}
          aria-hidden
        />
        <span className="flex-1">{summary.text}</span>
        <span className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-400">
          {open ? "Hide" : "Sources"}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      <div id={panelId} hidden={!open}>
        {detail}
      </div>
    </div>
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
            {TIER_HEADLINE[profile.validation_tier]},{" "}
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
 * When the URL is null (cert not yet copied to the public bucket,
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

  // Unknown MIME, render a clean call-to-action that lets the
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
// Family-amenity card. Convenience signals (prayer space, wudu, bidet, baby
// changing) a place positively offers. Its OWN section on the detail page (a
// sibling of the trust summary, not nested inside it) — these are facility
// conveniences, not part of the halal verdict, so they shouldn't ride inside
// the verdict card. Same YES / ON_REQUEST rule and labels as the search-result
// card. Renders nothing when there's no positive amenity signal.
// ---------------------------------------------------------------------------
export function PlaceFamilyAmenities({
  profile,
}: {
  profile: HalalProfileEmbed | null | undefined;
}) {
  const badges = amenityBadgesFor(profile);
  if (badges.length === 0) return null;
  return (
    <section
      aria-label="Family amenities"
      className="space-y-2 rounded-xl border bg-card p-4 shadow-sm"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Users className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        For families
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {badges.map((label) => (
          <span
            key={label}
            className="inline-flex items-center rounded-md border border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-foreground/80"
          >
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Owner-supplied caveats. Free-form so we render plain text on a soft
// callout, no markdown or rich text.
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
 * Who checked this, when, and a way into the evidence, one line.
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
