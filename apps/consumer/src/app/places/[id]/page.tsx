/**
 * Public place detail page — /places/[id]
 *
 * Server component wrapper. Two responsibilities the client view
 * can't handle:
 *
 *   1. `generateMetadata` — fetches the place server-side so
 *      shared links land with the restaurant's actual name in the
 *      `<title>`, address in the description, and a canonical URL
 *      that doesn't include preview hostnames or query strings.
 *      Crawlers consume this; users only see the title in their
 *      tab.
 *
 *   2. JSON-LD structured data — Google reads this to surface the
 *      listing as a Restaurant in rich results (name, address,
 *      coords). It's harmless if the place can't be fetched
 *      server-side (we just skip it); the client view still renders
 *      and the user gets the page.
 *
 * The actual interactive surface (search, dispute filing, etc.)
 * lives in `place-detail-client.tsx`.
 */

import type { Metadata } from "next";
import { cache } from "react";

import { BRAND_NAME } from "@/lib/branding";
import { serverFetch } from "@/lib/api/server";

import { PlaceDetailClient } from "./place-detail-client";

/**
 * Minimal shape we need server-side for metadata + JSON-LD. Mirrors
 * the public `GET /places/{id}` response, narrowed to the fields we
 * actually read here. Defined locally so the client-only types in
 * `lib/api/hooks.ts` don't have to leak into a server module.
 */
type PlaceForSeo = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  is_deleted: boolean;
  city: string | null;
  region: string | null;
  country_code: string | null;
  postal_code: string | null;
};

// React `cache()` dedupes the fetch within a single request — both
// `generateMetadata` and the page body can call `loadPlace(id)` and
// the underlying `/places/{id}` request only fires once.
const loadPlace = cache(async (placeId: string) => {
  return serverFetch<PlaceForSeo>(`/places/${placeId}`);
});

function buildAddress(place: PlaceForSeo): string {
  const parts = [
    place.address,
    [place.city, place.region].filter(Boolean).join(", "),
    place.country_code,
  ].filter(Boolean) as string[];
  return parts.join(" · ");
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const place = await loadPlace(params.id);
  if (!place || place.is_deleted) {
    // Either the API didn't respond, the place doesn't exist, or it
    // was soft-deleted. Either way, don't index — the client view
    // will render an appropriate state.
    return {
      title: "Restaurant not found",
      robots: { index: false, follow: false },
    };
  }
  const address = buildAddress(place);
  const description = address
    ? `${place.name} — halal verification details on ${BRAND_NAME}. ${address}.`
    : `${place.name} — halal verification details on ${BRAND_NAME}.`;
  return {
    title: place.name,
    description,
    alternates: { canonical: `/places/${place.id}` },
    openGraph: {
      type: "website",
      title: `${place.name} · ${BRAND_NAME}`,
      description,
      url: `/places/${place.id}`,
    },
    twitter: {
      card: "summary",
      title: `${place.name} · ${BRAND_NAME}`,
      description,
    },
  };
}

/**
 * Restaurant JSON-LD. Google reads `Restaurant` (a subtype of
 * `LocalBusiness`) to render rich results — name, address, geo. We
 * keep it minimal because we don't have menu / hours / cuisine on
 * the place row; richer fields can be filled in once the schema
 * supports them.
 */
function PlaceJsonLd({ place }: { place: PlaceForSeo }) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: place.name,
    geo: {
      "@type": "GeoCoordinates",
      latitude: place.lat,
      longitude: place.lng,
    },
  };
  if (place.address || place.city || place.region || place.country_code) {
    data.address = {
      "@type": "PostalAddress",
      streetAddress: place.address ?? undefined,
      addressLocality: place.city ?? undefined,
      addressRegion: place.region ?? undefined,
      postalCode: place.postal_code ?? undefined,
      addressCountry: place.country_code ?? undefined,
    };
  }
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- structured data, not user-controlled HTML
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default async function PlaceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const place = await loadPlace(params.id);
  return (
    <>
      {place && !place.is_deleted && <PlaceJsonLd place={place} />}
      <PlaceDetailClient placeId={params.id} />
    </>
  );
}
