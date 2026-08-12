"use client";

/**
 * "Bulk add places" dialog.
 *
 * Flow (staging → preview → confirm → import), tuned for the real admin task:
 * "I have a handful of restaurant names, let me search, select, and add them."
 *
 *   1. Admin searches Google Places and picks results, one at a time; each pick
 *      is appended to a staging list (name + address, from the Autocomplete
 *      session, no server call). The search input clears after each add
 *      (via a remounting `key`) so the next name can be typed immediately.
 *   2. Whenever the staged list changes, a cheap, Google-free preview runs
 *      (`/admin/places/bulk/preview`) and tags each row New / In catalog /
 *      Deleted. Duplicates are auto-deselected so the default import is "only
 *      the genuinely new ones," but the admin can re-check any row.
 *   3. "Import N selected" ingests the checked rows server-side
 *      (`/admin/places/bulk/import`): one transaction each, so a bad row
 *      never sinks the batch, and the dialog switches to a results summary.
 *
 * Like the single New Place dialog, this works without a Google Maps key: the
 * Autocomplete component renders a setup banner and nothing can be staged.
 */

import Link from "next/link";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type PlaceBulkImportItem,
  type PlaceBulkImportResponse,
  type PlaceBulkPreviewStatus,
  useBulkImportPlaces,
  useBulkPreviewPlaces,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

import {
  GooglePlacesAutocomplete,
  type PickedPlace,
} from "./google-places-autocomplete";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Server caps a batch at 25 (see BULK_PLACE_LIMIT). Mirror it here so the UI
// stops the admin from staging a 26th row instead of letting the import 422.
const MAX_BATCH = 25;

