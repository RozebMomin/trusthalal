/**
 * Apex hero block shown above the search surface.
 *
 * Two jobs: announce the brand, and explain the value prop in one
 * sentence. We deliberately keep it short — a tall hero on a search
 * site delays the user from typing, which is the only thing they're
 * here to do. The "verified by" line doubles as the trust marker
 * that reassures a first-time visitor before they scroll into
 * results.
 *
 * The header collapses (smaller type, no description) once the user
 * has an active query, so subsequent searches don't waste viewport
 * on the marketing block.
 */

import Link from "next/link";

import {
  BRAND_NAME,
  BRAND_TAGLINE,
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
      <header className="space-y-1 pt-2">
        <h1 className="text-2xl font-bold tracking-tight">
          {BRAND_NAME}
        </h1>
        <p className="text-xs text-muted-foreground">
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
    <header className="space-y-3 pt-2 sm:pt-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {BRAND_NAME}
        </h1>
        <p className="text-base text-muted-foreground sm:text-lg">
          {BRAND_TAGLINE}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Every listing is backed by{" "}
        <a
          href={TRUST_HALAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          Trust Halal
        </a>
        : you see the validation tier, menu posture, slaughter method,
        and any open consumer disputes — not just a yes/no badge.
      </p>
      <p className="text-xs text-muted-foreground">
        Own a restaurant?{" "}
        <Link
          href="https://owner.trusthalal.org"
          className="underline-offset-2 hover:underline"
        >
          Claim your listing →
        </Link>
      </p>
    </header>
  );
}
