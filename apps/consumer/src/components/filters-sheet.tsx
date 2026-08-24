"use client";

/**
 * Filters sheet, the consumer search surface's filter UI moved off
 * the home page into a sheet (mobile) / centered dialog (desktop).
 *
 * Why a sheet: pre-refactor, the filter pills (validation tier, menu
 * posture, cuisines, other prefs) ate ~19 chips above the fold. After
 * the aesthetic refresh that wall stuck out worse, pushing the actual
 * results below the fold defeats the purpose of search. This component
 * tucks the heavy filters behind a single "Filters" button next to
 * Near Me; active filters surface as removable chips above the
 * results via ``ActiveFiltersBar`` so the user knows what's narrowing
 * their list at a glance.
 *
 * Apply-immediately: every pill tap mutates the URL state right away.
 * No "preview then commit" pattern, simpler mental model, and the
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
// Slaughter-method taxonomy. Per-meat, multi-select. Only the two
// user-selectable methods (hand vs machine) are togglable, the wire
// enum also carries NOT_SERVED / NOT_DISCLOSED but those aren't filters
// a diner picks.
// ---------------------------------------------------------------------------

/** Per-meat filter fields on SearchPlacesParams. Chicken is on the hand/machine
 *  axis; beef/lamb/goat are on the zabihah axis. */
type MeatFilterField =
  | "chicken_slaughter"
  | "beef_zabihah"
  | "lamb_zabihah"
  | "goat_zabihah";

const MEAT_FILTER_FIELDS: ReadonlyArray<MeatFilterField> = [
  "chicken_slaughter",
  "beef_zabihah",
  "lamb_zabihah",
  "goat_zabihah",
];

// Chicken keeps hand/machine (the poultry debate); red meat uses a zabihah
// toggle plus an "include unsure" option (adding UNSURE broadens the filter).
const CHICKEN_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "HAND_CUT", label: "Hand-cut" },
  { value: "MACHINE_CUT", label: "Machine-cut" },
];
const ZABIHAH_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "ZABIHAH", label: "Zabihah" },
  { value: "UNSURE", label: "Include unsure" },
];

const MEAT_FILTERS: ReadonlyArray<{
  field: MeatFilterField;
  label: string;
  choices: ReadonlyArray<{ value: string; label: string }>;
}> = [
  { field: "chicken_slaughter", label: "Chicken", choices: CHICKEN_CHOICES },
  { field: "beef_zabihah", label: "Beef", choices: ZABIHAH_CHOICES },
  { field: "lamb_zabihah", label: "Lamb", choices: ZABIHAH_CHOICES },
  { field: "goat_zabihah", label: "Goat", choices: ZABIHAH_CHOICES },
];

// ---------------------------------------------------------------------------
// Family-amenity priority boosts. NOT restrictive, these re-rank rather
// than filter, so they're deliberately kept out of the active-filter
// count and styled as a distinct "prioritize" section.
// ---------------------------------------------------------------------------

const AMENITY_BOOSTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "PRAYER_SPACE", label: "Prayer space" },
  { value: "WUDU", label: "Wudu area" },
  { value: "BIDET", label: "Bidet" },
  { value: "BABY_CHANGING", label: "Baby changing" },
];

// ---------------------------------------------------------------------------
// Filter taxonomy, copy + ordering for each filter group.
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
    description: "Halal exists on the menu, shared equipment with non-halal.",
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
// Active-filter counter, surfaces on the trigger button as a badge.
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
  if (filters.supplier_verified === true) count++;
  if (filters.cuisines && filters.cuisines.length > 0) {
    count += filters.cuisines.length;
  }
  // Per-meat slaughter methods are restrictive filters, count each
  // selected method (e.g. Chicken hand-cut + Beef machine-cut = 2).
  for (const field of MEAT_FILTER_FIELDS) {
    const selected = filters[field];
    if (selected && selected.length > 0) count += selected.length;
  }
  // boost_amenities is deliberately NOT counted, it re-ranks rather than
  // filters, so it never narrows the result set and shouldn't inflate the
  // "N filters active" badge that implies things are being removed.
  return count;
}

// ---------------------------------------------------------------------------
// Reset, clears every category-level filter while preserving the
// query / geo / paging axes (those aren't filters in the user's
// mental model; they're search context).
// ---------------------------------------------------------------------------

/**
 * How each filter is named when we tell someone it's the reason they got
 * nothing. Keyed by the server's machine field name.
 *
 * Phrased as the thing they asked for ("a certificate on file") rather than
 * the parameter ("has_certification"), because the sentence it lands in is
 * "no places here have ___".
 */
export const FILTER_LABELS: Readonly<Record<string, string>> = {
  min_validation_tier: "that level of verification",
  min_menu_posture: "that kind of menu",
  has_certification: "a certificate on file",
  supplier_verified: "a verified supplier",
  no_pork: "no pork on the menu",
  no_alcohol_served: "no alcohol served",
  chicken_slaughter: "that chicken slaughter method",
  beef_zabihah: "that beef zabihah status",
  lamb_zabihah: "that lamb zabihah status",
  goat_zabihah: "that goat zabihah status",
};

