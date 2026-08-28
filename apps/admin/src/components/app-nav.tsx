"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  Building2,
  ClipboardCheck,
  Factory,
  Flag,
  ImageOff,
  KeyRound,
  LayoutDashboard,
  MessageSquareWarning,
  ShieldCheck,
  Store,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { useCurrentUser } from "@/lib/api/hooks";
import { canAccess } from "@/lib/auth/panel-access";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavSection = { title?: string; items: NavItem[] };

// The full menu, grouped into labeled sections so a long flat list doesn't
// read as a jumble. Each item is still filtered by ``canAccess`` below (so
// verifiers see only their subset); a section whose items are all hidden
// drops its header too. Adding a new page = drop it in the right section +
// add its PATH_ALLOWED_ROLES entry (panel-access.ts).
const sections: NavSection[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/insights", label: "Trending", icon: TrendingUp },
    ],
  },
  {
    title: "Review queues",
    items: [
      { href: "/verification-visits", label: "Verification visits", icon: ShieldCheck },
      { href: "/halal-claims", label: "Halal claims", icon: ClipboardCheck },
      { href: "/verifier-applications", label: "Verifier applications", icon: UserPlus },
      { href: "/ownership-requests", label: "Ownership requests", icon: KeyRound },
      { href: "/disputes", label: "Disputes", icon: Flag },
      { href: "/reported-reviews", label: "Reported reviews", icon: MessageSquareWarning },
      { href: "/reported-photos", label: "Reported photos", icon: ImageOff },
    ],
  },
  {
    title: "Registry",
    items: [
      { href: "/places", label: "Places", icon: Store },
      { href: "/suppliers", label: "Suppliers", icon: Factory },
      { href: "/certifiers", label: "Certifiers", icon: Award },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/users", label: "Users", icon: Users },
      { href: "/organizations", label: "Organizations", icon: Building2 },
    ],
  },
];

export function AppNav() {
  const pathname = usePathname();
  const { data: me } = useCurrentUser();

  // Hide items the current user can't actually open. We default-show
  // if we don't have a role yet (`me` still loading): AppShell is
  // already gatekeeping the render anyway, so a brief flash of the
  // full menu before the shell decides is not a real concern. A section
  // with no visible items is dropped along with its header.
  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: me
        ? section.items.filter((item) => canAccess(me.role, item.href))
        : section.items,
    }))
    .filter((section) => section.items.length > 0);

  const renderLink = (item: NavItem) => {
    const active =
      item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          active && "bg-accent text-accent-foreground",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav className="flex flex-col gap-1 p-4">
      {/* Brand block at the top of the sidebar / drawer. Two lines:
          the wordmark in proper title case ("Trust Halal") and a
          smaller "Admin portal" qualifier underneath, matching the
          pattern used in the owner-portal header. The old single-
          line "trusthalal admin" felt like a slug rather than a
          brand, capitalization signals a polished surface, and
          the explicit qualifier tells someone landing on the
          mobile drawer which Trust Halal surface they're on. */}
      <div className="mb-4 flex items-center gap-2.5 px-2">
        <BrandMark className="h-8 w-8" />
        <span className="flex flex-col gap-0.5 leading-tight">
          <span className="text-lg font-semibold tracking-tight">
            Trust Halal
          </span>
          <span className="text-xs text-muted-foreground">Admin portal</span>
        </span>
      </div>
      {visibleSections.map((section, i) => (
        <div key={section.title ?? "primary"} className={cn(i > 0 && "mt-4")}>
          {section.title ? (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {section.title}
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            {section.items.map(renderLink)}
          </div>
        </div>
      ))}
    </nav>
  );
}
