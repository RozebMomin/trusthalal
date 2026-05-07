import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/app-shell";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trust Halal · Owner portal",
  description:
    "Manage your restaurants, claims, and certifications on Trust Halal.",
};

/*
 * Explicit viewport so iOS Safari renders at a correct mobile width
 * on first paint. Mirrors the explicit `width=device-width` +
 * `initial-scale=1` defaults set on the admin + consumer shells to
 * avoid the occasional "loads slightly zoomed" first-paint quirk
 * when only Next.js's auto-injected default is present.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
            AppShell is the client-side gatekeeper: it calls /me via
            useCurrentUser, decides whether to render the portal
            chrome (header) or the bare login screen, and gates non-
            OWNER roles with NotForYouPane.
          */}
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
