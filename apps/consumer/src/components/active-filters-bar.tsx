"use client";

/**
 * Active filters bar — the strip of removable chips that sits above
 * the results when any filter is active.
 *
 * Why this exists: filters live behind a sheet now, so the user
 * can't see at a glance what's narrowing their search by looking
 * at the home surface. This bar surfaces the active set as
 * dismissible chips. Tap × on a chip → that filter is cleared and
 * the URL updates. "Clear all" wipes every category-level filter
 * (preserving query / geo / paging context).
 *
 * Pattern is the standard "pinned active filters" used by Yelp /
 * Airbnb / Resy. It complements (doesn't replace) the count badge
 * on the Filters trigger button — the count tells you HOW MANY
 * filters are active; this bar tells you WHICH ones.
 */

import { X } from "lucide-react";
import * as React from "react";

import type {
  Cuisine,
  MenuPosture,
  SearchPlacesParams,
  ValidationTier,
} from "@/lib/api/hooks";
import { clearAllFilters } from "@/components/filters-sheet";

// Per-axis display labels. Kept in this file (rather than imported
// from filters-sheet) because the chip copy may diverge — the bar
// favors short, glanceable labels ("Verified halal" vs the sheet's
// full "Verifier-confirmed").
const VALIDATION_TIER_LABELS: Record<ValidationTier, string> = {
  SELF_ATTESTED: "Any verified",
  CERTIFICATE_ON_FILE: "Cert on file",
  TRUST_HALAL_VERIFIED: "Verifier-confirmed",
};

const MENU_POSTURE_LABELS: Record<MenuPosture, string> = {
  FULLY_HALAL: "Fully halal",
  MIXED_SEPARATE_KITCHENS: "Separate kitchen",
  HALAL_OPTIONS_ADVERTISED: "Halal options",
  HALAL_UPON_REQUEST: "On request",
  MIXED_SHARED_KITCHEN: "Any halal",
};

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

type Chip = {
  key: string;
  label: string;
  /** Returns the next filter state with this chip's filter cleared. */
  clear: (current: SearchPlacesParams) => SearchPlacesParams;
};

/**
 * Walk the search params and emit a chip for every active filter
 * axis. Cuisines fan out to one chip each so the user can drop a
 * single cuisine without opening the sheet.
 */
function buildChips(filters: SearchPlacesParams): Chip[] {
  const chips: Chip[] = [];

  if (filters.min_validation_tier) {
    const tier = filters.min_validation_tier;
    chips.push({
      key: `tier:${tier}`,
      label: VALIDATION_TIER_LABELS[tier] ?? tier,
      clear: (c) => ({ ...c, min_validation_tier: undefined }),
    });
  }

  if (filters.min_menu_posture) {
    const posture = filters.min_menu_posture;
    chips.push({
      key: `posture:${posture}`,
      label: MENU_POSTURE_LABELS[posture] ?? posture,
      clear: (c) => ({ ...c, min_menu_posture: undefined }),
    });
  }

  if (filters.no_pork === true) {
    chips.push({
      key: "no_pork",
      label: "Pork-free",
      clear: (c) => ({ ...c, no_pork: undefined }),
    });
  }

  if (filters.no_alcohol_served === true) {
    chips.push({
      key: "no_alcohol",
      label: "No alcohol",
      clear: (c) => ({ ...c, no_alcohol_served: undefined }),
    });
  }

  if (filters.has_certification === true) {
    chips.push({
      key: "has_cert",
      label: "Certificate on file",
      clear: (c) => ({ ...c, has_certification: undefined }),
    });
  }

  for (const cuisine of filters.cuisines ?? []) {
    chips.push({
      key: `cuisine:${cuisine}`,
      label: CUISINE_LABELS[cuisine] ?? cuisine,
      clear: (c) => {
        const next = (c.cuisines ?? []).filter((x) => x !== cuisine);
        return {
          ...c,
          cuisines: next.length === 0 ? undefined : next,
        };
      },
    });
  }

  return chips;
}

export function ActiveFiltersBar({
  filters,
  onChange,
}: {
  filters: SearchPlacesParams;
  onChange: (next: SearchPlacesParams) => void;
}) {
  const chips = buildChips(filters);
  if (chips.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-1.5"
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange(chip.clear(filters))}
          className="group inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/10"
        >
          <span>{chip.label}</span>
          <X
            className="h-3 w-3 opacity-70 transition group-hover:opacity-100"
            aria-hidden
          />
          <span className="sr-only">Remove {chip.label} filter</span>
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={() => onChange(clearAllFilters(filters))}
          className="ml-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
