import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/toaster";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Trust Halal · Admin",
    template: "Trust Halal · %s",
  },
  description: "Trust Halal admin console.",
};

/*
 * Explicit viewport so iOS Safari renders at a correct mobile width
 * on first paint. Next.js does add a default viewport meta when this
 * isn't set, but the explicit `initial-scale=1` rules out the
 * occasional "loads slightly zoomed" first-paint quirk on iOS where
 * the missing scale factor lets the page render wider than the
 * viewport. `width=device-width` + scale 1 is the standard mobile-
 * friendly default.
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
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="h-full bg-background text-foreground antialiased">
        {/*
          Set the theme before the page paints so dark mode never flashes
          light. Runs synchronously as the first thing in <body> (from the
          server-rendered HTML), reading an explicit choice from localStorage
          else the OS preference. ThemeToggle keeps this class in sync after.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();",
          }}
        />
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
