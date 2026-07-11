import type { Metadata } from "next";
import "./globals.css";

const TITLE = "Trust Halal — the source of truth for halal restaurants";
const DESCRIPTION =
  "Trust Halal is the definitive record of halal restaurants. Every claim is checked at the source — supplier, slaughter method, certificate on file, and an in-person visit — so no one has to call the kitchen and hope.";

export const metadata: Metadata = {
  metadataBase: new URL("https://trusthalal.org"),
  title: TITLE,
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
  themeColor: "#F8F4EC",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Serif + sans free font pair. Loaded async via preconnect
            so the initial paint doesn't wait on Google Fonts. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        {/* Italic 600 added for the hero's accented em phrase. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,600&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