export function BulkAddPlacesDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const preview = useBulkPreviewPlaces();
  const bulkImport = useBulkImportPlaces();

  // Staged picks, in the order the admin added them.
  const [staged, setStaged] = React.useState<PickedPlace[]>([]);
  // Dedup verdict per place_id, from the last preview run. Absent = unknown yet.
  const [statusById, setStatusById] = React.useState<
    Record<string, PlaceBulkPreviewStatus>
  >({});
  // place_ids the admin has excluded from import (either manually, or
  // auto-excluded because preview found them already in the catalog).
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  // Remount key for the Autocomplete input, bumping it clears the textbox
  // after each add so the next search starts empty.
  const [searchKey, setSearchKey] = React.useState(0);
  // Set once the import has run, switches the dialog to the results view.
  const [results, setResults] = React.useState<PlaceBulkImportResponse | null>(
    null,
  );

  // Fresh state every open so an abandoned session doesn't leak into the next.
  React.useEffect(() => {
    if (open) {
      setStaged([]);
      setStatusById({});
      setExcluded(new Set());
      setSearchKey(0);
      setResults(null);
    }
  }, [open]);

  // ------------------------------------------------------------------
  // Cheap dedup preview, re-run whenever the set of staged IDs changes.
  // Serialising + sorting the IDs gives a stable dependency so we don't
  // re-fire on unrelated re-renders. A ref guards against duplicate calls
  // for the same key (React effects can run twice in dev StrictMode).
  // ------------------------------------------------------------------
  const stagedKey = React.useMemo(
    () =>
      staged
        .map((p) => p.place_id)
        .sort()
        .join(","),
    [staged],
  );
  const lastPreviewedKey = React.useRef<string | null>(null);
  const previewMutate = preview.mutateAsync;

  React.useEffect(() => {
    if (!stagedKey) {
      lastPreviewedKey.current = "";
      return;
    }
    if (lastPreviewedKey.current === stagedKey) return;
    lastPreviewedKey.current = stagedKey;

    let cancelled = false;
    void (async () => {
      try {
        const res = await previewMutate({
          google_place_ids: stagedKey.split(","),
        });
        if (cancelled) return;
        const next: Record<string, PlaceBulkPreviewStatus> = {};
        const dupes: string[] = [];
        for (const item of res.items) {
          next[item.google_place_id] = item.status;
          if (item.status !== "NEW") dupes.push(item.google_place_id);
        }
        setStatusById(next);
        // Auto-deselect anything already in the catalog. Only ADD to the
        // excluded set so a manual re-check of a NEW row survives.
        if (dupes.length) {
          setExcluded((prev) => {
            const merged = new Set(prev);
            for (const id of dupes) merged.add(id);
            return merged;
          });
        }
      } catch {
        // Preview is a convenience; on failure we just show no badges and
        // let the admin import anyway (import is still dedup-safe).
        if (!cancelled) setStatusById({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stagedKey, previewMutate]);

  function addPick(pick: PickedPlace) {
    setStaged((prev) => {
      if (prev.length >= MAX_BATCH) {
        toast({
          title: "Batch is full",
          description: `You can stage up to ${MAX_BATCH} places at a time.`,
          variant: "destructive",
        });
        return prev;
      }
      if (prev.some((p) => p.place_id === pick.place_id)) return prev; // dedup
      return [...prev, pick];
    });
    // New stagings start selected (assume new until preview says otherwise).
    setExcluded((prev) => {
      if (!prev.has(pick.place_id)) return prev;
      const next = new Set(prev);
      next.delete(pick.place_id);
      return next;
    });
    setSearchKey((n) => n + 1); // clear the search box for the next name
  }

  function removeStaged(placeId: string) {
    setStaged((prev) => prev.filter((p) => p.place_id !== placeId));
  }

  function toggleExcluded(placeId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }

  const selectedIds = staged
    .map((p) => p.place_id)
    .filter((id) => !excluded.has(id));

  async function onImport() {
    if (!selectedIds.length || bulkImport.isPending) return;
    try {
      const res = await bulkImport.mutateAsync({
        google_place_ids: selectedIds,
      });
      setResults(res);
      const { created, existed, soft_deleted, failed } = res.summary;
      toast({
        title: "Import complete",
        description: `${created} added · ${existed} already here · ${soft_deleted} deleted · ${failed} failed`,
        variant: failed > 0 ? "destructive" : "success",
      });
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't import places",
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  // Radix Dialog's DismissableLayer + FocusScope intercept pointer/focus
  // events outside the dialog. Google Autocomplete portals its dropdown
  // (`.pac-container`) onto document.body, outside the dialog subtree, so
  // without this, clicking a prediction dismisses the dialog or steals focus
  // before the pick commits. Suppress those events when they originate in the
  // dropdown. (Same guard as the single New Place dialog.)
  const suppressAutocompleteOutside = React.useCallback((e: Event) => {
    const detailTarget = (
      e as CustomEvent<{ originalEvent: Event }>
    )?.detail?.originalEvent?.target as HTMLElement | null | undefined;
    const eventTarget = e.target as HTMLElement | null;
    if (
      detailTarget?.closest?.(".pac-container") ||
      eventTarget?.closest?.(".pac-container")
    ) {
      e.preventDefault();
    }
  }, []);

  const busy = bulkImport.isPending;
  const full = staged.length >= MAX_BATCH;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        onPointerDownOutside={suppressAutocompleteOutside}
        onFocusOutside={suppressAutocompleteOutside}
        onInteractOutside={suppressAutocompleteOutside}
      >
        <DialogHeader>
          <DialogTitle>Bulk add places</DialogTitle>
          <DialogDescription>
            {results
              ? "Import results. New places are now in the catalog."
              : "Search and stage up to 25 places, then import them together. Ones already in the catalog are flagged and skipped by default."}
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <ResultsView results={results} />
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-place-search">Add a place</Label>
              <GooglePlacesAutocomplete
                key={searchKey}
                id="bulk-place-search"
                autoFocus
                disabled={busy || full}
                placeholder="Search a name, e.g. Halal Guys"
                onPick={addPick}
              />
              {full && (
                <p className="text-xs text-muted-foreground">
                  Batch is full ({MAX_BATCH}). Remove a row to add another.
                </p>
              )}
            </div>

            {staged.length > 0 && (
              <StagedList
                staged={staged}
                statusById={statusById}
                excluded={excluded}
                onToggle={toggleExcluded}
                onRemove={removeStaged}
                previewing={preview.isPending}
              />
            )}
          </div>
        )}

        <DialogFooter className="mt-6">
          {results ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={onImport}
                disabled={selectedIds.length === 0 || busy}
              >
                {busy
                  ? "Importing…"
                  : selectedIds.length
                    ? `Import ${selectedIds.length} selected`
                    : "Import selected"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Staging list, one row per staged place with a dedup badge + include toggle.
// ---------------------------------------------------------------------------

function StagedList({
  staged,
  statusById,
  excluded,
  onToggle,
  onRemove,
  previewing,
}: {
  staged: PickedPlace[];
  statusById: Record<string, PlaceBulkPreviewStatus>;
  excluded: Set<string>;
  onToggle: (placeId: string) => void;
  onRemove: (placeId: string) => void;
  previewing: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Staged ({staged.length})
        </p>
        {previewing && (
          <span className="text-xs text-muted-foreground">Checking…</span>
        )}
      </div>
      <ul className="divide-y rounded-md border">
        {staged.map((p) => {
          const status = statusById[p.place_id];
          const included = !excluded.has(p.place_id);
          return (
            <li
              key={p.place_id}
              className="flex items-start gap-3 p-3 text-sm"
            >
              <input
                type="checkbox"
                checked={included}
                onChange={() => onToggle(p.place_id)}
                aria-label={`Include ${p.name ?? "this place"}`}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">
                    {p.name || (
                      <span className="italic text-muted-foreground">
                        Unnamed place
                      </span>
                    )}
                  </span>
                  {status && <PreviewBadge status={status} />}
                </div>
                {p.formatted_address && (
                  <p className="truncate text-muted-foreground">
                    {p.formatted_address}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemove(p.place_id)}
                aria-label={`Remove ${p.name ?? "this place"}`}
                className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PreviewBadge({ status }: { status: PlaceBulkPreviewStatus }) {
  if (status === "NEW") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
      >
        New
      </Badge>
    );
  }
  if (status === "SOFT_DELETED") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 text-amber-600 dark:text-amber-400"
      >
        Previously deleted
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-muted-foreground">
      Already in catalog
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Results view, per-item outcomes + roll-up summary.
// ---------------------------------------------------------------------------

function ResultsView({ results }: { results: PlaceBulkImportResponse }) {
  const { created, existed, soft_deleted, failed } = results.summary;
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <SummaryPill label="Added" value={created} tone="good" />
        <SummaryPill label="Already here" value={existed} tone="muted" />
        <SummaryPill label="Deleted" value={soft_deleted} tone="warn" />
        <SummaryPill label="Failed" value={failed} tone="bad" />
      </div>
      <ul className="divide-y rounded-md border">
        {results.items.map((item) => (
          <ResultRow key={item.google_place_id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function ResultRow({ item }: { item: PlaceBulkImportItem }) {
  const name = item.place_name || item.google_place_id;
  return (
    <li className="flex items-start justify-between gap-3 p-3 text-sm">
      <div className="min-w-0 flex-1">
        {item.place_id ? (
          <Link
            href={`/places/${item.place_id}`}
            className="truncate font-medium text-foreground hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate font-medium text-foreground">{name}</span>
        )}
        {item.outcome === "FAILED" && item.error_message && (
          <p className="text-xs text-destructive">{item.error_message}</p>
        )}
      </div>
      <OutcomeBadge outcome={item.outcome} />
    </li>
  );
}

function OutcomeBadge({ outcome }: { outcome: PlaceBulkImportItem["outcome"] }) {
  switch (outcome) {
    case "CREATED":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
        >
          Added
        </Badge>
      );
    case "SOFT_DELETED":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/40 text-amber-600 dark:text-amber-400"
        >
          Deleted, not restored
        </Badge>
      );
    case "FAILED":
      return <Badge variant="destructive">Failed</Badge>;
    case "EXISTED":
    default:
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          Already here
        </Badge>
      );
  }
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "muted" | "warn" | "bad";
}) {
  const toneClass = {
    good: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
    muted: "border-border text-muted-foreground",
    warn: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    bad: "border-destructive/40 text-destructive",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${toneClass}`}
    >
      <span className="tabular-nums">{value}</span>
      {label}
    </span>
  );
}
