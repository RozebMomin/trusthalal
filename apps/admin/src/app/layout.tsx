import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/toaster";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "trusthalal admin",
  description: "Admin panel for trusthalal-api",
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
            useCurrentUser, decides whether to render the authenticated
            chrome (sidebar + nav) or just the bare child (for /login),
            and handles the auth redirect in both directions.
          */}
          <AppShell>{children}</AppShell>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
