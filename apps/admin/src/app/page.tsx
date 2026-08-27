import Link from "next/link";
import {
  Building2,
  ClipboardCheck,
  Flag,
  KeyRound,
  ShieldCheck,
  Store,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Per-surface accent so the cards read as distinct launchers rather than one
// grey wall. Class strings are spelled out in full (not built at runtime) so
// Tailwind keeps them.
type Accent = { tile: string; border: string };
const ACCENTS: Record<string, Accent> = {
  emerald: {
    tile: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    border: "border-l-emerald-500",
  },
  blue: {
    tile: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
    border: "border-l-blue-500",
  },
  violet: {
    tile: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400",
    border: "border-l-violet-500",
  },
  rose: {
    tile: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400",
    border: "border-l-rose-500",
  },
  amber: {
    tile: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    border: "border-l-amber-500",
  },
  teal: {
    tile: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400",
    border: "border-l-teal-500",
  },
  indigo: {
    tile: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400",
    border: "border-l-indigo-500",
  },
};

type Surface = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: keyof typeof ACCENTS;
};

type Section = { title: string; blurb: string; items: Surface[] };

const sections: Section[] = [
  {
    title: "Review queues",
    blurb: "Things waiting on an admin decision.",
    items: [
      {
        title: "Verification visits",
        description:
          "Review verifier site visits, disclosure, observations, and tagged evidence photos. Accept to mark a place Trust Halal Verified.",
        href: "/verification-visits",
        icon: ShieldCheck,
        accent: "emerald",
      },
      {
        title: "Halal claims",
        description:
          "Review owner-submitted halal-posture claims. Approve to update a place's consumer-facing halal profile.",
        href: "/halal-claims",
        icon: ClipboardCheck,
        accent: "blue",
      },
      {
        title: "Verifier applications",
        description:
          "Review people applying to become community verifiers. Approve to grant the verifier role, or revoke/suspend later.",
        href: "/verifier-applications",
        icon: UserPlus,
        accent: "violet",
      },
      {
        title: "Ownership requests",
        description:
          "Review merchant claim-this-place requests. Approve with an existing or new organization, or reject.",
        href: "/ownership-requests",
        icon: KeyRound,
        accent: "amber",
      },
      {
        title: "Disputes",
        description:
          "Review consumer reports that a place's halal profile is wrong. Uphold or dismiss to clear the DISPUTED badge.",
        href: "/disputes",
        icon: Flag,
        accent: "rose",
      },
    ],
  },
  {
    title: "Catalog & people",
    blurb: "The underlying data behind the queues.",
    items: [
      {
        title: "Places",
        description:
          "Search and edit the underlying catalog. Soft-delete, merge duplicates, attach external IDs.",
        href: "/places",
        icon: Store,
        accent: "teal",
      },
      {
        title: "Users & orgs",
        description:
          "Manage internal roles, audit actor history, and curate the org directory that places can belong to.",
        href: "/users",
        icon: Building2,
        accent: "indigo",
      },
    ],
  },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Start reviewing Trust Halal activity from here.
        </p>
      </header>

      {sections.map((section) => (
        <section key={section.title} className="space-y-3">
          <div className="flex items-baseline gap-3 border-b pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </h2>
            <p className="text-xs text-muted-foreground/70">{section.blurb}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {section.items.map((s) => {
              const Icon = s.icon;
              const accent = ACCENTS[s.accent];
              return (
                <Link key={s.href} href={s.href} className="group block">
                  <Card
                    className={cn(
                      "h-full border-l-4 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
                      accent.border,
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                          accent.tile,
                        )}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold leading-tight">{s.title}</h3>
                          <span
                            aria-hidden="true"
                            className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                          >
                            →
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {s.description}
                        </p>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