/** Clear one filter by its server field name, leaving the rest alone. */
export function clearFilterField(
  filters: SearchPlacesParams,
  field: string,
): SearchPlacesParams {
  const next = { ...filters };
  switch (field) {
    case "min_validation_tier":
      delete next.min_validation_tier;
      break;
    case "min_menu_posture":
      delete next.min_menu_posture;
      break;
    case "has_certification":
      delete next.has_certification;
      break;
    case "supplier_verified":
      delete next.supplier_verified;
      break;
    case "no_pork":
      delete next.no_pork;
      break;
    case "no_alcohol_served":
      delete next.no_alcohol_served;
      break;
    case "chicken_slaughter":
      delete next.chicken_slaughter;
      break;
    case "beef_zabihah":
      delete next.beef_zabihah;
      break;
    case "lamb_zabihah":
      delete next.lamb_zabihah;
      break;
    case "goat_zabihah":
      delete next.goat_zabihah;
      break;
    default:
      // Unknown field name (e.g. a server relaxation key this build
      // doesn't recognise yet), leave the filters untouched rather than
      // silently dropping something we can't map.
      break;
  }
  return next;
}

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
// Trigger, the inline button that opens the sheet. Lives in the
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
// FiltersSheet, the sheet itself. Bottom-aligned on mobile,
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
          {/* Drag handle, purely decorative, signals "this can be
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
                hint="How strongly the halal claim is backed, pick the minimum proof you'll accept."
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
                hint="From fully-halal kitchens down to halal-on-request, pick the minimum you'll accept."
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
                <FilterPill
                  active={filters.supplier_verified === true}
                  onClick={() =>
                    update({
                      supplier_verified:
                        filters.supplier_verified === true ? undefined : true,
                    })
                  }
                >
                  Supplier-verified
                </FilterPill>
              </FilterSection>

              <FilterSection
                title="Meat"
                hint="Chicken filters by hand vs machine slaughter. Beef, lamb and goat filter by zabihah status — turn on 'Include unsure' to also show places that haven't confirmed it."
              >
                <div className="w-full space-y-2.5">
                  {MEAT_FILTERS.map(({ field, label, choices }) => {
                    const selected = (filters[field] as string[] | undefined) ?? [];
                    return (
                      <div
                        key={field}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <span className="w-16 shrink-0 text-xs font-medium text-foreground">
                          {label}
                        </span>
                        {choices.map((choice) => {
                          const isOn = selected.includes(choice.value);
                          return (
                            <FilterPill
                              key={choice.value}
                              active={isOn}
                              onClick={() => {
                                const next = isOn
                                  ? selected.filter((v) => v !== choice.value)
                                  : [...selected, choice.value];
                                update({
                                  [field]:
                                    next.length === 0 ? undefined : next,
                                } as Partial<SearchPlacesParams>);
                              }}
                            >
                              {choice.label}
                            </FilterPill>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </FilterSection>

              <PriorityBoostSection filters={filters} update={update} />
            </div>
          </div>

          {/* Sticky footer, single Done button. We apply changes
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
// FilterSection, labeled group of pills.
// ---------------------------------------------------------------------------

function FilterSection({
  title,
  hint,
  children,
}: {
  title: string;
  /** One-line plain-language explanation rendered under the title.
   *  Pill ``title`` attributes only surface on hover, useless on
   *  touch, so jargon-y sections (verification tiers, menu
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
// PriorityBoostSection, the family-amenity "prioritize" controls.
//
// Deliberately visually distinct from the filter sections above: these
// toggles RE-RANK results, they never remove a place. The tinted card,
// sparkle-free copy, and separate non-restrictive treatment (not counted
// as active filters) are what keep the "boost, not filter" contract
// legible to the user, matching the API's boost_amenities semantics.
// ---------------------------------------------------------------------------

function PriorityBoostSection({
  filters,
  update,
}: {
  filters: SearchPlacesParams;
  update: (patch: Partial<SearchPlacesParams>) => void;
}) {
  const selected = filters.boost_amenities ?? [];
  return (
    <section className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
      <div className="space-y-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">
          Prioritize for families
        </h3>
        <p className="text-xs text-muted-foreground">
          Bubbles these up first, doesn&rsquo;t hide other places.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {AMENITY_BOOSTS.map((amenity) => {
          const isOn = selected.includes(amenity.value);
          return (
            <button
              key={amenity.value}
              type="button"
              onClick={() => {
                const next = isOn
                  ? selected.filter((v) => v !== amenity.value)
                  : [...selected, amenity.value];
                update({
                  boost_amenities: next.length === 0 ? undefined : next,
                });
              }}
              aria-pressed={isOn}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                isOn
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-primary/30 bg-background text-foreground hover:border-primary/50 hover:bg-primary/10",
              )}
            >
              {amenity.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FilterPill, toggleable pill button. Active state uses the brand
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
