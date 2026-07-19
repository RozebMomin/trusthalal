"use client";

/**
 * Reported-reviews queue.
 *
 * Named "reported reviews", not "review queue" — "review" already means
 * *staff adjudication* everywhere else in this product (UNDER_REVIEW,
 * reviewed_by, the halal-claim review queue), and a "review queue" here
 * would be ambiguous in exactly the wrong place.
 *
 * Grouped by review rather than by report: several complaints about the same
 * content are one decision, not several. Lands on OPEN — the "waiting on me"
 * bucket — with the resolved states available for auditing.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useReviewReports, type ReportStatus } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ key: ReportStatus; label: string }> = [
  { key: "OPEN", label: "Open" },
  { key: "UPHELD", label: "Upheld" },
  { key: "DISMISSED", label: "Dismissed" },
];

const REASON_LABEL: Record<string, string> = {
  SPAM: "Spam",
  OFF_TOPIC: "Off topic",
  HARASSMENT: "Harassment",
  FALSE_INFO: "False info",
  CONFLICT_OF_INTEREST: "Conflict of interest",
  OTHER: "Other",
};

function relative(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function ReportedReviewsPage() {
  const [status, setStatus] = React.useState<ReportStatus>("OPEN");
  const query = useReviewReports(status);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Reported reviews
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Published content flagged by a diner or an owner.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={status === f.key ? "default" : "ghost"}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {query.isLoading && <Skeleton className="h-48 w-full" />}

      {query.data && query.data.items.length === 0 && (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {status === "OPEN"
            ? "Nothing waiting. Reported reviews land here."
            : `No ${status.toLowerCase()} reports.`}
        </div>
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Place</TableHead>
                <TableHead>Content</TableHead>
                <TableHead className="w-[170px]">Reasons</TableHead>
                <TableHead className="w-[80px]">Reports</TableHead>
                <TableHead className="w-[100px]">Latest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((row) => (
                <TableRow
                  key={row.review_id}
                  className="cursor-pointer"
                  onClick={() => {
                    window.location.href = `/reported-reviews/${row.review_id}`;
                  }}
                >
                  <TableCell className="align-top">
                    <Link
                      href={`/reported-reviews/${row.review_id}`}
                      className="font-medium hover:underline"
                    >
                      {row.place_name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-600">
                        {"★".repeat(row.rating)}
                        <span className="text-muted-foreground/40">
                          {"★".repeat(5 - row.rating)}
                        </span>
                      </span>
                      {/* The owner's reply being the reported thing is a
                          first-class case, not an edge one — flag it up
                          front so the moderator reads the right text. */}
                      {row.targets_reply && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          Owner reply
                        </span>
                      )}
                      {row.review_status !== "PUBLISHED" && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {row.review_status}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                      {row.excerpt}
                    </p>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-1">
                      {row.reasons.map((r) => (
                        <span
                          key={r}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            r === "FALSE_INFO" || r === "HARASSMENT"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {REASON_LABEL[r] ?? r}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="align-top font-semibold">
                    {row.report_count}
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {relative(row.latest_report_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
