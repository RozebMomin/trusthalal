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
import type { HalalProfileEmbed } from "@/lib/api/types";

/** Amenity field on the profile → its human label, in canonical order. */
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
 * canonical order (prayer space, wudu, bidet, baby changing). Returns an empty
 * array when the profile is null or has no YES / ON_REQUEST amenity.
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
