"use client";

/**
 * Reported-photos queue.
 *
 * This surface has to exist now that owners can only *report* diner photos
 * rather than delete them — without it, a report goes nowhere and the
 * restriction is just a dead end for the restaurant.
 *
 * Thumbnails in the list, because a photo decision is made by looking. A
 * row of reason chips can't tell you whether an image is actually of the
 * wrong storefront.
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
import { usePhotoReports, type ReportStatus } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ key: ReportStatus; label: string }> = [
  { key: "OPEN", label: "Open" },
  { key: "UPHELD", label: "Upheld" },
  { key: "DISMISSED", label: "Dismissed" },
];

const REASON_LABEL: Record<string, string> = {
  NOT_THIS_PLACE: "Not this place",
  INAPPROPRIATE: "Inappropriate",
  MISLEADING: "Misleading",
  PERSONAL_INFO: "Personal info",
  COPYRIGHT: "Copyright",
  OTHER: "Other",
};

const ATTRIBUTION_LABEL: Record<string, string> = {
  OWNER: "Restaurant",
  DINER: "Diner",
  REVIEW: "From a review",
  GOOGLE: "Google",
};

function relative(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function ReportedPhotosPage() {
  const [status, setStatus] = React.useState<ReportStatus>("OPEN");
  const query = usePhotoReports(status);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Reported photos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Restaurants can report a diner&rsquo;s photo but can&rsquo;t remove
          it. That decision is yours.
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
            ? "Nothing waiting. Reported photos land here."
            : `No ${status.toLowerCase()} reports.`}
        </div>
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Photo</TableHead>
                <TableHead className="w-[180px]">Place</TableHead>
                <TableHead className="w-[140px]">Source</TableHead>
                <TableHead>Reasons</TableHead>
                <TableHead className="w-[80px]">Reports</TableHead>
                <TableHead className="w-[100px]">Latest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((row) => (
                <TableRow
                  key={row.photo_id}
                  className="cursor-pointer"
                  onClick={() => {
                    window.location.href = `/reported-photos/${row.photo_id}`;
                  }}
                >
                  <TableCell className="align-top">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={row.url}
                      alt=""
                      className="h-14 w-14 rounded border object-cover"
                      loading="lazy"
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    <Link
                      href={`/reported-photos/${row.photo_id}`}
                      className="font-medium hover:underline"
                    >
                      {row.place_name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <div>{ATTRIBUTION_LABEL[row.attribution]}</div>
                    {row.uploader_display_name && (
                      <div className="text-xs text-muted-foreground">
                        {row.uploader_display_name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-1">
                      {row.reasons.map((r) => (
                        <span
                          key={r}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            r === "INAPPROPRIATE" || r === "PERSONAL_INFO"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {REASON_LABEL[r] ?? r}
                        </span>
                      ))}
                    </div>
                    {/* Worth seeing at a glance: a restaurant reporting a
                        photo of its own food has an interest in the outcome
                        that a passing diner doesn't. */}
                    {row.reported_by_owner && (
                      <div className="mt-1 text-[11px] font-semibold text-amber-700">
                        Reported by the restaurant
                      </div>
                    )}
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
