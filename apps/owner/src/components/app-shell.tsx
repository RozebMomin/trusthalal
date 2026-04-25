"use client";

/**
 * Top-level client shell for the owner portal.
 *
 * Three jobs, in order:
 *
 *  1. Render public routes bare (login). No header, no auth gate
 *     beyond "is this path public?"
 *
 *  2. Redirect unauthenticated users on gated paths to /login. After
 *     login, the server's redirect_path takes the user to the right
 *     home (owners land on / for now).
 *
 *  3. Enforce role: only OWNER role users get the portal chrome.
 *     ADMIN / VERIFIER / CONSUMER all get a friendly dead-end pane —
 *     the portal is a customer-facing surface for restaurant owners,
 *     not internal staff or end users. This mirrors the admin
 *     panel's NoAccessPane pattern but inverted (admin allows ADMIN
 *     and VERIFIER; portal allows OWNER only).
 *
 * Why client-side rather than Next.js middleware: the session cookie
 * is set with SameSite=Lax across the api.trusthalal.org boundary, so
 * middleware on the portal's origin can't see it on first render —
 * source of truth is the API's /me endpoint.
 */

import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { useCurrentUser, useLogout } from "@/lib/api/hooks";

const PUBLIC_PATHS = new Set<string>(["/login"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { data: me, isLoading } = useCurrentUser();
  const isPublic = PUBLIC_PATHS.has(pathname);

  // Auth-state branch:
  //   1. Unauthenticated + gated path → /login
  //   2. Authenticated + on /login    → /
  //   3. Otherwise                    → render as-is, role gate
  //                                     handled in the body below.
  React.useEffect(() => {
    if (isLoading) return;

    if (!me && !isPublic) {
      router.replace("/login");
      return;
    }

    if (me && isPublic) {
      router.replace("/");
    }
  }, [me, isLoading, isPublic, pathname, router]);

  // Avoid flashing chrome / login form before /me resolves.
  if (isLoading) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  if (isPublic) {
    // /login renders fullscreen-centered without portal chrome. The
    // page's own layout handles styling.
    return <>{children}</>;
  }

  if (!me) {
    // Effect above is redirecting to /login — render nothing during
    // the brief in-between state.
    return null;
  }

  // Role gate: only OWNER gets the portal. Everyone else sees a
  // friendly explanation + sign-out so they can leave cleanly.
  if (me.role !== "OWNER") {
    return <NotForYouPane role={me.role} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PortalHeader />
      <main className="flex-1 px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}

/**
 * Slim header for the owner portal. Differs from the admin panel's
 * sidebar layout: customers expect a topbar, not an internal-tool
 * sidebar.
 */
function PortalHeader() {
  const { data: me } = useCurrentUser();
  const logout = useLogout();
  const router = useRouter();

  async function onSignOut() {
    try {
      await logout.mutateAsync();
    } catch {
      // Logout is idempotent server-side; cookie is cleared either
      // way. Always route to /login so the user isn't stranded.
    }
    router.replace("/login");
  }

  return (
    <header className="border-b bg-card px-4 py-3 md:px-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tracking-tight">
            Trust Halal
          </span>
          <span className="text-xs text-muted-foreground">Owner portal</span>
        </div>
        <div className="flex items-center gap-3">
          {me?.id && (
            <span
              className="hidden font-mono text-[11px] text-muted-foreground md:inline"
              title={me.id}
            >
              {me.id.slice(0, 8)}…
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onSignOut}
            disabled={logout.isPending}
          >
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </div>
    </header>
  );
}

/**
 * Rendered when a non-OWNER user reaches the portal — typically an
 * admin who clicked the wrong link or a consumer who guessed the
 * URL. Friendly copy diverging by role so the message feels
 * intentional rather than like a wall.
 */
function NotForYouPane({ role }: { role: string }) {
  const router = useRouter();
  const logout = useLogout();

  async function onSignOut() {
    try {
      await logout.mutateAsync();
    } catch {
      // Same idempotent-logout posture as the header.
    }
    router.replace("/login");
  }

  const copy = (() => {
    if (role === "ADMIN" || role === "VERIFIER") {
      return {
        title: "This portal is for restaurant owners",
        body: "You're signed in as Trust Halal staff. Head over to the admin panel for moderation and operations work.",
      };
    }
    return {
      title: "This portal is for restaurant owners",
      body: "Trust Halal's owner portal is where restaurant owners manage their listings, claims, and certifications. If you're looking for halal restaurants near you, use our public directory instead.",
    };
  })();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 rounded-md border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        <p className="text-xs text-muted-foreground">
          Signed in as <span className="font-mono">{role}</span>.
        </p>
        <Button
          variant="outline"
          onClick={onSignOut}
          disabled={logout.isPending}
          className="w-full"
        >
          {logout.isPending ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </div>
  );
}
