/**
 * Write or edit a review — a full screen, not a bottom sheet.
 *
 * Star pickers and multi-paragraph text are miserable in a sheet: the
 * keyboard eats most of the height and the drag handle competes with the
 * scroll. This is the same call the file-a-visit flow made.
 *
 * ## The draft is persisted, and that's load-bearing
 *
 * Text moderation runs on submit and fails closed — if the scanner is
 * unreachable, the post is refused. Correct (it matches the photo pipeline)
 * but only acceptable if nobody loses what they wrote. Reviews are voluntary
 * effort; nobody retypes a paragraph. Same on-device draft mechanism
 * file-a-visit already uses.
 *
 * ## Two failures that must not look alike
 *
 * 400 means we read your words and they broke a rule. 503 means we couldn't
 * read them at all. "Your review was rejected" during an outage would be
 * false and infuriating, so that copy takes the blame explicitly.
 */
import { Feather } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useCreateReview,
  useDeleteReview,
  usePlaceReviews,
  useUpdateReview,
} from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

const BODY_MIN = 20;
const BODY_MAX = 5000;

function draftKey(placeId: string) {
  return `review_draft_${placeId}`;
}

type Failure =
  | { kind: "rejected"; message: string }
  | { kind: "outage" }
  | { kind: "other"; message: string };

export default function WriteReviewScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const placeId = String(id);

  const reviews = usePlaceReviews(placeId);
  const existing = reviews.data?.items.find((r) => r.is_mine) ?? null;

  const create = useCreateReview(placeId);
  const update = useUpdateReview(placeId);
  const remove = useDeleteReview(placeId);

  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const hydrated = useRef(false);

  // Hydrate once: the server's copy when editing, otherwise any unsent
  // draft. Editing must NOT restore a stale local draft — the server copy is
  // the truth and a draft would silently resurrect replaced text.
  useEffect(() => {
    if (hydrated.current || reviews.isLoading) return;
    hydrated.current = true;

    if (existing) {
      setRating(existing.rating);
      setBody(existing.body);
      return;
    }
    SecureStore.getItemAsync(draftKey(placeId))
      .then((raw) => {
        if (!raw) return;
        const d = JSON.parse(raw) as { rating?: number; body?: string };
        if (d.rating) setRating(d.rating);
        if (d.body) setBody(d.body);
      })
      .catch(() => {
        // A corrupt draft isn't worth surfacing — start clean.
      });
  }, [existing, placeId, reviews.isLoading]);

  useEffect(() => {
    if (existing || !hydrated.current) return;
    if (!body.trim() && !rating) return;
    SecureStore.setItemAsync(
      draftKey(placeId),
      JSON.stringify({ rating, body }),
    ).catch(() => {});
  }, [rating, body, placeId, existing]);

  function clearDraft() {
    SecureStore.deleteItemAsync(draftKey(placeId)).catch(() => {});
  }

  const trimmed = body.trim();
  const pending = create.isPending || update.isPending;
  const canSubmit = rating > 0 && trimmed.length >= BODY_MIN && !pending;

  async function submit() {
    if (!canSubmit) return;
    setFailure(null);
    try {
      if (existing) {
        await update.mutateAsync({
          reviewId: existing.id,
          rating,
          body: trimmed,
        });
      } else {
        await create.mutateAsync({ rating, body: trimmed });
      }
      clearDraft();
      router.back();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 503) {
        setFailure({ kind: "outage" });
      } else if (status === 400) {
        setFailure({
          kind: "rejected",
          message:
            (err as { message?: string })?.message ??
            "This can't be posted as written.",
        });
      } else {
        setFailure({
          kind: "other",
          message: "Couldn't post that. Check your connection and try again.",
        });
      }
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg }}
    >
      <View style={{ paddingTop: insets.top }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
          }}
        >
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={[ty.label, { color: t.sub }]}>Cancel</Text>
          </Pressable>
          <Text style={[ty.label, { color: t.ink, flex: 1, textAlign: "center" }]}>
            {existing ? "Edit review" : "Write a review"}
          </Text>
          <View style={{ width: 46 }} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: 40,
          gap: space.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {failure ? (
          <View
            style={{
              backgroundColor:
                failure.kind === "outage" ? t.amberSoft : t.dangerSoft,
              borderRadius: radii.md,
              padding: 12,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 12,
                color: failure.kind === "outage" ? t.amber : t.danger,
              }}
            >
              {failure.kind === "outage"
                ? "We couldn't run our content check"
                : "This can't be posted as written"}
            </Text>
            <Text
              style={[
                ty.small,
                {
                  color: failure.kind === "outage" ? t.amber : t.danger,
                  marginTop: 3,
                  lineHeight: 17,
                },
              ]}
            >
              {failure.kind === "outage"
                ? "That's on us, not your review. Your draft is saved — try again in a moment."
                : failure.kind === "rejected"
                  ? `${failure.message} Strong criticism is welcome; we just need it kept civil.`
                  : failure.message}
            </Text>
          </View>
        ) : null}

        <Text style={[ty.seg, { color: t.sub, marginTop: space.sm }]}>
          Your rating
        </Text>
        <View
          style={{
            backgroundColor: t.card,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: t.line,
            paddingVertical: space.lg,
            alignItems: "center",
          }}
        >
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
                <Feather
                  name="star"
                  size={30}
                  color={n <= rating ? "#F59E0B" : t.line}
                  style={n <= rating ? undefined : { opacity: 0.9 }}
                />
              </Pressable>
            ))}
          </View>
          <Text style={[ty.small, { color: t.sub, marginTop: 6 }]}>
            {rating === 0 ? "Tap to rate" : `${rating} of 5`}
          </Text>
        </View>

        <Text style={[ty.seg, { color: t.sub }]}>Your review</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={BODY_MAX}
          placeholder="What did you order? Did you ask about the halal status — and what did they say?"
          placeholderTextColor={t.sub}
          style={{
            backgroundColor: t.card,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: failure?.kind === "rejected" ? t.danger : t.line,
            padding: 12,
            minHeight: 150,
            textAlignVertical: "top",
            color: t.ink,
            fontFamily: "Inter_500Medium",
            fontSize: 14,
            lineHeight: 20,
          }}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={[ty.small, { color: t.sub }]}>
            {trimmed.length < BODY_MIN
              ? `At least ${BODY_MIN} characters`
              : "Looks good"}
          </Text>
          <Text style={[ty.small, { color: t.sub }]}>
            {body.length} / {BODY_MAX}
          </Text>
        </View>

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={{
            backgroundColor: t.accent,
            borderRadius: radii.md,
            paddingVertical: 14,
            alignItems: "center",
            opacity: canSubmit ? 1 : 0.5,
            marginTop: space.sm,
          }}
        >
          {pending ? (
            <ActivityIndicator color={t.onAccent} />
          ) : (
            <Text
              style={{ color: t.onAccent, fontFamily: "Inter_700Bold", fontSize: 14 }}
            >
              {existing ? "Save changes" : "Post review"}
            </Text>
          )}
        </Pressable>

        {existing ? (
          <Pressable
            onPress={() =>
              Alert.alert("Delete your review?", "This can't be undone.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    await remove.mutateAsync(existing.id);
                    clearDraft();
                    router.back();
                  },
                },
              ])
            }
            style={{ paddingVertical: 12, alignItems: "center" }}
          >
            <Text style={[ty.label, { color: t.danger }]}>Delete review</Text>
          </Pressable>
        ) : (
          <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
            Your draft is saved on this device.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
