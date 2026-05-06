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

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { VersionTag } from "@/components/version-tag";
import { useCurrentUser, useLogout } from "@/lib/api/hooks";

const PUBLIC_BARE_PATHS = new Set<string>(["/login", "/signup"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { data: me, isLoading } = useCurrentUser();
  const isBare = PUBLIC_BARE_PATHS.has(pathname);

  // If the visitor is already signed in and lands on /login or
  // /signup, bounce them home — same behavior the owner portal has,
  // and saves users from a confusing "I'm logged in why am I on a
  // login form" moment.
  React.useEffect(() => {
    if (isLoading) return;
    if (me && isBare) {
      router.replace("/");
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
        <main className="flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PortalHeader me={me ?? null} />
      <main className="flex-1 px-4 py-8 md:px-8">{children}</main>
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
    <header className="border-b bg-card px-4 py-3 md:px-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-3 transition hover:opacity-80"
        >
          <span className="text-lg font-semibold tracking-tight">
            Trust Halal
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {wrongAudience && me && <WrongAudienceCallout role={me.role} />}

          {pending && (
            <span className="text-xs text-muted-foreground">…</span>
          )}

          {!pending && me === null && (
            <>
              <Link href="/login" className="text-sm hover:underline">
                Sign in
              </Link>
              <Link href="/signup">
                <Button size="sm">Sign up</Button>
              </Link>
            </>
          )}

          {!pending && me !== null && (
            <>
              <span
                className="hidden text-sm text-muted-foreground md:inline"
                title={me.email ?? undefined}
              >
                {me.display_name || me.email || "Signed in"}
              </span>
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

          <VersionTag className="hidden sm:inline" />
        </div>
      </div>
    </header>
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
