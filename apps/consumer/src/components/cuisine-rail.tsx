"use client";

/**
 * Inline horizontal cuisine rail under the search bar.
 *
 * Pattern lifted from Airbnb's category rail: the most-likely
 * filter the user wants to apply is the cuisine, so it sits inline
 * one tap away. The rest of the cuisine taxonomy (and every other
 * filter axis) lives in the FiltersSheet behind the Filters button.
 *
 * Top 8 cuisines render as pill chips that toggle on tap. A trailing
 * "More" pill opens the filter sheet so the user can reach the full
 * 45-entry list. If the user has already selected an off-rail
 * cuisine (e.g. picked "Yemeni" from the sheet earlier), the
 * trailing "More" pill carries the count: "More (2)".
 *
 * Horizontal-scrolling on small viewports — chips don't wrap, so
 * narrower phones can scroll right to see the full top 8. Scrollbar
 * is hidden via CSS for a native-feel rail.
 */

import { Plus } from "lucide-react";
import * as React from "react";

import type { Cuisine, SearchPlacesParams } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

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

/**
 * The 8 cuisines most likely to be tapped from the home surface.
 * Tuned by hand against the v1 markets (US/UK/CA halal scenes).
 * Re-tune when we have real telemetry.
 *
 * Exported so the ActiveFiltersBar can EXCLUDE these from its chip
 * strip — an on-rail cuisine already shows its active state as a
 * highlighted rail pill, and rendering it a second time as a
 * removable chip below reads as duplicate UI.
 */
export const TOP_CUISINES: ReadonlyArray<Cuisine> = [
  "PAKISTANI",
  "INDIAN",
  "MEDITERRANEAN",
  "LEBANESE",
  "TURKISH",
  "YEMENI",
  "AFGHAN",
  "AMERICAN",
];

export function CuisineRail({
  filters,
  onChange,
  onOpenAll,
}: {
  filters: SearchPlacesParams;
  onChange: (next: SearchPlacesParams) => void;
  /** Open the filter sheet (presumably scrolled to the cuisine
   *  section). Used by the trailing "More" pill so the rail can
   *  hand off to the full picker without owning sheet state. */
  onOpenAll: () => void;
}) {
  // Memo'd here (rather than ``filters.cuisines ?? []``) so the
  // identity is stable across renders that don't actually change the
  // selection — keeps offRailCount's deps array honest and stops
  // useMemo from re-firing on every parent render.
  const selected = React.useMemo<ReadonlyArray<Cuisine>>(
    () => filters.cuisines ?? [],
    [filters.cuisines],
  );

  // Off-rail picks are cuisines the user has selected that aren't in
  // the Top 8. Surfaces as a count badge on the "More" pill so the
  // user knows there are picks they can't see in the rail without
  // opening the sheet.
  const offRailCount = React.useMemo(
    () => selected.filter((c) => !TOP_CUISINES.includes(c)).length,
    [selected],
  );

  function toggle(c: Cuisine) {
    const next = selected.includes(c)
      ? selected.filter((x) => x !== c)
      : [...selected, c];
    onChange({
      ...filters,
      cuisines: next.length === 0 ? undefined : next,
    });
  }

  return (
    <div
      role="group"
      aria-label="Quick cuisine filters"
      className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TOP_CUISINES.map((c) => {
        const isOn = selected.includes(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            aria-pressed={isOn}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition",
              isOn
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-card text-foreground hover:border-foreground/40 hover:bg-accent",
            )}
          >
            {CUISINE_LABELS[c]}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenAll}
        className={cn(
          "ml-1 inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-input px-3 py-1.5 text-xs font-medium text-muted-foreground transition",
          "hover:border-foreground/40 hover:text-foreground",
        )}
        title="Open all cuisines"
      >
        <Plus className="h-3 w-3" aria-hidden />
        More
        {offRailCount > 0 && <span>· {offRailCount}</span>}
      </button>
    </div>
  );
}
