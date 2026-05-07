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

import { Building2, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { VersionTag } from "@/components/version-tag";
import { useCurrentUser, useLogout } from "@/lib/api/hooks";

const PUBLIC_PATHS = new Set<string>(["/login", "/signup"]);

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
      {/*
        Bottom padding on mobile clears the fixed BottomTabBar (16px
        gap + bar height ~64px + safe-area inset for iPhones with no
        physical home button) so the last row of content isn't hidden
        underneath. md+ removes the offset since the tab bar is hidden.
      */}
      <main className="flex-1 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-8 md:pt-8">
        {children}
      </main>
      <BottomTabBar />
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
  const pathname = usePathname() ?? "/";
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
        <Link
          href="/"
          className="flex items-center gap-3 transition hover:opacity-80"
        >
          <span className="text-lg font-semibold tracking-tight">
            Trust Halal
          </span>
          {/* "Owner portal" qualifier sits next to the brand at every
              viewport so a user landing on a phone knows immediately
              which surface they're on. Used to be hidden below sm —
              that left mobile users staring at "Trust Halal" with no
              indication this isn't the consumer site. */}
          <span className="text-xs text-muted-foreground">
            Owner portal
          </span>
        </Link>

        {/* Nav: only render once we know the user is signed in. The
            shell already gates so we'd never render this header for an
            anonymous session, but keying off ``me`` keeps the links
            from flickering during the brief loading state.

            Three top-level nav items, ordered for the typical owner
            mental model: pick what to verify (Halal claims) → who
            owns it (Places) → which company (Organizations). The
            "Claim a place" action lives on the Places page itself
            (header CTA + empty-state CTA) — claiming is a once-or-
            twice-per-month action and a top-level link for it
            crowds the nav on a portal users visit weekly. */}
        {me && (
          <nav className="hidden items-center gap-1 md:flex">
            <NavLink
              href="/my-halal-claims"
              active={pathname.startsWith("/my-halal-claims")}
            >
              Halal claims
            </NavLink>
            <NavLink href="/my-claims" active={pathname.startsWith("/my-claims")}>
              Places
            </NavLink>
            <NavLink
              href="/my-organizations"
              active={pathname.startsWith("/my-organizations")}
            >
              Organizations
            </NavLink>
          </nav>
        )}

        <div className="flex items-center gap-3">
          {me && (
            <div className="hidden flex-col items-end leading-tight md:flex">
              {me.display_name && (
                <span
                  className="text-sm font-medium text-foreground"
                  title={me.email ?? undefined}
                >
                  {me.display_name}
                </span>
              )}
              {me.id && (
                <span
                  className="font-mono text-[10px] text-muted-foreground"
                  title={me.id}
                >
                  {me.id.slice(0, 8)}
                </span>
              )}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onSignOut}
            disabled={logout.isPending}
          >
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Button>
          <VersionTag className="hidden sm:inline" />
        </div>
      </div>

      {/*
        Mobile nav was previously a secondary row that wrapped below
        the brand. It's been replaced by the BottomTabBar (rendered by
        AppShell, fixed to the viewport bottom). That gives a more
        native-app feel on a phone — three thumb-reachable tabs with
        icons + labels — and frees up a row of vertical real estate
        at the top of every screen.
      */}
    </header>
  );
}

/**
 * Bottom tab bar — mobile-only, fixed to the viewport bottom.
 *
 * Three peer-level surfaces (Claims, Places, Organizations) map
 * cleanly to a tab bar pattern lifted from native iOS / Android:
 * persistent, thumb-reachable, always-visible. On md+ the desktop
 * top-bar nav handles the same destinations and this component
 * renders nothing.
 *
 * Implementation notes:
 *   * `env(safe-area-inset-bottom)` keeps the bar above the iPhone
 *     home indicator without overlapping it. Bar's vertical padding
 *     adds the inset so the visual bar height varies by device.
 *   * `backdrop-blur` lets translucent-but-readable content sit over
 *     scrolled page content the way native bars do.
 *   * Active item gets a stronger color treatment + thicker icon
 *     stroke via lucide's default fill for instant glanceability.
 *   * Each tab is a min-h-12 / min-w-16 touch target — comfortably
 *     above Apple's 44pt and Material's 48dp guidance.
 */
function BottomTabBar() {
  const pathname = usePathname() ?? "/";

  const tabs: ReadonlyArray<{
    href: string;
    label: string;
    icon: typeof ShieldCheck;
    matches: (p: string) => boolean;
  }> = [
    {
      href: "/my-halal-claims",
      label: "Claims",
      icon: ShieldCheck,
      matches: (p) => p.startsWith("/my-halal-claims"),
    },
    {
      href: "/my-claims",
      label: "Places",
      icon: Store,
      // /my-claims AND the bare / home page both belong to this tab —
      // home is effectively a places-overview surface.
      matches: (p) => p === "/" || p.startsWith("/my-claims"),
    },
    {
      href: "/my-organizations",
      label: "Orgs",
      icon: Building2,
      matches: (p) => p.startsWith("/my-organizations"),
    },
  ];

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map((tab) => {
          const active = tab.matches(pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex min-h-[3rem] flex-col items-center justify-center gap-0.5 px-2 py-2 text-[11px] font-medium transition",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Icon
                  className="h-5 w-5"
                  strokeWidth={active ? 2.5 : 2}
                  aria-hidden
                />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "rounded-md px-3 py-1.5 text-sm font-medium transition",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      ].join(" ")}
    >
      {children}
    </Link>
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
        <div className="flex justify-center pt-1">
          <VersionTag />
        </div>
      </div>
    </div>
  );
}
