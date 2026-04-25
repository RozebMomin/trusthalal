"use client";

import { ArrowUpDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  type PlacesOrderBy,
  useAdminPlaceCountries,
  useAdminPlaces,
} from "@/lib/api/hooks";

import { NewPlaceDialog } from "./_components/new-place-dialog";

// Radix <Select> can't hold an empty-string value, so the "All countries"
// option is keyed on a sentinel we translate to `undefined` before
// handing to the query hook.
const ANY_COUNTRY = "__any__";

/** Simple debounce — returns the latest value after `ms` idle time. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function PlacesPage() {
  const [rawQuery, setRawQuery] = React.useState("");
  const [rawCity, setRawCity] = React.useState("");
  // ANY_COUNTRY sentinel (see module-level comment) — translated to
  // undefined below before the query key is built.
  const [countryFilter, setCountryFilter] =
    React.useState<string>(ANY_COUNTRY);
  const [orderBy, setOrderBy] = React.useState<PlacesOrderBy>("updated_at");
  const [includeDeleted, setIncludeDeleted] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);

  // Debounce text inputs so we don't fire a request on every keystroke.
  // City uses the same 250ms as q for consistency — admins moving between
  // filters get a uniform feel.
  const query = useDebounced(rawQuery.trim(), 250);
  const city = useDebounced(rawCity.trim(), 250);

  const effectiveCountry =
    countryFilter === ANY_COUNTRY ? undefined : countryFilter;

  const { data, isLoading, error, isFetching } = useAdminPlaces({
    q: query || undefined,
    city: city || undefined,
    country: effectiveCountry,
    orderBy,
    includeDeleted,
  });

  // Populate the Country dropdown from distinct codes in the catalog —
  // stays in sync with reality instead of hardcoding a static list.
  const { data: countries } = useAdminPlaceCountries();

  const rows = data ?? [];

  // Clicking the City column header toggles between the default sort
  // (updated_at DESC — most recently edited first) and city-asc. Keeping
  // it binary matches the brief (a "toggle," not a full three-way cycle)
  // and defers descending-city + other-column sorts until they're
  // actually needed.
  const cityIsSorted = orderBy === "city";
  const onToggleCitySort = () =>
    setOrderBy(cityIsSorted ? "updated_at" : "city");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Places</h1>
          <p className="mt-2 text-muted-foreground">
            Browse, edit, and soft-delete places in the catalog.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>New place</Button>
      </header>

      <NewPlaceDialog open={newOpen} onOpenChange={setNewOpen} />

      <div className="flex flex-wrap items-center gap-3 border-b pb-3">
        <div className="flex-1 min-w-[240px]">
          <Input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search name or address"
          />
        </div>
        <div className="w-40">
          <Input
            type="search"
            value={rawCity}
            onChange={(e) => setRawCity(e.target.value)}
            placeholder="City"
            aria-label="Filter by city"
          />
        </div>
        <div className="w-36">
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger aria-label="Filter by country">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_COUNTRY}>All countries</SelectItem>
              {(countries ?? []).map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={!includeDeleted ? "default" : "ghost"}
            onClick={() => setIncludeDeleted(false)}
          >
            Active only
          </Button>
          <Button
            size="sm"
            variant={includeDeleted ? "default" : "ghost"}
            onClick={() => setIncludeDeleted(true)}
          >
            Include deleted
          </Button>
        </div>
      </div>

      {error && <ErrorState error={error as Error} />}

      {isLoading && <LoadingState />}

      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          query={query}
          city={city}
          country={effectiveCountry}
          includeDeleted={includeDeleted}
        />
      )}

      {!isLoading && !error && rows.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                {/*
                  City column doubles as the sort toggle for the brief.
                  aria-sort lives on the TableHead (the columnheader role)
                  rather than the inner button — putting it on <button>
                  triggers a jsx-a11y warning since buttons don't support
                  the attribute. Screen readers announce the sort state
                  via the header, which is the ARIA-recommended place.
                */}
                <TableHead
                  aria-sort={cityIsSorted ? "ascending" : "none"}
                >
                  <button
                    type="button"
                    onClick={onToggleCitySort}
                    className="inline-flex items-center gap-1 text-left text-inherit hover:underline"
                    aria-label={
                      cityIsSorted
                        ? "Sorted by city (ascending); click to reset sort"
                        : "Sort by city"
                    }
                  >
                    City
                    {cityIsSorted ? (
                      <ArrowUp className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Coordinates</TableHead>
                <TableHead>Place id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={
                    row.is_deleted
                      ? "bg-muted/30 text-muted-foreground hover:bg-accent/50"
                      : "hover:bg-accent/50"
                  }
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/places/${row.id}`}
                        className={
                          row.is_deleted
                            ? "text-muted-foreground hover:underline"
                            : "text-foreground hover:underline"
                        }
                      >
                        {row.name}
                      </Link>
                      {row.is_deleted && (
                        <Badge variant="destructive" className="shrink-0">
                          Deleted
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.address || (
                      <span className="italic">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.city || (
                      <span className="italic text-muted-foreground">
                        &mdash;
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.country_code || (
                      <span className="italic text-muted-foreground">
                        &mdash;
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {row.lat.toFixed(4)}, {row.lng.toFixed(4)}
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-xs">
                      {row.id.slice(0, 8)}…
                    </code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {isFetching && !isLoading && (
        <p className="text-xs text-muted-foreground">Refreshing…</p>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

function EmptyState({
  query,
  city,
  country,
  includeDeleted,
}: {
  query: string;
  city: string;
  country: string | undefined;
  includeDeleted: boolean;
}) {
  // Build a human description of whatever filters are active so the
  // empty state tells the admin what they've narrowed to, not just "no
  // matches." Avoids the "I searched for nothing but there's nothing"
  // confusion when a filter is hidden off-viewport.
  const activeFilters: string[] = [];
  if (query) activeFilters.push(`name/address "${query}"`);
  if (city) activeFilters.push(`city "${city}"`);
  if (country) activeFilters.push(`country ${country}`);

  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <p className="text-sm text-muted-foreground">
        {activeFilters.length > 0
          ? `No places match ${activeFilters.join(" + ")}${
              includeDeleted ? " (including deleted)" : ""
            }.`
          : "No places found."}
      </p>
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  const hint =
    error.message === "Failed to fetch"
      ? "Check that trusthalal-api is running and CORS allows http://localhost:3001."
      : isApi && error.status === 401
        ? "Your session expired. Sign out and sign in again."
        : isApi && error.status === 403
          ? "Your account doesn't have admin access to this resource."
          : null;

  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p className="font-medium">
        Failed to load places
        {isApi && ` (HTTP ${error.status})`}
      </p>
      <p>{error.message}</p>
      {hint && <p className="text-destructive/80">{hint}</p>}
    </div>
  );
}
