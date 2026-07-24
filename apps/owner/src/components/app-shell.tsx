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

import { Building2, Home, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { VersionTag } from "@/components/version-tag";
import { useOwnerReviews, useCurrentUser, useLogout } from "@/lib/api/hooks";
import { TermsGate } from "@/components/terms-gate";
import {
  FACEBOOK_URL,
  INSTAGRAM_URL,
  PRIVACY_URL,
  SUPPORT_EMAIL,
  TERMS_URL,
  TIKTOK_URL,
} from "@/lib/links";

/**
 * Routes that render without the auth gate.
 *
 * Every one of these is reached by someone who is, by definition, not
 * signed in — or who is proving something with a token rather than a
 * session. Gating them sends the user to /login, which is the one page
 * they can't get past:
 *
 *   /login, /signup       — obvious.
 *   /forgot-password      — you're here because you can't sign in.
 *   /reset-password       — the token IS the credential.
 *   /verify-email         — the token IS the proof, and these links are
 *                           routinely opened on a phone or in a mail
 *                           client where no session exists.
 *
 * This list previously held only login and signup, which meant password
 * reset never worked on this portal: a locked-out user clicking their
 * reset link landed on the sign-in page. Add a route here whenever it can
 * be legitimately reached without a session.
 */
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);


/**
 * Public routes that must ALSO render for a signed-in user.
 *
 * The rest of PUBLIC_PATHS bounces an authenticated visitor home — sensible
 * for /login, wrong for anything carrying a token. A signed-in owner
 * clicking their own confirmation link would otherwise be redirected away
 * before the token was ever redeemed, and the link would appear to do
 * nothing. Same for a reset link opened in a browser where you happen to
 * still have a session.
 */
const TOKEN_PATHS = new Set<string>(["/verify-email", "/reset-password"]);

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

    if (me && isPublic && !TOKEN_PATHS.has(pathname)) {
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
      {/*
        Mobile bottom clearance for the fixed BottomTabBar now lives on the
        footer (the new last element) rather than main — otherwise main's
        padding would open a dead gap between content and the footer. main
        keeps normal padding; the footer carries the tab-bar offset.
      */}
      <main className="flex-1 px-4 pb-8 pt-6 md:px-8 md:pt-8">
        {children}
      </main>
      <PortalFooter />
      <BottomTabBar />
      {/* Renders nothing unless this account owes an acknowledgement. Below
          the role gate on purpose: a non-OWNER never reaches the portal, and
          a public path has no session to attach an acceptance to. */}
      <TermsGate />
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
          className="flex items-center gap-2.5 transition hover:opacity-80"
        >
          <BrandMark className="h-8 w-8" />
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
              href="/get-verified"
              active={pathname === "/" || pathname.startsWith("/get-verified")}
            >
              Home
            </NavLink>
            <NavLink
              href="/my-organizations"
              active={pathname.startsWith("/my-organizations")}
            >
              Organizations
            </NavLink>
            <NavLink
              href="/my-places"
              active={pathname.startsWith("/my-places")}
            >
              Places
            </NavLink>
            <NavLink
              href="/my-halal-claims"
              active={pathname.startsWith("/my-halal-claims")}
            >
              Halal Claims
            </NavLink>
            <NavLink
              href="/my-reviews"
              active={pathname.startsWith("/my-reviews")}
            >
              Reviews
              <UnrepliedBadge />
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
/**
 * Unreplied-review count on the desktop nav.
 *
 * Renders nothing at zero — a badge showing "0" is noise, and the absence
 * of a badge already says the same thing.
 */
function UnrepliedBadge() {
  const reviews = useOwnerReviews({ needsReply: true });
  const count = reviews.data?.needs_reply_count ?? 0;
  if (count === 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground">
      {count}
    </span>
  );
}

/**
 * Bottom tab bar — deliberately still FOUR tabs.
 *
 * Reviews is a fifth top-level destination on desktop but not here. Five
 * forces "Halal Claims" down to "Claims" and crowds a bar this file already
 * argues should stay at three or four. Mobile owners reach reviews from a
 * badged card at the top of Home instead, which does the same attention job
 * a tab badge would without the squeeze.
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
      href: "/get-verified",
      label: "Home",
      icon: Home,
      matches: (p) => p === "/" || p.startsWith("/get-verified"),
    },
    {
      href: "/my-organizations",
      label: "Orgs",
      icon: Building2,
      matches: (p) => p.startsWith("/my-organizations"),
    },
    {
      href: "/my-places",
      label: "Places",
      icon: Store,
      // /my-places is the new owned-place management hub. The legacy
      // /my-claims (ownership-request lifecycle) still matches this tab
      // so the highlight tracks when the owner navigates there too.
      matches: (p) => p.startsWith("/my-places") || p.startsWith("/my-claims"),
    },
    {
      href: "/my-halal-claims",
      label: "Claims",
      icon: ShieldCheck,
      matches: (p) => p.startsWith("/my-halal-claims"),
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
              {/*
                Active state stack — three signals working together so
                the selection is obvious at a glance even on a small,
                glance-able mobile bar:
                  1. Top accent bar in --primary (3px, full width of
                     the cell) reads as the bar of an iOS-style
                     selection indicator.
                  2. Soft primary tint (`bg-primary/10`) washes the
                     entire cell — distinguishes from inactive tabs
                     even peripherally.
                  3. Icon + label switch to --primary text color and
                     the icon stroke thickens.
              */}
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "relative flex min-h-[3rem] flex-col items-center justify-center gap-0.5 px-2 py-2 text-[11px] font-medium transition",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                ].join(" ")}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 top-0 h-[3px] rounded-b-full bg-primary"
                  />
                )}
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

/**
 * Slim portal footer. The owner portal previously had none — nav lived in
 * the header and mobile BottomTabBar, and there was nowhere the brand's
 * social presence or legal links appeared. This adds a quiet footer with
 * both, carrying the mobile tab-bar bottom-clearance that used to sit on
 * main (see AppShell).
 */
function PortalFooter() {
  return (
    <footer className="border-t bg-card text-sm">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:flex-row md:items-center md:justify-between md:px-8 md:pb-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Terms
          </a>
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Privacy
          </a>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:underline">
            Support
          </a>
          <VersionTag />
        </div>
        <SocialLinks />
      </div>
    </footer>
  );
}

/**
 * Social icon links — Instagram, TikTok, Facebook. Brand glyphs are
 * single-path (simple-icons) so each is one <path fill="currentColor">;
 * colour inherits the muted footer tone and lifts to --foreground on hover.
 */
const SOCIALS: ReadonlyArray<{ label: string; href: string; path: string }> = [
  {
    label: "Instagram",
    href: INSTAGRAM_URL,
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
  },
  {
    label: "TikTok",
    href: TIKTOK_URL,
    path: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  },
  {
    label: "Facebook",
    href: FACEBOOK_URL,
    path: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z",
  },
];

function SocialLinks() {
  return (
    <span className="flex items-center gap-3">
      {SOCIALS.map((s) => (
        <a
          key={s.href}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.label}
          title={s.label}
          className="text-muted-foreground transition hover:text-foreground"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={s.path} />
          </svg>
        </a>
      ))}
    </span>
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
