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
 * ## Three failures that must not look alike
 *
 * 400 means we read your words and they broke a rule. 503 means we couldn't
 * read them at all. 401/403 means the content was never the problem — you're
 * signed out or unverified. Collapsing any two of these tells someone their
 * writing was refused when it wasn't.
 */
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
  uploadReviewPhoto,
  useCreateReview,
  useDeleteReview,
  usePlaceReviews,
  useResendVerification,
  useUpdateReview,
} from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

const BODY_MIN = 20;
const BODY_MAX = 5000;

/** Server enforces the same cap. Three is enough to show a plate, a menu
 *  board and a certificate; past that a review becomes an album and the
 *  moderation surface grows for no extra signal to the reader. */
const MAX_PHOTOS = 3;

type LocalPhoto = { uri: string; name: string; type: string };

/** ImagePicker asset → the {uri,name,type} shape RN's fetch wants for a
 *  multipart file part. Same helper shape file-visit.tsx uses. */
function assetToPhoto(a: ImagePicker.ImagePickerAsset): LocalPhoto {
  const uri = a.uri;
  const ext = (
    a.fileName?.split(".").pop() ||
    uri.split(".").pop() ||
    "jpg"
  ).toLowerCase();
  return {
    uri,
    name: a.fileName || `review-${Date.now()}.${ext}`,
    type: a.mimeType || (ext === "png" ? "image/png" : "image/jpeg"),
  };
}

function draftKey(placeId: string) {
  return `review_draft_${placeId}`;
}

/** Why a submit failed. Three genuinely different messages to a person;
 *  collapsing any two produces a lie. See the web dialog's copy of this. */
