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

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { VersionTag } from "@/components/version-tag";
import {
  BRAND_NAME,
  FACEBOOK_URL,
  INSTAGRAM_URL,
  OWNER_GET_VERIFIED_URL,
  OWNER_PORTAL_URL,
  PRIVACY_URL,
  TERMS_URL,
  TIKTOK_URL,
  TRUST_HALAL_URL,
} from "@/lib/branding";
import { useCurrentUser, useLogout } from "@/lib/api/hooks";
import { TermsGate } from "@/components/terms-gate";
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
      {/* Renders nothing unless the signed-in account owes an
          acknowledgement. Deliberately NOT in the bare branch above — /login
          and /signup have no session to attach an acceptance to, and a
          blocking dialog over a sign-in form would lock out the one action
          that could resolve it. */}
      <TermsGate />
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
  // VERIFIERS are consumers-plus: they browse and save on this surface
  // exactly like a diner (they were consumers before approval), so they
  // are NOT a wrong audience here.
  const wrongAudience =
    me !== null && me.role !== "CONSUMER" && me.role !== "VERIFIER";

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
          <BrandMark className="h-8 w-8" />
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
                {/* Saved + Preferences are the personal consumer-surface
                    features. Consumers and verifiers both have them
                    (verifiers keep their diner surface after approval);
                    owner / admin roles don't, so they'd dead-end. */}
                {(me.role === "CONSUMER" || me.role === "VERIFIER") && (
                  <>
                    <Link
                      href="/favorites"
                      className="text-sm hover:underline"
                    >
                      Saved
                    </Link>
                    {/* Reachable from the nav rather than only from a
                        removal email. This is the one place a hidden or
                        removed review is visible to its author, so it can't
                        depend on an email arriving. */}
                    <Link
                      href="/my-reviews"
                      className="text-sm hover:underline"
                    >
                      Reviews
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
          <Link href="/my-reviews" className="hover:underline">
            Your reviews
          </Link>
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
            href={OWNER_GET_VERIFIED_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Own a restaurant? Claim your listing →
          </a>
          {/* Both legal pages live on the brand domain — one copy of each,
              one place to update. This footer had neither, on a site whose
              users write reviews and upload photos. */}
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
          <SocialLinks />
          <VersionTag />
        </div>
      </div>
    </footer>
  );
}

/**
 * Social icon links — Instagram, TikTok, Facebook. Brand glyphs are
 * single-path (simple-icons) so each is one <path fill="currentColor">;
 * colour inherits the muted footer tone and lifts to --foreground on
 * hover, matching the footer's text links.
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
