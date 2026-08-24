/**
 * Family / prayer amenity badges, shared between the search result card
 * and the place-detail trust summary so the two surfaces always render
 * the same labels and the same YES / ON_REQUEST rule.
 *
 * The contract (from the backend): each amenity field is one of
 * ``"YES" | "ON_REQUEST" | "NO" | "UNSURE"`` or ``null`` (never captured).
 * A badge is shown ONLY for YES or ON_REQUEST, ON_REQUEST appends
 * " (on request)" so a diner can tell a standing facility from one they
 * have to ask for. NO / UNSURE / null render nothing, silence here means
 * "we don't have a positive signal", not "definitely absent".
 */

import type { HalalProfileEmbed } from "@/lib/api/hooks";

/** Amenity field on the profile → its human label. */
const AMENITY_LABELS: ReadonlyArray<{
  field: "prayer_space" | "wudu" | "bidet" | "baby_changing";
  label: string;
}> = [
  { field: "prayer_space", label: "Prayer space" },
  { field: "wudu", label: "Wudu area" },
  { field: "bidet", label: "Bidet" },
  { field: "baby_changing", label: "Baby changing" },
];

/**
 * Badge labels for the amenities a place positively offers. Preserves the
 * canonical order (prayer space, wudu, bidet, baby changing). Returns an
 * empty array when the profile is null or has no YES / ON_REQUEST amenity.
 */
export function amenityBadgesFor(
  profile: HalalProfileEmbed | null | undefined,
): string[] {
  if (!profile) return [];
  const out: string[] = [];
  for (const { field, label } of AMENITY_LABELS) {
    const value = profile[field];
    if (value === "YES") out.push(label);
    else if (value === "ON_REQUEST") out.push(`${label} (on request)`);
  }
  return out;
}

/** Boost-amenity wire code (as sent to the API's ``boost_amenities`` param) →
 *  the profile field that carries it. Keep in step with the backend's
 *  ``_AMENITY_SQL_COL`` map. */
const BOOST_CODE_TO_FIELD: Readonly<
  Record<string, "prayer_space" | "wudu" | "bidet" | "baby_changing">
> = {
  PRAYER_SPACE: "prayer_space",
  WUDU: "wudu",
  BIDET: "bidet",
  BABY_CHANGING: "baby_changing",
};

/** Boost-amenity wire code → its lowercase noun for inline sentences
 *  (e.g. "Places with baby changing shown first"). */
const BOOST_CODE_TO_NOUN: Readonly<Record<string, string>> = {
  PRAYER_SPACE: "prayer space",
  WUDU: "wudu area",
  BIDET: "bidet",
  BABY_CHANGING: "baby changing",
};

/** Human, comma-joined ("a, b and c") noun phrase for the active boost codes,
 *  in the canonical order. Empty string when nothing valid is passed. */
export function boostAmenityPhrase(
  codes: readonly string[] | null | undefined,
): string {
  if (!codes?.length) return "";
  const nouns = Object.keys(BOOST_CODE_TO_NOUN)
    .filter((code) => codes.includes(code))
    .map((code) => BOOST_CODE_TO_NOUN[code]);
  if (nouns.length === 0) return "";
  if (nouns.length === 1) return nouns[0];
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

/**
 * True when a place positively offers at least one of the requested boost
 * amenities (YES / ON_REQUEST). Used as a primary client-side sort key so the
 * "prioritize for families" toggles float matching places to the top even
 * after the list is re-sorted by distance or rating — mirroring the server's
 * boost, which a client re-sort would otherwise discard.
 */
export function matchesBoostAmenities(
  profile: HalalProfileEmbed | null | undefined,
  codes: readonly string[] | null | undefined,
): boolean {
  if (!profile || !codes?.length) return false;
  for (const code of codes) {
    const field = BOOST_CODE_TO_FIELD[code];
    if (!field) continue;
    const value = profile[field];
    if (value === "YES" || value === "ON_REQUEST") return true;
  }
  return false;
}