type Failure =
  | { kind: "rejected"; message: string }
  /** Heated but publishable. The only failure with a way forward that isn't
   *  an edit — see the "Post anyway" affordance in the banner. */
  | { kind: "warning"; message: string }
  | { kind: "outage" }
  | { kind: "verify"; title: string }
  | { kind: "other"; title: string; message: string };

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
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const resendVerify = useResendVerification();
  const hydrated = useRef(false);

  // Photos aren't part of the saved draft: SecureStore holds strings, and a
  // picker URI is a file handle that may not survive an app restart anyway.
  // Losing a photo selection is recoverable in two taps; losing the text is
  // not, which is what the draft protects.
  const pickPhotos = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 0.7,
    });
    if (!res.canceled) {
      setPhotos((ps) => [...ps, ...res.assets.map(assetToPhoto)].slice(0, MAX_PHOTOS));
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!res.canceled) {
      setPhotos((ps) => [...ps, ...res.assets.map(assetToPhoto)].slice(0, MAX_PHOTOS));
    }
  };

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
  const canSubmit =
    rating > 0 && trimmed.length >= BODY_MIN && !pending && !uploadingPhotos;

  async function submit(acknowledgedWarning = false) {
    if (!canSubmit) return;
    setFailure(null);
    setPhotoWarning(null);
    try {
      let reviewId = existing?.id ?? null;
      if (existing) {
        await update.mutateAsync({
          reviewId: existing.id,
          rating,
          body: trimmed,
          acknowledged_warning: acknowledgedWarning,
        });
      } else {
        const created = await create.mutateAsync({
          rating,
          body: trimmed,
          acknowledged_warning: acknowledgedWarning,
        });
        reviewId = created.id;
      }

      // Photos upload AFTER the review exists — the server validates the
      // review is the caller's before spending anything on image
      // processing, and it needs an id to attach to.
      //
      // A failed photo must never cost the written review. The text is
      // already saved by this point; a photo that doesn't make it produces
      // a warning and the review still posts. SafeSearch fails closed, so
      // this is a real path, not a theoretical one.
      if (reviewId && photos.length > 0) {
        setUploadingPhotos(true);
        const stillFailing: LocalPhoto[] = [];
        for (const photo of photos) {
          try {
            await uploadReviewPhoto({ placeId, reviewId, ...photo });
          } catch {
            stillFailing.push(photo);
          }
        }
        setUploadingPhotos(false);

        if (stillFailing.length > 0) {
          // Drop the ones that made it. Retrying with the full set would
          // upload the successes a second time and leave duplicates on the
          // review.
          setPhotos(stillFailing);
          // The review itself posted, so the draft is spent either way.
          clearDraft();
          setPhotoWarning(
            `Your review posted. ${stillFailing.length} photo${stillFailing.length === 1 ? "" : "s"} didn't upload — tap Save to try again, or Done to finish without them.`,
          );
          return; // Stay put rather than losing this silently.
        }
      }

      clearDraft();
      router.back();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const code = (err as { code?: string })?.code;
      if (status === 503) {
        setFailure({ kind: "outage" });
      } else if (status === 400 && code === "REVIEW_TEXT_WARNING") {
        // Not a rejection — the server asks once before publishing.
        setFailure({
          kind: "warning",
          message:
            (err as { message?: string })?.message ??
            "This reads pretty heated.",
        });
      } else if (status === 400) {
        setFailure({
          kind: "rejected",
          message:
            (err as { message?: string })?.message ??
            "This can't be posted as written.",
        });
      } else if (status === 401) {
        setFailure({
          kind: "other",
          title: "You're signed out",
          message: "Sign in and your draft will still be here.",
        });
      } else if (status === 403) {
        // Not "check your inbox" — accounts that predate verification were
        // never sent anything. The banner below can send one.
        setFailure({ kind: "verify", title: "Confirm your email first" });
      } else {
        setFailure({
          kind: "other",
          title: "Couldn't post that",
          message: "Check your connection and try again.",
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
                failure.kind === "rejected" ? t.dangerSoft : t.amberSoft,
              borderRadius: radii.md,
              padding: 12,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 12,
                color: failure.kind === "rejected" ? t.danger : t.amber,
              }}
            >
              {failure.kind === "outage"
                ? "We couldn't run our content check"
                : failure.kind === "rejected"
                  ? "This can't be posted as written"
                  : failure.kind === "warning"
                    ? "Worth a second look"
                    : failure.title}
            </Text>
            <Text
              style={[
                ty.small,
                {
                  color: failure.kind === "rejected" ? t.danger : t.amber,
                  marginTop: 3,
                  lineHeight: 17,
                },
              ]}
            >
              {failure.kind === "outage"
                ? "That's on us, not your review. Your draft is saved — try again in a moment."
                : failure.kind === "rejected"
                  ? `${failure.message} Strong criticism is welcome; we just need it kept civil.`
                  : failure.kind === "warning"
                  ? failure.message
                  : failure.kind === "verify"
                    ? resendVerify.isSuccess
                      ? `Sent — check ${resendVerify.data?.email}, tap the link, then post. Your draft is saved.`
                      : "We'll email you a link. Your draft is saved."
                    : failure.message}
            </Text>
            {/* The only failure state offering a way forward that isn't an
                edit. "Post anyway" is deliberately the quieter of the two —
                a nudge nobody can decline is a block, and one that leads
                with "post anyway" isn't a nudge. */}
            {failure.kind === "warning" ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <Pressable
                  onPress={() => setFailure(null)}
                  style={{
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: t.amber,
                    paddingVertical: 7,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text
                    style={{
                      color: t.amber,
                      fontFamily: "Inter_700Bold",
                      fontSize: 12,
                    }}
                  >
                    Let me edit it
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => submit(true)}
                  disabled={pending}
                  style={{ paddingVertical: 7, paddingHorizontal: 6 }}
                >
                  <Text
                    style={{
                      color: t.amber,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 12,
                      opacity: pending ? 0.5 : 0.85,
                    }}
                  >
                    {pending ? "Posting…" : "Post anyway"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {failure.kind === "verify" && !resendVerify.isSuccess ? (
              <Pressable
                onPress={() => resendVerify.mutate()}
                disabled={resendVerify.isPending}
                style={{
                  marginTop: 8,
                  alignSelf: "flex-start",
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: t.amber,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                }}
              >
                <Text style={[ty.label, { color: t.amber, fontSize: 12.5 }]}>
                  {resendVerify.isPending ? "Sending…" : "Send me the link"}
                </Text>
              </Pressable>
            ) : null}
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

        <Text style={[ty.seg, { color: t.sub }]}>
          Photos <Text style={{ textTransform: "none", letterSpacing: 0 }}>(up to {MAX_PHOTOS})</Text>
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {photos.map((ph, i) => (
            <View key={`${ph.uri}-${i}`}>
              <Image
                source={{ uri: ph.uri }}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: radii.md,
                  backgroundColor: t.zincSoft,
                }}
              />
              <Pressable
                onPress={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                hitSlop={8}
                accessibilityLabel="Remove photo"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  backgroundColor: t.ink,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="x" size={13} color={t.onInk} />
              </Pressable>
            </View>
          ))}

          {photos.length < MAX_PHOTOS ? (
            <>
              <Pressable
                onPress={takePhoto}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: radii.md,
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: t.line,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                <Feather name="camera" size={18} color={t.sub} />
                <Text style={[ty.small, { color: t.sub, fontSize: 10 }]}>Camera</Text>
              </Pressable>
              <Pressable
                onPress={pickPhotos}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: radii.md,
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: t.line,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                <Feather name="image" size={18} color={t.sub} />
                <Text style={[ty.small, { color: t.sub, fontSize: 10 }]}>Library</Text>
              </Pressable>
            </>
          ) : null}
        </View>
        <Text style={[ty.small, { color: t.sub }]}>
          Location data is stripped from photos automatically.
        </Text>

        {photoWarning ? (
          <View
            style={{
              backgroundColor: t.amberSoft,
              borderRadius: radii.md,
              padding: 12,
            }}
          >
            <Text style={[ty.small, { color: t.amber, lineHeight: 17 }]}>
              {photoWarning}
            </Text>
            <Pressable onPress={() => router.back()} style={{ marginTop: 8 }}>
              <Text style={[ty.label, { color: t.amber, fontSize: 13 }]}>
                Done
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          // Wrapped, not passed directly: Pressable hands the handler a
          // GestureResponderEvent, which as `acknowledgedWarning` is truthy
          // — every post would have silently waived the nudge it exists for.
          onPress={() => submit(false)}
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
          {pending || uploadingPhotos ? (
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
