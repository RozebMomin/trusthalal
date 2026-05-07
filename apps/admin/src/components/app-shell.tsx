"use client";

/**
 * Top-level client shell.
 *
 * Three jobs, in order:
 *
 *  1. Render public routes bare (login, set-password) — no sidebar,
 *     no auth check beyond "is this path public?"
 *
 *  2. Redirect unauthenticated users on gated paths to /login, and
 *     redirect already-signed-in users who hit /login to their role's
 *     home page. ``homeFor(role)`` decides where each role lands so
 *     future role additions don't need shell edits.
 *
 *  3. Enforce role-aware access on gated paths. If the signed-in
 *     user's role can't view the current path:
 *       * Has a home in this panel → redirect there silently.
 *       * Has no home (OWNER/CONSUMER today) → render NoAccessPane so
 *         the user gets a coherent "this tool isn't for you" page
 *         instead of a cascade of 403s from admin-only APIs.
 *
 * Why client-side rather than Next.js middleware: the session cookie
 * is set with SameSite=Lax across the 3001↔8000 origin boundary, so
 * middleware sitting on the panel's origin can't actually SEE the
 * cookie on the first render — it'd always think you're logged out.
 * The source of truth is the API's /me endpoint, not the cookie's
 * local presence.
 */

import { Menu, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { AppNav } from "@/components/app-nav";
import { Button } from "@/components/ui/button";
import { VersionTag } from "@/components/version-tag";
import { useCurrentUser, useLogout } from "@/lib/api/hooks";
import { canAccess, homeFor } from "@/lib/auth/panel-access";
import { useToast } from "@/lib/hooks/use-toast";

// Routes that render without the authenticated chrome. Exact-match —
// any subroute (e.g. /login/forgot) would also need to be added here.
//
// /set-password renders without auth because the whole point is that
// the user doesn't have a password yet — they're completing an invite
// via a token in the URL. The page rejects the token server-side if
// the user has been deactivated, so there's no impersonation surface.
const PUBLIC_PATHS = new Set<string>(["/login", "/set-password"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { data: me, isLoading, isFetching } = useCurrentUser();
  const isPublic = PUBLIC_PATHS.has(pathname);

  // Role-aware landing. Four branches, evaluated after /me resolves:
  //   1. Unauthenticated + gated path → /login
  //   2. Authenticated + public path  → role's home (or NoAccessPane
  //                                     if no home)
  //   3. Authenticated + gated path they can't access + has home
  //                                   → their home
  //   4. Everything else              → render as-is (authenticated
  //                                     chrome + children, or
  //                                     NoAccessPane for home-less
  //                                     roles on any path)
  React.useEffect(() => {
    if (isLoading) return;

    if (!me && !isPublic) {
      router.replace("/login");
      return;
    }

    if (me && isPublic) {
      const home = homeFor(me.role);
      if (home && home !== pathname) {
        router.replace(home);
      }
      // If no home (OWNER/CONSUMER landing on /login after sign-in),
      // we'll render the NoAccessPane in the body below. Not a
      // redirect loop because pathname stays /login and the effect
      // short-circuits next tick.
      return;
    }

    if (me && !isPublic && !canAccess(me.role, pathname)) {
      const home = homeFor(me.role);
      if (home && home !== pathname) {
        router.replace(home);
      }
      // home === null case (OWNER/CONSUMER) falls through to the
      // NoAccessPane render below.
    }
  }, [me, isLoading, isPublic, pathname, router]);

  // First-load flash: don't render the sidebar with "you're logged
  // out" content flashing before the redirect fires. Show a blank
  // canvas until /me resolves.
  if (isLoading) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  if (isPublic) {
    // A home-less signed-in user (OWNER/CONSUMER today) who somehow
    // reaches /login should not see the sign-in form again — they're
    // already signed in, they just don't belong in this panel. Show
    // the NoAccessPane so they get a coherent dead-end with a
    // sign-out button. Same check happens in the gated-path branch
    // below; duplicated here because the effect's redirect can
    // leave them briefly on a public path before landing.
    if (me && homeFor(me.role) === null) {
      return <NoAccessPane role={me.role} />;
    }
    // /login and friends — bare render, no sidebar. The page itself
    // styles its own fullscreen centered layout.
    return <>{children}</>;
  }

  if (!me) {
    // Effect above is about to redirect; render nothing to avoid a
    // flash of protected content (sidebar, empty lists, etc.).
    return null;
  }

  // Signed in but no home in this panel (OWNER/CONSUMER today).
  // Render the friendly dead-end page instead of letting them wander
  // into admin APIs that will 403.
  if (homeFor(me.role) === null) {
    return <NoAccessPane role={me.role} />;
  }

  // Signed in but this specific path is above their pay grade. The
  // effect is already redirecting them home; render nothing to avoid
  // flashing the forbidden page's error states.
  if (!canAccess(me.role, pathname)) {
    return null;
  }

  return <AuthedShell isFetching={isFetching}>{children}</AuthedShell>;
}

/**
 * Authenticated layout shell.
 *
 * Desktop: classic two-column with a 256px-wide left sidebar that's
 * always visible. Content fills the remainder.
 *
 * Mobile (< md, 768px): the sidebar would eat 256px of a 375px
 * viewport, so it collapses into an off-canvas drawer that slides in
 * from the left when the user taps the hamburger in a narrow top
 * header. A backdrop click or a route change closes it. Body scroll
 * is locked while the drawer is open so background content doesn't
 * jiggle behind the overlay.
 */
function AuthedShell({
  children,
  isFetching,
}: {
  children: React.ReactNode;
  isFetching: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const [navOpen, setNavOpen] = React.useState(false);

  // Close the drawer whenever the user navigates. Without this, picking
  // a sidebar link on mobile leaves the drawer covering the content
  // they just opened.
  React.useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Lock body scroll while drawer is open on mobile. Dropped on
  // unmount + when drawer closes so we never leave the page stuck.
  React.useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  // Keep sidebar visibility predictable across resize: if the user
  // resizes from mobile to desktop while the drawer is open, drop the
  // open state so the desktop sidebar isn't doubled up with the
  // mobile-drawer artifacts (z-index, transform, etc.).
  React.useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 768) setNavOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="flex h-full min-h-screen flex-col md:flex-row">
      {/* Mobile-only top bar: hamburger + brand. Hidden on md+ where
          the sidebar is always visible. */}
      <header className="flex items-center gap-3 border-b bg-card px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={navOpen}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <span className="text-base font-semibold tracking-tight">
          Trust Halal
        </span>
      </header>

      {/* Backdrop: only rendered on mobile when drawer is open. Click
          dismisses the drawer. */}
      {navOpen && (
        <div
          aria-hidden
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <aside
        className={[
          "flex w-64 shrink-0 flex-col border-r bg-card",
          // Mobile: fixed slide-out drawer.
          "fixed inset-y-0 left-0 z-40 transform transition-transform duration-200",
          navOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop (md+): in-flow column, always visible.
          "md:relative md:translate-x-0 md:transition-none",
        ].join(" ")}
      >
        {/* Close affordance only on mobile drawer. */}
        <div className="flex items-center justify-end px-2 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation menu"
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <AppNav />
        <CurrentUserFooter
          email={undefined /* see SignedInIndicator */}
        />
        <SignedInIndicator />
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
          {/*
            isFetching indicator at bottom is just a hook for future
            background-refetch visibility. Left here as a no-op so
            the reference exists when we want it.
          */}
          <span className="sr-only">
            {isFetching ? "refreshing session" : ""}
          </span>
        </main>
      </div>
    </div>
  );
}

/**
 * Rendered for signed-in users whose role has no home in the admin
 * panel. Two populations today: OWNER (dashboard not built yet) and
 * CONSUMER (wrong product; they belong on the public catalog).
 *
 * Copy diverges by role so the message is accurate. Both paths offer
 * a sign-out button so the user can leave cleanly without hunting for
 * the sidebar control they can't see.
 */
function NoAccessPane({ role }: { role: "OWNER" | "CONSUMER" | string }) {
  const { toast } = useToast();
  const router = useRouter();
  const logout = useLogout();

  async function onSignOut() {
    try {
      await logout.mutateAsync();
      router.replace("/login");
    } catch {
      toast({
        title: "Sign-out issue",
        description:
          "The server didn't confirm sign-out, but your local session was cleared.",
        variant: "destructive",
      });
      router.replace("/login");
    }
  }

  const isOwner = role === "OWNER";
  const title = isOwner
    ? "Owner dashboard coming soon"
    : "This tool isn't for your account";
  const body = isOwner
    ? "You're signed in as an OWNER. The owner dashboard where you'll be able to manage your restaurants and claims is under construction. We'll email you when it's ready."
    : "This is Trust Halal's internal staff tool. If you're a customer looking for restaurants, our public site is the right place — this panel is for admin and moderation work only.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 rounded-md border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <p className="text-xs text-muted-foreground">
          Signed in as{" "}
          <span className="font-mono">{role}</span>.
        </p>
        <Button
          variant="outline"
          onClick={onSignOut}
          disabled={logout.isPending}
          className="w-full"
        >
          {logout.isPending ? "Signing out…" : "Sign out"}
        </Button>
        <div className="flex justify-center pt-1">
          <VersionTag />
        </div>
      </div>
    </div>
  );
}

// Placeholder kept in case we later want a compact footer that shows
// display_name alongside the logout control. SignedInIndicator handles
// both for now so this is a no-op.
function CurrentUserFooter(_props: { email?: string }) {
  return null;
}

/**
 * Small "signed in as ..." + Logout control at the bottom of the
 * sidebar. Reads /me for the email (role comes along but we don't
 * fetch it separately); logout clears the cookie + cache and forces a
 * redirect to /login.
 */
function SignedInIndicator() {
  const { data: me } = useCurrentUser();
  const { toast } = useToast();
  const router = useRouter();
  const logout = useLogout();

  async function onLogout() {
    try {
      await logout.mutateAsync();
      // Push to /login immediately; the useCurrentUser cache was
      // cleared by the mutation's onSuccess, so the destination
      // won't fight back.
      router.replace("/login");
    } catch {
      // Logout failures are rare (server revokes are idempotent) and
      // the cookie gets cleared by the server regardless — inform the
      // user but still attempt to redirect so they aren't stuck.
      toast({
        title: "Logout issue",
        description:
          "The server didn't confirm logout, but your local session was cleared.",
        variant: "destructive",
      });
      router.replace("/login");
    }
  }

  if (!me) return null;

  return (
    <div className="mt-auto border-t p-3 text-xs">
      <p className="truncate text-muted-foreground" title={me.id}>
        Signed in as <span className="font-medium">{me.role}</span>
      </p>
      <p
        className="truncate font-mono text-[11px] text-muted-foreground/70"
        title={me.id}
      >
        {me.id.slice(0, 8)}…
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-2 w-full"
        onClick={onLogout}
        disabled={logout.isPending}
      >
        {logout.isPending ? "Signing out…" : "Sign out"}
      </Button>
      <div className="mt-2 flex justify-center">
        <VersionTag />
      </div>
    </div>
  );
}
