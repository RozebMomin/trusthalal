import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trust Halal · Find verified halal restaurants",
  description:
    "Search verified halal restaurants. See validation tier, menu posture, slaughter method, alcohol policy, and consumer dispute history before you eat.",
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
