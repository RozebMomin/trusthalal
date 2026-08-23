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
import type { HalalProfileEmbed } from "@/lib/api/types";

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
export function amenityBadgesFor(
  profile: HalalProfileEmbed | null | undefined,
): AmenityBadge[] {
  if (!profile) return [];
  const out: AmenityBadge[] = [];
  for (const { field, label, icon } of AMENITY_LABELS) {
    const value = profile[field];
    if (value === "YES") out.push({ label, icon });
    else if (value === "ON_REQUEST") out.push({ label: `${label} (on request)`, icon });
  }
  return out;
}
