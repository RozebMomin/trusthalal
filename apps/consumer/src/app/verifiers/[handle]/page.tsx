/**
 * Public verifier profile page — /verifiers/[handle]
 *
 * Server component wrapper. Handles what the client view can't:
 *
 *   1. ``generateMetadata`` — fetches the verifier's profile
 *      server-side so a link shared to X / Instagram / iMessage
 *      lands with the correct ``@handle · Trust Halal Verifier``
 *      title, a bio-derived description, and an Open Graph image
 *      pointing at the Trust Halal Verifier badge.
 *
 *   2. JSON-LD structured data — surfaces the verifier as a
 *      ``Person`` so search engines can render a rich card and
 *      link the alternate profiles (Instagram, TikTok, etc.).
 *
 * Interactive rendering (loading state, error handling, hydration
 * of live query data) stays in ``verifier-profile-client.tsx``.
 * We deliberately DON'T pass the fetched profile through as a
 * prop — the client component still fetches via React Query so
 * the response can revalidate on mount + on window focus.
 */

import type { Metadata } from "next";
import { cache } from "react";

import { BRAND_NAME } from "@/lib/branding";
import { serverFetch } from "@/lib/api/server";

import { VerifierProfileClient } from "./verifier-profile-client";

/**
 * Minimal shape we need server-side for metadata + JSON-LD. Mirrors
 * the public ``GET /verifiers/{handle}`` response, narrowed to the
 * fields the metadata cares about. Defined locally so client-only
 * types in ``lib/api/hooks.ts`` don't leak into a server module.
 */
type VerifierForSeo = {
  public_handle: string;
  bio: string | null;
  social_links: Record<string, unknown> | null;
  joined_as_verifier_at: string;
  total_accepted_visits: number;
};

// React ``cache()`` dedupes the fetch within a single request so
// ``generateMetadata`` and the page body don't double-hit the API.
const loadVerifier = cache(async (handle: string) => {
  return serverFetch<VerifierForSeo>(`/verifiers/${encodeURIComponent(handle)}`);
});

/**
 * Truncate a free-text bio for use in meta descriptions. Cuts on a
 * word boundary and appends an ellipsis when the source was longer
 * than the limit.
 */
function truncateBio(bio: string, limit = 160): string {
  const trimmed = bio.trim().replace(/\s+/g, " ");
  if (trimmed.length <= limit) return trimmed;
  const cut = trimmed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : limit)}…`;
}

export async function generateMetadata({
  params,
}: {
  params: { handle: string };
}): Promise<Metadata> {
  const verifier = await loadVerifier(params.handle);

  if (!verifier) {
    // 404 / private / suspended — don't index, don't share.
    return {
      title: "Verifier not found",
      robots: { index: false, follow: false },
    };
  }

  const title = `@${verifier.public_handle} · Trust Halal Verifier`;
  const description = verifier.bio
    ? truncateBio(verifier.bio)
    : `Community halal-restaurant verifier on ${BRAND_NAME}. ${verifier.total_accepted_visits} verified visits.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/verifiers/${verifier.public_handle}`,
    },
    openGraph: {
      type: "profile",
      title,
      description,
      url: `/verifiers/${verifier.public_handle}`,
      // Verifier badge lives at /verifier-badge.svg in the public
      // dir. It's the same badge everywhere and doubles as the
      // shareable OG image. Ideally this would eventually be a
      // per-verifier dynamic OG image with their handle + visit
      // count baked in — noted as a follow-up.
      images: [
        {
          url: "/verifier-badge.svg",
          width: 400,
          height: 400,
          alt: "Trust Halal Verifier badge",
        },
      ],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: ["/verifier-badge.svg"],
    },
  };
}

/**
 * Build a Person JSON-LD document for the verifier so search
 * engines can surface the profile as a rich structured result
 * and link the verifier's alternate accounts (Instagram, TikTok,
 * blog).
 *
 * ``sameAs`` uses the social links the verifier explicitly opted
 * to publish — private accounts stay off.
 */
function buildPersonJsonLd(
  verifier: VerifierForSeo,
  origin: string,
): Record<string, unknown> {
  const sameAs: string[] = [];
  const socials = (verifier.social_links ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(socials)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const val = v.trim();
    if (/^https?:\/\//i.test(val)) {
      sameAs.push(val);
    } else if (k === "instagram") {
      sameAs.push(`https://instagram.com/${val.replace(/^@/, "")}`);
    } else if (k === "tiktok") {
      sameAs.push(`https://tiktok.com/@${val.replace(/^@/, "")}`);
    } else if (k === "youtube") {
      const cleaned = val.replace(/^@/, "");
      sameAs.push(`https://youtube.com/@${cleaned}`);
    } else if (k === "website") {
      sameAs.push(`https://${val}`);
    }
  }

  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: `@${verifier.public_handle}`,
    alternateName: verifier.public_handle,
    description: verifier.bio ?? undefined,
    url: `${origin}/verifiers/${verifier.public_handle}`,
    sameAs: sameAs.length > 0 ? sameAs : undefined,
    memberOf: {
      "@type": "Organization",
      name: "Trust Halal Verifiers",
      url: `${origin}/become-a-verifier`,
    },
  };
}

export default async function VerifierProfilePage({
  params,
}: {
  params: { handle: string };
}) {
  const verifier = await loadVerifier(params.handle);

  return (
    <>
      {verifier && (
        // JSON-LD embed. Search engines read this; users never see
        // it. Kept tight — a single ``Person`` object with the
        // canonical URL and the alternate-account list.
        <script
          type="application/ld+json"
          // Origin is derived from BRAND_NAME's expected public URL
          // — halalfoodnearme.com. Hard-coded here to avoid needing
          // the ``NEXT_PUBLIC_SITE_URL`` env var to be present in
          // the server component.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(
              buildPersonJsonLd(verifier, "https://halalfoodnearme.com"),
            ),
          }}
        />
      )}
      <VerifierProfileClient handle={params.handle} />
    </>
  );
}
