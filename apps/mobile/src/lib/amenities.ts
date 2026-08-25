/**
 * Family / prayer amenity badges, shared between the search result card
 * (PlaceCard) and the place-detail screen so the two surfaces always render
 * the same labels and the same YES / ON_REQUEST rule.
 *
 * The contract (from the backend): each amenity field is one of
 * ``"YES" | "ON_REQUEST" | "NO" | "UNSURE"`` or ``null`` (never captured).
 * A badge is shown ONLY for YES or ON_REQUEST; ON_REQUEST appends
 * " (on request)" so a diner can tell a standing facility from one they have
 * to ask for. NO / UNSURE / null render nothing — silence here means "we don't
 * have a positive signal", not "definitely absent".
 *
 * Kept in step with the web helper (apps/consumer/src/lib/amenities.ts): a
 * diner who checks a place on the phone and again on the laptop should get the
 * same badges.
 */
import type { ComponentProps } from "react";
import type { MaterialCommunityIcons } from "@expo/vector-icons";
/** Anything carrying the four amenity fields — a place (search result / detail),
 *  since amenities are a place attribute now, not on the halal profile. */
export type AmenitySource = {
  prayer_space?: string | null;
  wudu?: string | null;
  bidet?: string | null;
  baby_changing?: string | null;
} | null | undefined;

type MCIName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/** A resolved amenity badge: the human label plus the glyph the card renders
 *  in front of it. */
export type AmenityBadge = { label: string; icon: MCIName };

/** Amenity field on the profile → its human label + icon, in canonical order. */
const AMENITY_LABELS: ReadonlyArray<{
  field: "prayer_space" | "wudu" | "bidet" | "baby_changing";
  label: string;
  icon: MCIName;
}> = [
  { field: "prayer_space", label: "Prayer space", icon: "mosque" },
  { field: "wudu", label: "Wudu area", icon: "hand-water" },
  { field: "bidet", label: "Bidet", icon: "shower-head" },
  { field: "baby_changing", label: "Baby changing", icon: "baby-carriage" },
];

/**
 * Badges for the amenities a place positively offers, each carrying an icon so
 * the card can show a glyph rather than a bare word. Preserves the canonical
 * order (prayer space, wudu, bidet, baby changing). Returns an empty array when
 * the profile is null or has no YES / ON_REQUEST amenity.
 */
export function amenityBadgesFor(src: AmenitySource): AmenityBadge[] {
  if (!src) return [];
  const out: AmenityBadge[] = [];
  for (const { field, label, icon } of AMENITY_LABELS) {
    const value = src[field];
    if (value === "YES") out.push({ label, icon });
    else if (value === "ON_REQUEST") out.push({ label: `${label} (on request)`, icon });
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
 * after the Explore list is re-sorted by distance — mirroring the server's
 * boost, which the distance re-sort would otherwise discard.
 */
export function matchesBoostAmenities(
  src: AmenitySource,
  codes: readonly string[] | null | undefined,
): boolean {
  if (!src || !codes?.length) return false;
  for (const code of codes) {
    const field = BOOST_CODE_TO_FIELD[code];
    if (!field) continue;
    const value = src[field];
    if (value === "YES" || value === "ON_REQUEST") return true;
  }
  return false;
}
