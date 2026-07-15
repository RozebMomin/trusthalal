"use client";

/**
 * Top-level client shell for the consumer site.
 *
 * Posture differs from apps/admin and apps/owner: consumers browse
 * anonymously by default. The shell never blocks on a role gate;
 * it just branches the header on whether the user is signed in:
 *
 *   * Anonymous → "Sign in" / "Sign up" links in the header.
 *   * Signed-in CONSUMER → display name + Sign out.
 *   * Signed-in OWNER / ADMIN / VERIFIER → friendly "you have a
 *     staff/owner account; this is the public site" header callout
 *     plus the right link to their actual home (admin panel or
 *     owner portal). They can still browse, but the UI nudges them
 *     to use the surface they're meant for.
 *
 * /login and /signup render bare (no portal chrome) the same way the
 * other apps do — the page's own layout handles the centered card.
 */

import { Heart, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { VersionTag } from "@/components/version-tag";
import {
  BRAND_NAME,
  OWNER_PORTAL_URL,
  TRUST_HALAL_URL,
} from "@/lib/branding";
import { useCurrentUser, useLogout } from "@/lib/api/hooks";
import { safeNextPath } from "@/lib/utils";

const PUBLIC_BARE_PATHS = new Set<string>(["/login", "/signup"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { data: me, isLoading } = useCurrentUser();
  const isBare = PUBLIC_BARE_PATHS.has(pathname);

  // If the visitor is already signed in and lands on /login or
  // /signup, bounce them along — honoring any ``?next=`` the page
  // carried (e.g. "sign in to save this place" deep links) so the
  // bounce doesn't strand a just-authenticated user on the home
  // page. window.location is read inside the effect (client-only)
  // to avoid a useSearchParams Suspense requirement at the shell.
  React.useEffect(() => {
    if (isLoading) return;
    if (me && isBare) {
      const next = safeNextPath(
        new URLSearchParams(window.location.search).get("next"),
      );
      router.replace(next);
    }
  }, [me, isLoading, isBare, router]);

  // Bare layout for the auth pages — they handle their own framing.
  if (isBare) return <>{children}</>;

  // /me is still loading. Render a skeletonish chrome rather than
  // flashing the anonymous header for a beat — but we don't block
  // the children render either, since search and place detail are
  // public and shouldn't wait on auth resolution.
  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        <PortalHeader me={null} pending />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PortalHeader me={me ?? null} />
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}

type CurrentUser = NonNullable<ReturnType<typeof useCurrentUser>["data"]>;

function PortalHeader({
  me,
  pending = false,
}: {
  me: CurrentUser | null;
  pending?: boolean;
}) {
  const router = useRouter();
  const logout = useLogout();

  async function onSignOut() {
    try {
      await logout.mutateAsync();
    } catch {
      // Logout is idempotent server-side; cookie is cleared either
      // way. Always route home so the user isn't stranded.
    }
    router.replace("/");
  }

  // Staff / owner roles see a small "you're signed in as X — visit
  // your portal" link in the header. The consumer site doesn't lock
  // them out (the public catalog is genuinely public), but the
  // pointer makes "this isn't for me" clear at a glance.
  const wrongAudience =
    me !== null && me.role !== "CONSUMER";

  return (
    // Sticky so search + nav stay reachable on long result lists.
    // z-40 sits under the dialog/sheet layer (z-50) so modals still
    // cover the header. The slight translucency + blur keeps content
    // scrolling under it readable as chrome, not a hard wall.
    <header className="sticky top-0 z-40 border-b bg-card/95 px-4 py-3 backdrop-blur md:px-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 md:gap-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 transition hover:opacity-80"
        >
          {/* Logo mark — emerald rounded square + white check, matching the
              app icon and the brand site's BrandMark. */}
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <span className="text-lg font-semibold tracking-tight">
            {BRAND_NAME}
          </span>
        </Link>

        {/* Right-side header: split into "nav" and "auth" groups
            with a thin divider between them so the user can tell
            which buttons take them somewhere on the site (nav) and
            which ones change their session state (auth). The gap
            tightens on mobile so the cluster fits next to the brand
            wordmark on iPhone-SE-class viewports without wrapping. */}
        <div className="flex items-center gap-2 md:gap-4">
          {wrongAudience && me && <WrongAudienceCallout role={me.role} />}

          {pending && (
            <span className="text-xs text-muted-foreground">…</span>
          )}

          {!pending && me === null && (
            <>
              <nav className="flex items-center gap-3 sm:gap-4">
                {/* Saved places shows for anonymous too so the
                    feature is discoverable. The page itself renders
                    a "sign in to save" pitch when the visitor lands
                    without auth — no role-based rendering needed.
                    On mobile the text links collapse to icons rather
                    than disappearing — footer-only access made the
                    features effectively invisible on phones. */}
                <Link
                  href="/favorites"
                  className="hidden text-sm hover:underline sm:inline"
                >
                  Saved
                </Link>
                <Link
                  href="/favorites"
                  aria-label="Saved places"
                  className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground sm:hidden"
                >
                  <Heart className="h-4 w-4" aria-hidden />
                </Link>
                {/* Anonymous visitors get the prefs link too — local
                    storage backs the page, and they'll learn the
                    feature exists. */}
                <Link
                  href="/preferences"
                  className="hidden text-sm hover:underline sm:inline"
                >
                  Preferences
                </Link>
                <Link
                  href="/preferences"
                  aria-label="Search preferences"
                  className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground sm:hidden"
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                </Link>
              </nav>
              <HeaderDivider className="hidden sm:block" />
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className="text-sm hover:underline"
                >
                  Sign in
                </Link>
                <Link href="/signup">
                  <Button size="sm">Sign up</Button>
                </Link>
              </div>
            </>
          )}

          {!pending && me !== null && (
            <>
              <nav className="flex items-center gap-4">
                <span
                  className="hidden text-sm text-muted-foreground md:inline"
                  title={me.email ?? undefined}
                >
                  {me.display_name || me.email || "Signed in"}
                </span>
                {/* Saved + Preferences links only shown to consumers
                    — owner / admin / verifier roles don't have a
                    personal favorites or saved-search surface, so
                    these would dead-end on a "this isn't your
                    portal" page. */}
                {me.role === "CONSUMER" && (
                  <>
                    <Link
                      href="/favorites"
                      className="text-sm hover:underline"
                    >
                      Saved
                    </Link>
                    <Link
                      href="/preferences"
                      className="text-sm hover:underline"
                    >
                      Preferences
                    </Link>
                  </>
                )}
              </nav>
              <HeaderDivider />
              <Button
                size="sm"
                variant="outline"
                onClick={onSignOut}
                disabled={logout.isPending}
              >
                {logout.isPending ? "Signing out…" : "Sign out"}
              </Button>
            </>
          )}

          {/* Build-version tag intentionally NOT rendered here —
              it's internal metadata, and the footer already carries
              it for anyone debugging a deploy. */}
        </div>
      </div>
    </header>
  );
}

/**
 * Hairline vertical divider used between the nav and auth groups in
 * the header. Border instead of a real element so it can hide on
 * mobile without breaking the flex row.
 */
function HeaderDivider({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`h-6 w-px bg-border ${className}`}
    />
  );
}

/**
 * Tiny inline pointer for staff / owner accounts that landed on the
 * consumer site. Not a wall — they can still browse — but it tells
 * them where their actual home lives.
 */
function WrongAudienceCallout({ role }: { role: string }) {
  let label: string;
  let href: string | null;
  switch (role) {
    case "ADMIN":
    case "VERIFIER":
      label = "Open admin panel";
      // The admin panel is on a different origin in production.
      // The link points relative; if you deploy with a custom
      // domain, swap to that URL. For local dev (port 3001) the
      // browser's URL bar is the cleanest path anyway.
      href = "https://admin.trusthalal.org";
      break;
    case "OWNER":
      label = "Open owner portal";
      href = "https://owner.trusthalal.org";
      break;
    default:
      label = "";
      href = null;
  }
  if (!href) return null;
  return (
    <a
      href={href}
      className="hidden rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100 sm:inline-block dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900"
    >
      {label} →
    </a>
  );
}

/**
 * Sitewide footer.
 *
 * Three responsibilities, in order of weight:
 *   1. State the category claim: Trust Halal is the source of record
 *      for halal, and every claim is independently verified. The brand
 *      promise is data quality; the footer asserts it plainly rather
 *      than crediting some upstream "platform" (we are it).
 *   2. Quietly nudge restaurant operators toward the owner portal.
 *      Owners discover the consumer site organically (a customer
 *      shows them a listing) — the footer is the lowest-friction
 *      handoff into "claim your listing."
 *   3. Auxiliary nav (preferences, current build) without crowding
 *      the header.
 */
function SiteFooter() {
  return (
    <footer className="mt-12 border-t bg-card text-sm">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex flex-col gap-1">
          <span className="font-semibold tracking-tight">{BRAND_NAME}</span>
          <span className="text-xs text-muted-foreground">
            The source of record for halal restaurants. Every claim{" "}
            <a
              href={TRUST_HALAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              independently verified
            </a>
            , sourced, and open to dispute.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <Link href="/favorites" className="hover:underline">
            Saved
          </Link>
          <Link href="/preferences" className="hover:underline">
            Preferences
          </Link>
          <Link href="/become-a-verifier" className="hover:underline">
            Become a verifier →
          </Link>
          <a
            href={OWNER_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Own a restaurant? Claim your listing →
          </a>
          <VersionTag />
        </div>
      </div>
    </footer>
  );
}
