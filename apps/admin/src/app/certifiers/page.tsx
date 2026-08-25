"use client";

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminCertifiers } from "@/lib/api/hooks";

import { NewCertifierDialog } from "./_components/new-certifier-dialog";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function CertifiersPage() {
  const [rawQuery, setRawQuery] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const q = useDebounced(rawQuery.trim(), 250);

  const { data, isLoading, error } = useAdminCertifiers(q || undefined);
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Certifiers</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Canonical certifying bodies and their aliases. Linking a supplier
            line to a body here is what makes an acronym like &ldquo;HTO&rdquo;
            display as its full name everywhere.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="w-full sm:w-auto">
          New certifier
        </Button>
      </header>

      <NewCertifierDialog open={newOpen} onOpenChange={setNewOpen} />

      <div className="flex flex-wrap items-center gap-3 border-b pb-3">
        <div className="min-w-[240px] flex-1">
          <Input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search name, slug, or alias"
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Couldn&apos;t load certifiers.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Country</TableHead>
                <TableHead className="text-right">Aliases</TableHead>
                <TableHead className="text-right">Adverse events</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    No certifiers yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link href={`/certifiers/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                      <div className="font-mono text-[11px] text-muted-foreground">{c.slug}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.country_code ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.alias_count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.adverse_event_count > 0 ? (
                        <span className="font-medium text-destructive">{c.adverse_event_count}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
