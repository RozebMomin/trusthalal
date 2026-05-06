"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCurrentUser } from "@/lib/api/hooks";
import { canAccess } from "@/lib/auth/panel-access";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

// The full menu. Each item is filtered by ``canAccess`` below so
// verifiers see only /claims and the dashboard, admins see everything.
// Adding a new page here + the right entry in PATH_ALLOWED_ROLES
// (panel-access.ts) is all it takes to surface or hide it for roles.
const items: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/places", label: "Places" },
  { href: "/halal-claims", label: "Halal claims" },
  { href: "/ownership-requests", label: "Ownership requests" },
  { href: "/users", label: "Users" },
  { href: "/organizations", label: "Organizations" },
];

export function AppNav() {
  const pathname = usePathname();
  const { data: me } = useCurrentUser();

  // Hide items the current user can't actually open. We default-show
  // if we don't have a role yet (`me` still loading) — AppShell is
  // already gatekeeping the render anyway, so a brief flash of the
  // full menu before the shell decides is not a real concern.
  const visibleItems = me
    ? items.filter((item) => canAccess(me.role, item.href))
    : items;

  return (
    <nav className="flex flex-col gap-1 p-4">
      <div className="mb-4 px-2 text-lg font-semibold tracking-tight">
        trusthalal admin
      </div>
      {visibleItems.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              active && "bg-accent text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
