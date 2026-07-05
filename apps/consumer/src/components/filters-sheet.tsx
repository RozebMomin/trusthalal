"use client";

/**
 * Filters sheet — the consumer search surface's filter UI moved off
 * the home page into a sheet (mobile) / centered dialog (desktop).
 *
 * Why a sheet: pre-refactor, the filter pills (validation tier, menu
 * posture, cuisines, other prefs) ate ~19 chips above the fold. After
 * the aesthetic refresh that wall stuck out worse — pushing the actual
 * results below the fold defeats the purpose of search. This component
 * tucks the heavy filters behind a single "Filters" button next to
 * Near Me; active filters surface as removable chips above the
 * results via ``ActiveFiltersBar`` so the user knows what's narrowing
 * their list at a glance.
 *
 * Apply-immediately: every pill tap mutates the URL state right away.
 * No "preview then commit" pattern — simpler mental model, and the
 * results below are already updating live. The sheet just closes when
 * the user taps Done / outside / the close X.
 *
 * Uses the existing Radix Dialog primitive but with custom
 * positioning: bottom-aligned with rounded top corners on mobile,
 * centered modal on desktop. Same component handles both.
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { SlidersHorizontal, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import type {
  Cuisine,
  MenuPosture,
  SearchPlacesParams,
  ValidationTier,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Filter taxonomy — copy + ordering for each filter group.
// ---------------------------------------------------------------------------

const VALIDATION_TIER_OPTIONS: ReadonlyArray<{
  value: ValidationTier;
  label: string;
  description: string;
}> = [
  {
    value: "SELF_ATTESTED",
    label: "Any verified",
    description: "Owner-attested or stronger.",
  },
  {
    value: "CERTIFICATE_ON_FILE",
    label: "Cert on file",
    description: "Owner has a current halal certificate, or a verifier confirmed in person.",
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
    description: "Entire menu is halal.",
  },
  {
    value: "MIXED_SEPARATE_KITCHENS",
    label: "Separate kitchen",
    description: "Halal items prepared in physically separate equipment.",
  },
  {
    value: "HALAL_OPTIONS_ADVERTISED",
    label: "Halal options",
    description: "Halal items clearly marked alongside non-halal.",
  },
  {
    value: "HALAL_UPON_REQUEST",
    label: "On request",
    description: "Halal items only when explicitly asked for.",
  },
  {
    value: "MIXED_SHARED_KITCHEN",
    label: "Any halal",
    description: "Halal exists on the menu — shared equipment with non-halal.",
  },
];

const CUISINE_LABELS: Readonly<Record<Cuisine, string>> = {
  PAKISTANI: "Pakistani",
  INDIAN: "Indian",
  BANGLADESHI: "Bangladeshi",
  SRI_LANKAN: "Sri Lankan",
  NEPALI: "Nepali",
  LEBANESE: "Lebanese",
  TURKISH: "Turkish",
  YEMENI: "Yemeni",
  SYRIAN: "Syrian",
  PALESTINIAN: "Palestinian",
  IRAQI: "Iraqi",
  PERSIAN: "Persian",
  EGYPTIAN: "Egyptian",
  MOROCCAN: "Moroccan",
  TUNISIAN: "Tunisian",
  ALGERIAN: "Algerian",
  SOMALI: "Somali",
  ETHIOPIAN: "Ethiopian",
  ERITREAN: "Eritrean",
  AFGHAN: "Afghan",
  UZBEK: "Uzbek",
  INDONESIAN: "Indonesian",
  MALAYSIAN: "Malaysian",
  FILIPINO: "Filipino",
  THAI: "Thai",
  CHINESE: "Chinese",
  KOREAN: "Korean",
  JAPANESE: "Japanese",
  MEDITERRANEAN: "Mediterranean",
  GREEK: "Greek",
  ITALIAN: "Italian",
  SPANISH: "Spanish",
  AMERICAN: "American",
  MEXICAN: "Mexican",
  CARIBBEAN: "Caribbean",
  SOUL_FOOD: "Soul food",
  BURGERS: "Burgers",
  PIZZA: "Pizza",
  BBQ: "BBQ",
  STEAKHOUSE: "Steakhouse",
  SEAFOOD: "Seafood",
  SANDWICHES: "Sandwiches",
  DELI: "Deli",
  WINGS: "Wings",
  HOT_DOGS: "Hot dogs",
  BREAKFAST: "Breakfast",
  BAKERY: "Bakery",
  DESSERTS: "Desserts",
  CAFE: "Café",
};

const ALL_CUISINES: ReadonlyArray<Cuisine> = [
  "PAKISTANI",
  "INDIAN",
  "BANGLADESHI",
  "SRI_LANKAN",
  "NEPALI",
  "LEBANESE",
  "TURKISH",
  "YEMENI",
  "SYRIAN",
  "PALESTINIAN",
  "IRAQI",
  "PERSIAN",
  "EGYPTIAN",
  "MOROCCAN",
  "TUNISIAN",
  "ALGERIAN",
  "SOMALI",
  "ETHIOPIAN",
  "ERITREAN",
  "AFGHAN",
  "UZBEK",
  "INDONESIAN",
  "MALAYSIAN",
  "FILIPINO",
  "THAI",
  "CHINESE",
  "KOREAN",
  "JAPANESE",
  "MEDITERRANEAN",
  "GREEK",
  "ITALIAN",
  "SPANISH",
  "AMERICAN",
  "MEXICAN",
  "CARIBBEAN",
  "SOUL_FOOD",
  "BURGERS",
  "PIZZA",
  "BBQ",
  "STEAKHOUSE",
  "SEAFOOD",
  "SANDWICHES",
  "DELI",
  "WINGS",
  "HOT_DOGS",
  "BREAKFAST",
  "BAKERY",
  "DESSERTS",
  "CAFE",
];

// ---------------------------------------------------------------------------
// Active-filter counter — surfaces on the trigger button as a badge.
// Sums all axes (each cuisine counts individually) so the user knows
// how many narrowing constraints are active without opening the sheet.
// ---------------------------------------------------------------------------

export function countActiveFilters(filters: SearchPlacesParams): number {
  let count = 0;
  if (filters.min_validation_tier) count++;
  if (filters.min_menu_posture) count++;
  if (filters.no_pork === true) count++;
  if (filters.no_alcohol_served === true) count++;
  if (filters.has_certification === true) count++;
  if (filters.cuisines && filters.cuisines.length > 0) {
    count += filters.cuisines.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Reset — clears every category-level filter while preserving the
// query / geo / paging axes (those aren't filters in the user's
// mental model; they're search context).
// ---------------------------------------------------------------------------

export function clearAllFilters(filters: SearchPlacesParams): SearchPlacesParams {
  return {
    q: filters.q,
    lat: filters.lat,
    lng: filters.lng,
    radius: filters.radius,
    limit: filters.limit,
    offset: filters.offset,
  };
}

// ---------------------------------------------------------------------------
// Trigger — the inline button that opens the sheet. Lives in the
// page header next to Near Me. Renders an active-count badge when
// any filter is set.
// ---------------------------------------------------------------------------

export function FiltersTrigger({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium transition",
        count > 0
          ? "border-primary bg-primary/5 text-primary hover:bg-primary/10"
          : "border-input text-foreground hover:bg-accent",
      )}
    >
      <SlidersHorizontal className="h-4 w-4" aria-hidden />
      <span>Filters</span>
      {count > 0 && (
        <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
          {count}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// FiltersSheet — the sheet itself. Bottom-aligned on mobile,
// centered modal on desktop.
// ---------------------------------------------------------------------------

export function FiltersSheet({
  open,
  onOpenChange,
  filters,
  onChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  filters: SearchPlacesParams;
  onChange: (next: SearchPlacesParams) => void;
}) {
  const update = (patch: Partial<SearchPlacesParams>) => {
    onChange({ ...filters, ...patch });
  };

  const activeCount = countActiveFilters(filters);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            // Mobile = bottom sheet. Pinned to bottom of viewport,
            // rounded only on top, fills 85% of viewport height.
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t bg-background shadow-2xl",
            "pb-[env(safe-area-inset-bottom)]",
            // Desktop = centered modal. Override mobile positioning at
            // sm+ to lift the sheet off the bottom, cap width, round
            // all corners.
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2",
            "sm:w-full sm:max-w-md sm:max-h-[85dvh]",
            "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-0",
            // Animations: slide up from bottom on mobile, fade-zoom
            // on desktop. Radix's data-state attribute drives both.
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
            "sm:data-[state=open]:slide-in-from-top-[48%] sm:data-[state=closed]:slide-out-to-top-[48%]",
          )}
        >
          {/* Drag handle — purely decorative, signals "this can be
              dismissed" on mobile. Hidden on desktop where the X
              button does the same job. */}
          <div className="flex justify-center pt-2 sm:hidden">
            <span
              aria-hidden
              className="h-1.5 w-10 rounded-full bg-muted-foreground/30"
            />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3 sm:py-4">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
              Filters
            </DialogPrimitive.Title>
            <div className="flex items-center gap-2">
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={() => onChange(clearAllFilters(filters))}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  Clear all
                </button>
              )}
              <DialogPrimitive.Close
                aria-label="Close filters"
                className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Scrolling body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-6">
              <FilterSection
                title="Halal verification"
                hint="How strongly the halal claim is backed — pick the minimum proof you'll accept."
              >
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
              </FilterSection>

              <FilterSection title="Cuisines">
                {ALL_CUISINES.map((c) => {
                  const isOn =
                    filters.cuisines?.includes(c) ?? false;
                  return (
                    <FilterPill
                      key={c}
                      active={isOn}
                      onClick={() => {
                        const current = filters.cuisines ?? [];
                        const next = isOn
                          ? current.filter((x) => x !== c)
                          : [...current, c];
                        update({
                          cuisines: next.length === 0 ? undefined : next,
                        });
                      }}
                    >
                      {CUISINE_LABELS[c]}
                    </FilterPill>
                  );
                })}
              </FilterSection>

              <FilterSection
                title="How halal is the menu?"
                hint="From fully-halal kitchens down to halal-on-request — pick the minimum you'll accept."
              >
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
              </FilterSection>

              <FilterSection title="Other preferences">
                <FilterPill
                  active={filters.no_pork === true}
                  onClick={() =>
                    update({
                      no_pork: filters.no_pork === true ? undefined : true,
                    })
                  }
                >
                  Pork-free
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
                  Certificate on file
                </FilterPill>
              </FilterSection>
            </div>
          </div>

          {/* Sticky footer — single Done button. We apply changes
              immediately on every tap, so this is purely a "I'm finished
              browsing filters" confirmation, not a commit action.
              Rendered on desktop too: click-outside works, but an
              explicit Done gives the modal a clear exit and matches
              the mobile sheet's behavior. */}
          <div className="border-t bg-background/80 px-5 py-3 backdrop-blur sm:rounded-b-2xl">
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              className="w-full"
            >
              Done
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// FilterSection — labeled group of pills.
// ---------------------------------------------------------------------------

function FilterSection({
  title,
  hint,
  children,
}: {
  title: string;
  /** One-line plain-language explanation rendered under the title.
   *  Pill ``title`` attributes only surface on hover — useless on
   *  touch — so jargon-y sections (verification tiers, menu
   *  coverage) explain themselves inline. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {hint && (
          <p className="text-xs text-muted-foreground/80">{hint}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FilterPill — toggleable pill button. Active state uses the brand
// primary fill so a glance at the sheet shows what's narrowing the
// search.
// ---------------------------------------------------------------------------

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
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-foreground hover:border-foreground/40 hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
