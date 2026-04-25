import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trust Halal · Owner portal",
  description:
    "Manage your restaurants, claims, and certifications on Trust Halal.",
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
