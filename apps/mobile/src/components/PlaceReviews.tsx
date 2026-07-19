/**
 * Reviews block on the mobile place detail.
 *
 * Mirrors the web ordering — trust facts, hours, photos, then opinion — and
 * the same rule about ratings: Trust Halal's and Google's sit side by side,
 * each labelled. A bare star that silently means Google's is what this
 * replaces.
 *
 * Deliberately shows only the first three reviews with a "see all" affordance
 * rather than a full list. Place detail is one long scroll on a phone, and
 * burying the nearby-places section under twenty reviews serves nobody.
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { usePlaceReviews } from "@/lib/api/hooks";
import type { PlaceDetail, PlaceReviewRead, ReviewSort } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

const PREVIEW_COUNT = 3;

const SORTS: Array<{ value: ReviewSort; label: string }> = [
  { value: "recent", label: "Recent" },
  { value: "rating_high", label: "Highest" },
  { value: "rating_low", label: "Lowest" },
];

export function Stars({ rating, size = 12 }: { rating: number; size?: number }) {
  return (
    <Text style={{ color: "#F59E0B", fontSize: size, letterSpacing: 0.5 }}>
      {"★".repeat(rating)}
      <Text style={{ color: "#DCDFDC" }}>{"★".repeat(5 - rating)}</Text>
    </Text>
  );
}

function relative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function ReviewRow({ review }: { review: PlaceReviewRead }) {
  const t = useTheme();
  const initial = (review.author.display_name ?? "?").charAt(0).toUpperCase();

  return (
    <View style={{ paddingVertical: space.md, borderTopWidth: 1, borderTopColor: t.line }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            backgroundColor: t.zincSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: t.zinc, fontFamily: "Inter_700Bold", fontSize: 11 }}>
            {initial}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[ty.label, { color: t.ink, fontSize: 13 }]}>
            {review.author.display_name ?? "A diner"}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 }}>
            <Stars rating={review.rating} size={10} />
            <Text style={[ty.small, { color: t.sub, fontSize: 10.5 }]}>
              · {relative(review.created_at)}
              {review.edited_at ? " · edited" : ""}
            </Text>
          </View>
        </View>
      </View>

      <Text style={[ty.body, { color: t.ink, fontSize: 13, marginTop: 8, lineHeight: 19 }]}>
        {review.body}
      </Text>

      {review.photos.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
          {review.photos.map((p) => (
            <Image
              key={p.id}
              source={{ uri: p.url }}
              style={{ width: 56, height: 56, borderRadius: 9, backgroundColor: t.zincSoft }}
            />
          ))}
        </View>
      ) : null}

      {review.reply ? (
        <View
          style={{
            marginTop: 10,
            marginLeft: 37,
            backgroundColor: t.accentSoft,
            borderRadius: radii.md,
            padding: 11,
          }}
        >
          <Text style={{ color: t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 10.5 }}>
            ✓ Response from {review.reply.organization_name ?? "the owner"}
          </Text>
          <Text style={[ty.small, { color: t.ink, marginTop: 4, lineHeight: 17 }]}>
            {review.reply.body}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function PlaceReviews({
  place,
  signedIn,
  emailVerified,
}: {
  place: PlaceDetail;
  signedIn: boolean;
  emailVerified: boolean;
}) {
  const t = useTheme();
  const [sort, setSort] = useState<ReviewSort>("recent");
  const [expanded, setExpanded] = useState(false);

  const reviews = usePlaceReviews(place.id, sort);
  const data = reviews.data;
  const items = data?.items ?? [];
  const shown = expanded ? items : items.slice(0, PREVIEW_COUNT);
  const mine = useMemo(() => items.find((r) => r.is_mine) ?? null, [items]);

  const summary = data?.summary;

  return (
    <View style={{ marginTop: space.lg }}>
      <Text style={[ty.seg, { color: t.sub, marginBottom: space.sm }]}>Reviews</Text>

      <View
        style={{
          backgroundColor: t.card,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: t.line,
          padding: space.lg,
        }}
      >
        {/* Both ratings, each labelled. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View>
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 9.5,
                letterSpacing: 0.9,
                color: t.accentDeep,
              }}
            >
              TRUST HALAL
            </Text>
            {summary && summary.count > 0 ? (
              <>
                <Text style={[ty.title, { color: t.ink, fontSize: 27, marginTop: 2 }]}>
                  {summary.average?.toFixed(1)}
                </Text>
                <Stars rating={Math.round(summary.average ?? 0)} />
                <Text style={[ty.small, { color: t.sub, fontSize: 10.5, marginTop: 2 }]}>
                  {summary.count} review{summary.count === 1 ? "" : "s"}
                </Text>
              </>
            ) : (
              <Text style={[ty.small, { color: t.sub, marginTop: 4, maxWidth: 150 }]}>
                No reviews yet. Be the first.
              </Text>
            )}
          </View>

          {summary?.google_rating != null ? (
            <>
              <View style={{ width: 1, height: 52, backgroundColor: t.line }} />
              <View>
                <Text
                  style={{
                    fontFamily: "Inter_700Bold",
                    fontSize: 9.5,
                    letterSpacing: 0.9,
                    color: t.sub,
                  }}
                >
                  ON GOOGLE
                </Text>
                <Text style={[ty.h2, { color: t.zinc, fontSize: 19, marginTop: 4 }]}>
                  {summary.google_rating.toFixed(1)}
                </Text>
                {summary.google_rating_count != null ? (
                  <Text style={[ty.small, { color: t.sub, fontSize: 10.5 }]}>
                    {summary.google_rating_count.toLocaleString()} ratings
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}
        </View>

        <Pressable
          onPress={() => router.push(`/places/${place.id}/review`)}
          style={{
            marginTop: space.md,
            backgroundColor: t.accent,
            borderRadius: radii.md,
            paddingVertical: 11,
            alignItems: "center",
          }}
        >
          <Text style={{ color: t.onAccent, fontFamily: "Inter_700Bold", fontSize: 13.5 }}>
            {mine ? "Edit your review" : "Write a review"}
          </Text>
        </Pressable>

        {/* Say why the action won't work rather than letting it fail. */}
        {data && !data.can_review && !mine ? (
          <Text style={[ty.small, { color: t.sub, marginTop: 8, textAlign: "center" }]}>
            {!signedIn
              ? "Sign in to write a review."
              : !emailVerified
                ? "Confirm your email to write a review."
                : ""}
          </Text>
        ) : null}
      </View>

      {items.length > 0 ? (
        <>
          <View style={{ flexDirection: "row", gap: 6, marginTop: space.md }}>
            {SORTS.map((s) => (
              <Pressable
                key={s.value}
                onPress={() => setSort(s.value)}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: sort === s.value ? t.ink : t.line,
                  backgroundColor: sort === s.value ? t.ink : t.card,
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 11,
                    color: sort === s.value ? t.onInk : t.sub,
                  }}
                >
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View
            style={{
              backgroundColor: t.card,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: t.line,
              paddingHorizontal: space.lg,
              marginTop: space.sm,
            }}
          >
            {shown.map((r, i) => (
              <View key={r.id} style={i === 0 ? { paddingTop: 4 } : undefined}>
                <ReviewRow review={r} />
              </View>
            ))}

            {items.length > shown.length ? (
              <Pressable
                onPress={() => setExpanded(true)}
                style={{
                  paddingVertical: space.md,
                  borderTopWidth: 1,
                  borderTopColor: t.line,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                }}
              >
                <Text style={[ty.label, { color: t.accentDeep, fontSize: 13 }]}>
                  Show all {items.length} reviews
                </Text>
                <Feather name="chevron-down" size={14} color={t.accentDeep} />
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}
