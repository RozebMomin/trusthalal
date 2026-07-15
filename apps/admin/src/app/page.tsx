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

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Surface = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const surfaces: Surface[] = [
  {
    title: "Halal claims",
    description:
      "Review owner-submitted halal-posture verifications. Approve to update a place's consumer-facing halal profile.",
    href: "/halal-claims",
    icon: ClipboardCheck,
  },
  {
    title: "Verifier applications",
    description:
      "Review people applying to become community verifiers. Approve to grant the verifier role, or revoke/suspend later.",
    href: "/verifier-applications",
    icon: UserPlus,
  },
  {
    title: "Verification visits",
    description:
      "Review verifier-submitted site visits — disclosure, observations, and tagged evidence photos. Accept to mark the place Trust Halal Verified.",
    href: "/verification-visits",
    icon: ShieldCheck,
  },
  {
    title: "Disputes",
    description:
      "Review consumer reports that a place's halal profile is wrong. Resolve uphold or dismiss to clear the DISPUTED badge.",
    href: "/disputes",
    icon: Flag,
  },
  {
    title: "Ownership requests",
    description:
      "Review merchant-submitted claim-this-place requests, approve with an existing or new organization, or reject.",
    href: "/ownership-requests",
    icon: KeyRound,
  },
  {
    title: "Places",
    description:
      "Search and edit the underlying catalog. Soft-delete, merge duplicates, attach external IDs.",
    href: "/places",
    icon: Store,
  },
  {
    title: "Users & orgs",
    description:
      "Manage internal roles, audit actor history, and curate the org directory that places can belong to.",
    href: "/users",
    icon: Building2,
  },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Start reviewing trusthalal activity from here.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {surfaces.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.href}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  {s.title}
                </CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <a
                  href={s.href}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open →
                </a>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
