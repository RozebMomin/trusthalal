/**
 * Apex hero block shown above the search surface.
 *
 * Two jobs: stake the category claim, and back it in one sentence.
 * Voice is deliberately authoritative — Trust Halal is positioned as
 * the record of halal, not one more listings site:
 *
 *   * Large display type so "The last word on halal." reads as a
 *     category claim, not a header.
 *   * The subhead earns the claim with specifics (certificate,
 *     slaughter method, menu, disputes) — authority through rigor,
 *     not adjectives.
 *   * The compact form (post-search) trims to the name plus a
 *     one-line positioning tag so results stay above the fold.
 *
 * The marketing-y "claim your listing" line moved off the home
 * surface — it lives on the AppShell footer / a future CTA strip.
 * Owners aren't the audience here; diners are.
 */

import { BRAND_NAME } from "@/lib/branding";

type Props = {
  /** When true, render a compact hero — used after the user types a
   *  query so search results stay above the fold. */
  compact?: boolean;
};

export function SiteHero({ compact = false }: Props) {
  if (compact) {
    return (
      <header className="flex items-baseline justify-between gap-3 pt-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {BRAND_NAME}
        </h1>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          The source of truth for halal
        </p>
      </header>
    );
  }

  return (
    <header className="space-y-3 pt-2 sm:pt-8">
      <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
        The last word
        <br className="sm:hidden" />{" "}
        on <span className="text-primary">halal.</span>
      </h1>
      <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
        Every restaurant, every claim — checked against the certificate,
        the slaughter method, the menu, and any open disputes. The full
        record, before you eat.
      </p>
    </header>
  );
}
