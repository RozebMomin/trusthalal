/**
 * The two ratings, each attributed. One component so the three mobile
 * surfaces that show a star can't drift apart.
 *
 * ## Why the label is not optional
 *
 * A bare `★ 4.6` on a Trust Halal card reads as *Trust Halal's* rating. It
 * isn't — it's Google's, ingested from their listing, measuring a different
 * thing over a different population. Letting it render unattributed borrows
 * Google's review volume to make our own credibility look larger than it is,
 * on a product whose entire premise is that it says where its facts come
 * from. The web card has said "on Google" since this was caught there; these
 * screens were missed in the same pass.
 *
 * Trust Halal's own rating leads when it exists, because that's the one we
 * stand behind. Google's follows, labelled, because at current volume it's
 * usually the only number a place has.
 */
import { Text } from "react-native";

import type { PlaceSearchResult } from "@/lib/api/types";
import { type as ty } from "@/lib/theme";

export function RatingLine({
  place,
  starColor,
  labelColor,
}: {
  place: Pick<
    PlaceSearchResult,
    "google_rating" | "review_rating_avg" | "review_count"
  >;
  starColor: string;
  labelColor: string;
}) {
  const th =
    (place.review_count ?? 0) > 0 && place.review_rating_avg != null
      ? place.review_rating_avg
      : null;
  const google = place.google_rating;

  if (th == null && google == null) return null;

  return (
    <Text style={[ty.small, { color: labelColor }]} numberOfLines={1}>
      {th != null ? (
        <>
          <Text style={{ color: starColor, fontFamily: "Inter_700Bold" }}>
            {`★ ${th.toFixed(1)}`}
          </Text>
          <Text style={{ color: labelColor }}>
            {` Trust Halal (${place.review_count})`}
          </Text>
        </>
      ) : null}
      {th != null && google != null ? <Text style={{ color: labelColor }}> · </Text> : null}
      {google != null ? (
        <>
          <Text style={{ color: starColor, fontFamily: "Inter_700Bold" }}>
            {`★ ${google.toFixed(1)}`}
          </Text>
          <Text style={{ color: labelColor }}> on Google</Text>
        </>
      ) : null}
    </Text>
  );
}
