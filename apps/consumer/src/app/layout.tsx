import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import {
  BRAND_DESCRIPTION,
  BRAND_NAME,
  SITE_URL,
} from "@/lib/branding";

import { Providers } from "./providers";
import "./globals.css";

/**
 * Inter is the workhorse of modern utility apps — wide weight range,
 * small-text optical adjustments, and the only thing that beats a
 * good system stack on consistency across iOS / Android / Windows.
 * Loading via next/font/google so Next can inline + self-host at
 * build time (no FOUT, no per-render network call to Google Fonts).
 *
 * ``display: 'swap'`` lets the system font render first, then swap
 * once Inter loads — keeps Lighthouse happy and the first paint
 * legible even on a cold load.
 *
 * Variable font axis is exposed via the ``--font-inter`` custom
 * property so Tailwind's ``font-sans`` (which references this
 * variable) picks it up everywhere without a per-component class.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

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
    default: `${BRAND_NAME} · Verified halal restaurants near you`,
    // Brand-first, standardized with the other web surfaces: a place page
    // becomes "Trust Halal · Jay's Deli" (was "Jay's Deli · Trust Halal").
    template: `${BRAND_NAME} · %s`,
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
    title: `${BRAND_NAME} · Verified halal restaurants near you`,
    description: BRAND_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND_NAME} · Verified halal restaurants near you`,
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
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="h-full bg-background font-sans text-foreground antialiased">
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
