/**
 * How each filter is named when we tell someone it's the reason they got
 * nothing back.
 *
 * Keyed by the server's machine field name, and phrased as the thing they
 * asked for rather than the parameter, because the sentence it lands in is
 * "no places here have ___".
 *
 * Kept identical to the web copy in apps/consumer/src/components/
 * filters-sheet.tsx. Someone who hits a dead end on their phone and again on
 * their laptop should get one explanation, not two that almost agree.
 */
export const FILTER_LABELS: Readonly<Record<string, string>> = {
  min_validation_tier: "that level of verification",
  min_menu_posture: "that kind of menu",
  has_certification: "a certificate on file",
  no_pork: "no pork on the menu",
  no_alcohol_served: "no alcohol served",
  chicken_slaughter: "that chicken slaughter method",
  beef_slaughter: "that beef slaughter method",
  lamb_slaughter: "that lamb slaughter method",
  goat_slaughter: "that goat slaughter method",
};
