"use client";

/**
 * Engagement / trending read-out over the first-party place_signals capture.
 * Top places by a weighted engagement score over a recent window, with the
 * signal breakdown and momentum vs the previous window of the same length.
 */

import Link from "next/link";
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api/client";
import { useAdminTrending } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function Momentum({ total, prev }: { total: number; prev: number }) {
  if (prev === 0) {
    return total > 0 ? (
      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        New
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  }
  const pct = Math.round(((total - prev) / prev) * 100);
  if (pct > 0) {
    return (
      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        ▲ {pct}%
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
        ▼ {Math.abs(pct)}%
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">0%</span>;
}

export default function InsightsPage() {
  const [days, setDays] = React.useState<number>(7);
  const { data, isLoading, error, isFetching } = useAdminTrending({ window: days });

  const rows = data?.places ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Trending</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Where attention is going, from the first-party engagement signals.
            Score weights actions over views (directions and reviews count most).
          </p>
        </div>
        <div className="inline-flex rounded-md border p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              className={cn(
                "rounded px-3 py-1.5 text-sm font-medium transition-colors",
                days === w.days
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Active places" value={summary.active_places} />
          <Metric label="Views" value={summary.total_views} />
          <Metric label="Directions" value={summary.total_directions} />
          <Metric label="Total signals" value={summary.total_signals} />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          Couldn&apos;t load trending
          {error instanceof ApiError ? ` (HTTP ${error.status})` : ""}.
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Place</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Views</TableHead>
              <TableHead className="text-right">Directions</TableHead>
              <TableHead className="text-right">Other</TableHead>
              <TableHead className="text-right">vs prev</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {!isLoading && rows.length === 0 && !error && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No engagement recorded in this window yet.
                </TableCell>
              </TableRow>
            )}

            {rows.map((p, i) => {
              const other = p.called + p.shared + p.favorited + p.reviewed;
              return (
                <TableRow key={p.place_id} className={cn(isFetching && "opacity-70")}>
                  <TableCell className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/places/${p.place_id}`}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[p.city, p.region].filter(Boolean).join(", ")}
                      {p.is_deleted ? " · deleted" : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {p.score.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {p.views.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {p.directions.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {other.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Momentum total={p.total} prev={p.prev_total} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Signals are deduped to one per person, place, and day, so counts are
        distinct people — not page refreshes. Momentum compares this window to
        the previous one of the same length.
      </p>
    </div>
  );
}
