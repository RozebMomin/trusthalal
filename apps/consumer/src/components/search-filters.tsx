"use client";

/**
 * Halal-preference filter panel.
 *
 * Three groups of pill chips, all visible at once — no disclosure.
 * Earlier iterations hid the filters behind a "Filters" toggle so the
 * search surface stayed terse, but burying every filter behind a tap
 * meant users coming in to refine spent two taps to do what should
 * have been one. The chip-pill pattern matches the radius selector
 * the near-me feature uses, so the whole search row feels uniform.
 *
 *   * Validation tier (single-select): trust threshold the consumer
 *     cares about. Picking the chip selects "this tier and stricter"
 *     — the server's ``min_validation_tier`` semantics.
 *   * Menu posture (single-select): how strict the kitchen needs to
 *     be. Same threshold semantics.
 *   * Other preferences (multi-toggle): "no pork", "no alcohol on
 *     premises", "has certification on file". Each is independent.
 *
 * Pills carry short, glance-able labels; the longer descriptive copy
 * (e.g. "Owner-attested, certificate on file, or verifier-confirmed")
 * is in the `title` attribute so desktop users get the rationale on
 * hover. Mobile users get the same single-tap behavior the radius
 * chips use without any disclosure overhead.
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
    label: "Certificate on file",
    description: "Owner has a current cert, or a verifier confirmed in person.",
  },
  {
    value: "TRUST_HALAL_VERIFIED",
    label: "Verifier-confirmed",
    description: "A Trust Halal verifier physically visited and confirmed.",
  },
];

const MENU_POSTURE_OPTIONS: ReadonlyArray<{
  value: MenuPosture;
  label: string;
  description: string;
}> = [
  {
    value: "FULLY_HALAL",
    label: "Fully halal",
    description: "Entire menu is halal. No non-halal proteins on premises.",
  },
  {
    value: "MIXED_SEPARATE_KITCHENS",
    label: "Separate kitchens",
    description:
      "Mixed menu, but halal items are prepared in physically separate equipment.",
  },
  {
    value: "HALAL_OPTIONS_ADVERTISED",
    label: "Halal options",
    description:
      "Halal items are clearly marked on the menu alongside non-halal.",
  },
  {
    value: "HALAL_UPON_REQUEST",
    label: "On request",
    description:
      "Halal items aren't advertised; the customer must explicitly ask.",
  },
  {
    value: "MIXED_SHARED_KITCHEN",
    label: "Any halal",
    description:
      "Halal proteins exist but are cooked on shared equipment with non-halal.",
  },
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

  return (
    <section className="space-y-4 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
              {activeCount}
            </span>
          )}
        </div>
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

      <FilterRow label="Validation">
        {VALIDATION_TIER_OPTIONS.map((opt) => {
          const isSelected = filters.min_validation_tier === opt.value;
          return (
            <FilterPill
              key={opt.value}
              active={isSelected}
              title={opt.description}
              onClick={() =>
                update({
                  min_validation_tier: isSelected ? undefined : opt.value,
                })
              }
            >
              {opt.label}
            </FilterPill>
          );
        })}
      </FilterRow>

      <FilterRow label="Menu posture">
        {MENU_POSTURE_OPTIONS.map((opt) => {
          const isSelected = filters.min_menu_posture === opt.value;
          return (
            <FilterPill
              key={opt.value}
              active={isSelected}
              title={opt.description}
              onClick={() =>
                update({
                  min_menu_posture: isSelected ? undefined : opt.value,
                })
              }
            >
              {opt.label}
            </FilterPill>
          );
        })}
      </FilterRow>

      <FilterRow label="Other preferences">
        <FilterPill
          active={filters.no_pork === true}
          onClick={() =>
            update({
              no_pork: filters.no_pork === true ? undefined : true,
            })
          }
        >
          No pork
        </FilterPill>
        <FilterPill
          active={filters.no_alcohol_served === true}
          onClick={() =>
            update({
              no_alcohol_served:
                filters.no_alcohol_served === true ? undefined : true,
            })
          }
        >
          No alcohol on premises
        </FilterPill>
        <FilterPill
          active={filters.has_certification === true}
          onClick={() =>
            update({
              has_certification:
                filters.has_certification === true ? undefined : true,
            })
          }
        >
          Has certification on file
        </FilterPill>
      </FilterRow>
    </section>
  );
}

/**
 * One row of pill chips with a small section label above. Used for
 * Validation tier / Menu posture / Other prefs.
 */
function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Single pill chip. Active state mirrors the radius pills in
 * NearMeButton — primary fill on selection — so the search row's
 * visual language stays consistent across distance and filter
 * controls.
 */
function FilterPill({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
      )}
    >
      {children}
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
