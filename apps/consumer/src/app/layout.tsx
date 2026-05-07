import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/app-shell";
import {
  BRAND_DESCRIPTION,
  BRAND_NAME,
  SITE_URL,
} from "@/lib/branding";

import { Providers } from "./providers";
import "./globals.css";

/**
 * Metadata defaults for every consumer page.
 *
 * `metadataBase` resolves relative URLs (e.g. an `alternates.canonical`
 * of `/places/abc`) against the production origin, even when we're
 * rendering on a Vercel preview. The title template lets each route
 * export a short title (e.g. "Sami's Halal Cart") and have the brand
 * suffix added automatically — better OG card behavior than full
 * strings embedded in every page.
 *
 * openGraph and twitter defaults give shared links a usable preview on
 * every social platform even before we ship a custom OG image; child
 * routes can override either field on a per-page basis.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND_NAME} · Find verified halal restaurants near you`,
    template: `%s · ${BRAND_NAME}`,
  },
  description: BRAND_DESCRIPTION,
  applicationName: BRAND_NAME,
  keywords: [
    "halal",
    "halal food",
    "halal restaurants",
    "halal near me",
    "zabiha",
    "verified halal",
    "halal certification",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: BRAND_NAME,
    url: SITE_URL,
    title: `${BRAND_NAME} · Find verified halal restaurants near you`,
    description: BRAND_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND_NAME} · Find verified halal restaurants near you`,
    description: BRAND_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-background text-foreground antialiased">
        <Providers>
          {/*
            AppShell is the consumer-friendly version of the admin /
            owner shells: it doesn't gate on a role (anyone can
            browse), but it does branch the header on whether the
            user is signed in. Disputes require auth, so the header
            surfaces a Sign in CTA when a feature needs it.
          */}
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
