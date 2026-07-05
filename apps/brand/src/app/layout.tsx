import type { Metadata } from "next";
import "./globals.css";

const TITLE = "Trust Halal — verified halal restaurants you can actually trust";
const DESCRIPTION =
  "Trust Halal is a verified directory of halal restaurants. We check what's on the plate — supplier, slaughter method, certificate on file — so diners don't have to call the kitchen first.";

export const metadata: Metadata = {
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
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
