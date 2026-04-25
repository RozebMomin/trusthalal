import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const surfaces = [
  {
    title: "Ownership requests",
    description:
      "Review merchant-submitted claim-this-place requests, approve with an existing or new organization, or reject.",
    href: "/ownership-requests",
  },
  {
    title: "Claims",
    description:
      "Verify, refresh, or dispute halal claims across places. Filter by status, method, or expiry window.",
    href: "/claims",
  },
  {
    title: "Places",
    description:
      "Search and edit the underlying catalog. Soft-delete, merge duplicates, attach external IDs.",
    href: "/places",
  },
  {
    title: "Users & orgs",
    description:
      "Manage internal roles, audit actor history, and curate the org directory that places can belong to.",
    href: "/users",
  },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">
          Start reviewing trusthalal activity from here.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {surfaces.map((s) => (
          <Card key={s.href}>
            <CardHeader>
              <CardTitle>{s.title}</CardTitle>
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
        ))}
      </section>
    </div>
  );
}
