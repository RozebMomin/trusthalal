"use client";

/**
 * Halal-preference filter panel.
 *
 * Collapsed by default below the search bar; expands inline when
 * the user clicks "Filters". The UI keeps things to a small,
 * decision-oriented set:
 *
 *   * Minimum validation tier (radio): the trust threshold the
 *     consumer cares about. Includes the picked tier and everything
 *     stricter — the server's ``min_validation_tier`` semantics.
 *   * Minimum menu posture (radio): how strict the kitchen needs to
 *     be. Same threshold semantics.
 *   * Three boolean chips: "no pork", "no alcohol on premises",
 *     "has certification on file". These map 1:1 to server-side
 *     ``no_pork`` / ``no_alcohol_served`` / ``has_certification``
 *     filters.
 *
 * Slaughter-method filters exist on the server (per-meat) but
 * aren't surfaced here — they're a power-user concern that adds
 * 4 dropdowns × 3 values to the UI for a small slice of users.
 * If/when consumer demand justifies it, the next iteration adds an
 * "Advanced" sub-section.
 *
 * State is owned by the parent (the search page) so the filter
 * values can flow back into the URL query string for shareable
 * links.
 */
import * as React from "react";

import { Button } from "@/components/ui/button";
import type {
  MenuPosture,
  SearchPlacesParams,
  ValidationTier,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const VALIDATION_TIER_OPTIONS: ReadonlyArray<{
  value: ValidationTier;
  label: string;
  description: string;
}> = [
  {
    value: "SELF_ATTESTED",
    label: "Any verified",
    description: "Owner-attested, certificate on file, or verifier-confirmed.",
  },
  {
    value: "CERTIFICATE_ON_FILE",
    label: "Certificate on file +",
    description: "Owner has a current cert, or a verifier confirmed in person.",
  },
  {
    value: "TRUST_HALAL_VERIFIED",
    label: "Verifier-confirmed only",
    description: "A Trust Halal verifier physically visited and confirmed.",
  },
];

const MENU_POSTURE_OPTIONS: ReadonlyArray<{
  value: MenuPosture;
  label: string;
}> = [
  { value: "FULLY_HALAL", label: "Fully halal only" },
  {
    value: "MIXED_SEPARATE_KITCHENS",
    label: "Includes separate halal kitchens",
  },
  {
    value: "HALAL_OPTIONS_ADVERTISED",
    label: "Includes halal-options menus",
  },
  { value: "HALAL_UPON_REQUEST", label: "Includes halal-on-request" },
  { value: "MIXED_SHARED_KITCHEN", label: "Any halal options" },
];

export function SearchFilters({
  filters,
  onChange,
}: {
  filters: SearchPlacesParams;
  onChange: (next: SearchPlacesParams) => void;
}) {
  const update = (patch: Partial<SearchPlacesParams>) => {
    onChange({ ...filters, ...patch });
  };

  const activeCount = countActiveFilters(filters);

  const [expanded, setExpanded] = React.useState(false);

  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-sm font-medium hover:underline"
        >
          {expanded ? "Hide filters" : "Filters"}
          {activeCount > 0 && (
            <span className="ml-2 rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
              {activeCount}
            </span>
          )}
        </button>
        {activeCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange(clearFilters(filters))}
          >
            Clear filters
          </Button>
        )}
      </div>

      {expanded && (
        <div className="grid gap-5 pt-2 sm:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Validation tier
            </legend>
            {VALIDATION_TIER_OPTIONS.map((opt) => {
              const isSelected = filters.min_validation_tier === opt.value;
              const id = `tier-${opt.value}`;
              return (
                <label
                  key={opt.value}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm transition",
                    isSelected
                      ? "border-foreground bg-accent/50"
                      : "hover:bg-accent/30",
                  )}
                >
                  <input
                    id={id}
                    type="radio"
                    name="min-validation-tier"
                    value={opt.value}
                    checked={isSelected}
                    onChange={() =>
                      update({ min_validation_tier: opt.value })
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <p className="font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {opt.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Menu posture
            </legend>
            {MENU_POSTURE_OPTIONS.map((opt) => {
              const isSelected = filters.min_menu_posture === opt.value;
              const id = `posture-${opt.value}`;
              return (
                <label
                  key={opt.value}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition",
                    isSelected
                      ? "border-foreground bg-accent/50"
                      : "hover:bg-accent/30",
                  )}
                >
                  <input
                    id={id}
                    type="radio"
                    name="min-menu-posture"
                    value={opt.value}
                    checked={isSelected}
                    onChange={() => update({ min_menu_posture: opt.value })}
                    className="mt-0.5"
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </fieldset>

          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Other preferences
            </legend>
            <div className="flex flex-wrap gap-2">
              <FilterToggle
                label="No pork"
                active={filters.no_pork === true}
                onClick={() =>
                  update({
                    no_pork: filters.no_pork === true ? undefined : true,
                  })
                }
              />
              <FilterToggle
                label="No alcohol on premises"
                active={filters.no_alcohol_served === true}
                onClick={() =>
                  update({
                    no_alcohol_served:
                      filters.no_alcohol_served === true ? undefined : true,
                  })
                }
              />
              <FilterToggle
                label="Has certification on file"
                active={filters.has_certification === true}
                onClick={() =>
                  update({
                    has_certification:
                      filters.has_certification === true ? undefined : true,
                  })
                }
              />
            </div>
          </fieldset>
        </div>
      )}
    </section>
  );
}

function FilterToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-medium transition",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-background hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

function countActiveFilters(f: SearchPlacesParams): number {
  let count = 0;
  if (f.min_validation_tier) count++;
  if (f.min_menu_posture) count++;
  if (f.no_pork === true) count++;
  if (f.no_alcohol_served === true) count++;
  if (f.has_certification === true) count++;
  return count;
}

function clearFilters(f: SearchPlacesParams): SearchPlacesParams {
  return {
    q: f.q,
    lat: f.lat,
    lng: f.lng,
    radius: f.radius,
    limit: f.limit,
    offset: f.offset,
  };
}
