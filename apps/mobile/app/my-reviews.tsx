/**
 * Your reviews — including the ones moderation took down.
 *
 * ## Why this screen exists
 *
 * The public list on a place filters to PUBLISHED. So before this, a review
 * that was hidden or removed was invisible to the person who wrote it: it
 * simply stopped being there, and the removal email was the only explanation
 * that existed anywhere. An email in a spam folder meant someone's words
 * disappeared with no reason they could reach.
 *
 * Hence the ordering: moderated reviews sort to the top, carry the
 * moderator's note verbatim, and hidden ones keep a path back to the editor
 * — hidden is reversible, and fixing it is the entire point of the state.
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { useCurrentUser, useMyReviews } from "@/lib/api/hooks";
import type { MyReviewRead } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card } from "@/ui/kit";

function Stars({ rating }: { rating: number }) {
  return (
    <Text style={{ color: "#F59E0B", fontSize: 12, letterSpacing: 0.5 }}>
      {"★".repeat(rating)}
      <Text style={{ color: "#DCDFDC" }}>{"★".repeat(5 - rating)}</Text>
    </Text>
  );
}

function relative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function MyReviewsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const reviews = useMyReviews(Boolean(me));

  // Moderated first. Someone opening this screen has usually just been told
  // something came down; making them scroll past six published reviews to
  // find it would be a strange thing to do to them.
  const sorted = useMemo(() => {
    const items = reviews.data ?? [];
    const rank = (r: MyReviewRead) =>
      r.status === "REMOVED" ? 0 : r.status === "HIDDEN" ? 1 : 2;
    return [...items].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [reviews.data]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + space.xl,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={22} color={t.ink} />
        </Pressable>
        <Text style={[ty.title, { color: t.ink, fontSize: 22 }]}>Your reviews</Text>
      </View>
      <Text style={[ty.small, { color: t.sub, marginBottom: space.sm }]}>
        Everything you&apos;ve written, including anything moderation acted on.
      </Text>

      {meLoading || reviews.isLoading ? (
        <ActivityIndicator style={{ marginTop: space.xl }} color={t.accentDeep} />
      ) : null}

      {!meLoading && !me ? (
        <Card>
          <View style={{ padding: space.lg, gap: space.sm }}>
            <Text style={[ty.label, { color: t.ink }]}>
              Sign in to see your reviews
            </Text>
            <Text style={[ty.small, { color: t.sub, lineHeight: 18 }]}>
              They&apos;re tied to your account, so we need to know who you are
              first.
            </Text>
            <Button title="Sign in" onPress={() => router.push("/(auth)/sign-in")} />
          </View>
        </Card>
      ) : null}

      {me && reviews.data && sorted.length === 0 ? (
        <Card>
          <View style={{ padding: space.lg, gap: space.sm }}>
            <Text style={[ty.label, { color: t.ink }]}>
              You haven&apos;t written any yet
            </Text>
            <Text style={[ty.small, { color: t.sub, lineHeight: 18 }]}>
              Reviews are how other diners learn what a place is actually like
              — what you ordered, what you asked, what they said.
            </Text>
          </View>
        </Card>
      ) : null}

      {sorted.map((review) => (
        <ReviewCard key={review.id} review={review} />
      ))}
    </ScrollView>
  );
}

function ReviewCard({ review }: { review: MyReviewRead }) {
  const t = useTheme();
  const removed = review.status === "REMOVED";
  const hidden = review.status === "HIDDEN";
  const moderated = removed || hidden;

  return (
    <View
      style={{
        backgroundColor: t.card,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: moderated ? "#FCD34D" : t.line,
        padding: space.lg,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Pressable
          onPress={() => router.push(`/places/${review.place_id}`)}
          style={{ flex: 1 }}
        >
          <Text style={[ty.label, { color: t.ink, fontSize: 14 }]}>
            {review.place?.name ?? "A restaurant"}
          </Text>
        </Pressable>
        <Text style={[ty.small, { color: t.sub, fontSize: 11 }]}>
          {relative(review.created_at)}
          {review.edited_at ? " · edited" : ""}
        </Text>
      </View>

      <View style={{ marginTop: 4 }}>
        <Stars rating={review.rating} />
      </View>

      {/* Verbatim, and above the review, because the note was written *to*
          this person and it's why they opened the screen. Paraphrasing a
          takedown reason is how a disagreement becomes a grievance. */}
      {moderated ? (
        <View
          style={{
            marginTop: 10,
            backgroundColor: "#FFFBEB",
            borderWidth: 1,
            borderColor: "#FCD34D",
            borderRadius: radii.md,
            padding: 11,
          }}
        >
          <Text style={{ color: "#78350F", fontFamily: "Inter_700Bold", fontSize: 12 }}>
            {removed
              ? "This review was removed"
              : "This review is hidden while we look at it"}
          </Text>
          <Text
            style={[ty.small, { color: "#78350F", marginTop: 4, lineHeight: 17 }]}
          >
            {review.moderation_note ??
              "No reason was recorded, which shouldn't happen — get in touch and we'll explain."}
          </Text>
          <Text
            style={[
              ty.small,
              { color: "#92400E", marginTop: 6, fontSize: 11, lineHeight: 16 },
            ]}
          >
            {removed
              ? "Removals are final. If your review described something factual about a restaurant's halal status, you can raise that separately as a dispute on halalfoodnearme.com."
              : "Hidden is reversible. Edit it to address the note above and it can go back up."}
          </Text>
        </View>
      ) : null}

      <Text style={[ty.body, { color: t.ink, fontSize: 13.5, marginTop: 9, lineHeight: 19 }]}>
        {review.body}
      </Text>

      {review.reply ? (
        <View
          style={{
            marginTop: 10,
            backgroundColor: t.accentSoft,
            borderRadius: radii.md,
            padding: 11,
          }}
        >
          <Text style={{ color: t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 10.5 }}>
            ✓ Response from {review.place?.name ?? "the restaurant"}
          </Text>
          <Text style={[ty.small, { color: t.ink, marginTop: 4, lineHeight: 17 }]}>
            {review.reply.body}
          </Text>
        </View>
      ) : null}

      {/* No edit affordance on a removed review — the server refuses, and a
          button that can only fail is worse than no button. */}
      {!removed ? (
        <Pressable
          onPress={() => router.push(`/places/${review.place_id}/review`)}
          style={{ marginTop: 11 }}
        >
          <Text style={{ color: t.accentDeep, fontFamily: "Inter_600SemiBold", fontSize: 12.5 }}>
            {hidden ? "Edit this review →" : "View on the restaurant →"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
