/**
 * Apex hero block shown above the search surface.
 *
 * Two jobs: announce the brand, and explain the value prop in one
 * sentence. Aesthetic-pass refresh:
 *
 *   * Larger display type (44px on desktop, 32px on mobile) so the
 *     name reads as a brand statement, not a header.
 *   * Tighter copy. "Verified halal, no guesswork." is the new
 *     tagline-on-the-page — concrete, no jargon. Followed by a
 *     short subhead that explains what makes us different
 *     ("verified" not "listed").
 *   * The compact form (post-search) trims to a single line so
 *     results stay above the fold.
 *
 * The marketing-y "claim your listing" line moved off the home
 * surface — it lives on the AppShell footer / a future CTA strip.
 * Owners aren't the audience here; diners are.
 */

import {
  BRAND_NAME,
  TRUST_HALAL_URL,
} from "@/lib/branding";

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
        <p className="text-[11px] text-muted-foreground">
          Powered by{" "}
          <a
            href={TRUST_HALAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            Trust Halal
          </a>
        </p>
      </header>
    );
  }

  return (
    <header className="space-y-3 pt-2 sm:pt-8">
      <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
        Verified halal,
        <br className="sm:hidden" />{" "}
        <span className="text-primary">no guesswork.</span>
      </h1>
      <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
        Find restaurants where the halal claim has been confirmed —
        with the slaughter method, certificate, and any open disputes
        all visible up front.
      </p>
    </header>
  );
}
