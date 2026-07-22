import type { Metadata } from "next";
import "./globals.css";

// Brand-first titles, standardized across every web surface: the mark leads,
// then the page. Sub-pages (e.g. Terms) inherit the template and become
// "Trust Halal · Terms of Service" instead of losing the brand entirely.
const BRAND = "Trust Halal";
const TITLE = `${BRAND} · The source of truth for halal restaurants`;
const DESCRIPTION =
  "Trust Halal is the definitive record of halal restaurants. Every claim is checked at the source — supplier, slaughter method, certificate on file, and an in-person visit — so no one has to call the kitchen and hope.";

export const metadata: Metadata = {
  metadataBase: new URL("https://trusthalal.org"),
  title: {
    default: TITLE,
    template: `${BRAND} · %s`,
  },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: "https://trusthalal.org",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F6F6F7",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Inter only — v2 is Inter-driven, no serif. Loaded async via
            preconnect so the initial paint doesn't wait on Google Fonts.
            Italic 600 kept for the hero's accented <em> phrase. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
