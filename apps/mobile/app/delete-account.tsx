/**
 * Delete your account.
 *
 * ## Why this screen exists
 *
 * App Store Review Guideline 5.1.1(v): an app that lets you create an account
 * has to let you delete it from inside the app. Apple's guidance is explicit
 * that routing people to a support email doesn't satisfy it — which is what
 * the privacy policy used to do — and equally explicit that deletion takes
 * the user's content with it, naming photos and reviews specifically.
 *
 * ## What it tries to get right
 *
 * **Show the scope before the button.** The server returns what would
 * actually be removed, so this reads "4 reviews and 7 photos" rather than a
 * generic warning. An irreversible decision should be made against real
 * numbers.
 *
 * **Be honest about what survives.** Owner replies and restaurant-side photos
 * stay, because they belong to a business that still exists. Saying so here
 * is better than a user discovering it later and concluding we lied about
 * deleting everything.
 *
 * **Confirm without obstructing.** Password plus a typed DELETE. Apple
 * permits verifying identity; it fails apps that make deletion
 * "unnecessarily difficult", so that's the whole gate — no retention offer,
 * no survey, no cool-down.
 */
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
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
  useAccountDeletionPreview,
  useDeleteAccount,
  useCurrentUser,
} from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { ScreenHeader } from "@/ui/kit";

export default function DeleteAccountScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const preview = useAccountDeletionPreview(Boolean(me));
  const del = useDeleteAccount();

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canSubmit =
    password.length > 0 &&
    confirmation.trim().toUpperCase() === "DELETE" &&
    !del.isPending;

  async function submit() {
    if (!canSubmit) return;
    setErrorMsg(null);
    try {
      await del.mutateAsync({ password, confirmation: confirmation.trim() });
      // Tokens are cleared by the mutation. Land on Explore rather than a
      // sign-in wall — the account is gone, there's nothing to sign into,
      // and the app still works signed out.
      router.replace("/(tabs)");
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setErrorMsg(
        status === 401
          ? "That password doesn't match. Your account has not been deleted."
          : status === 429
            ? "Too many attempts. Try again a bit later."
            : "Couldn't delete your account just now. Nothing has been removed — try again in a moment.",
      );
    }
  }

  const counts = preview.data;

  // Bullets are built here rather than inline so the two of them can be
  // reasoned about together — they have to partition the user's photos, not
  // overlap. `photos_deleted` is standalone photos only and
  // `review_photos_deleted` is photos on their own reviews; a photo is in
  // exactly one. This bullet used to end "and any photos attached to them",
  // a hedge in the middle of an otherwise exact list, while the count below
  // it silently included those same photos — so a diner with one review and
  // one photo on it was shown two bullets describing one file.
  //
  // A zero line is dropped instead of printing "0 reviews you've written".
  // Listing what someone does not have is noise on a screen they are reading
  // to weigh a loss.
  const reviews = counts?.reviews_deleted ?? 0;
  const reviewPhotos = counts?.review_photos_deleted ?? 0;
  const standalone = counts?.photos_deleted ?? 0;

  let reviewLine: string | null = null;
  if (reviews > 0) {
    // "on it" / "on them" agrees with the REVIEW count, not the photo count —
    // the photos hang off the reviews.
    const onWhat = reviews === 1 ? "it" : "them";
    const written = `${reviews} review${reviews === 1 ? "" : "s"} you've written`;
    reviewLine =
      reviewPhotos === 0
        ? written
        : reviewPhotos === 1
          ? `${written}, and the photo on ${onWhat}`
          : `${written}, and the ${reviewPhotos} photos on ${onWhat}`;
  }

  const photoLine =
    standalone > 0
      ? `${standalone} photo${standalone === 1 ? "" : "s"} you've added to restaurants`
      : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xl,
          gap: space.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title="Delete account" onBack={() => router.back()} />

        <Text style={[ty.body, { color: t.sub, lineHeight: 21 }]}>
          This permanently deletes your Trust Halal account. It can&apos;t be
          undone.
        </Text>

        {/* Real numbers, not a generic warning. */}
        <View
          style={{
            backgroundColor: "#FEF2F2",
            borderWidth: 1,
            borderColor: "#FECACA",
            borderRadius: radii.md,
            padding: space.md,
            gap: 6,
          }}
        >
          <Text style={{ color: "#7F1D1D", fontFamily: "Inter_700Bold", fontSize: 13 }}>
            What gets deleted
          </Text>
          {preview.isLoading ? (
            <ActivityIndicator color="#7F1D1D" />
          ) : (
            <>
              <Text style={[ty.small, { color: "#7F1D1D", lineHeight: 19 }]}>
                • Your account and sign-in
              </Text>
              {reviewLine ? (
                <Text style={[ty.small, { color: "#7F1D1D", lineHeight: 19 }]}>
                  • {reviewLine}
                </Text>
              ) : null}
              {photoLine ? (
                <Text style={[ty.small, { color: "#7F1D1D", lineHeight: 19 }]}>
                  • {photoLine}
                </Text>
              ) : null}
              <Text style={[ty.small, { color: "#7F1D1D", lineHeight: 19 }]}>
                • Your saved places, search defaults and notification settings
              </Text>
            </>
          )}
        </View>

        {/* Saying this up front beats someone finding out afterwards and
            concluding we didn't really delete anything. */}
        <View
          style={{
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: radii.md,
            padding: space.md,
            gap: 6,
          }}
        >
          <Text style={[ty.label, { color: t.ink, fontSize: 13 }]}>
            What stays
          </Text>
          <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
            Reports you filed stay on file so we can finish reviewing them, but
            they stop being linked to you.
          </Text>
          {counts?.keeps_owner_replies ? (
            <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
              If you replied to reviews on behalf of a restaurant, those replies
              stay — they speak for the business, not for you personally.
            </Text>
          ) : null}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={[ty.label, { color: t.ink, fontSize: 13 }]}>
            Your password
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            placeholder="Enter your password"
            placeholderTextColor={t.sub}
            style={{
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: radii.md,
              backgroundColor: t.card,
              padding: 12,
              color: t.ink,
              fontFamily: "Inter_400Regular",
              fontSize: 15,
            }}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={[ty.label, { color: t.ink, fontSize: 13 }]}>
            Type DELETE to confirm
          </Text>
          <TextInput
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="DELETE"
            placeholderTextColor={t.sub}
            style={{
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: radii.md,
              backgroundColor: t.card,
              padding: 12,
              color: t.ink,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
              letterSpacing: 1,
            }}
          />
        </View>

        {errorMsg ? (
          <Text style={[ty.small, { color: "#B91C1C", lineHeight: 18 }]} role="alert">
            {errorMsg}
          </Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={{
            marginTop: space.xs,
            backgroundColor: canSubmit ? "#B91C1C" : t.zincSoft,
            borderRadius: radii.md,
            paddingVertical: 14,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: canSubmit ? "#fff" : t.sub,
              fontFamily: "Inter_700Bold",
              fontSize: 15,
            }}
          >
            {del.isPending ? "Deleting…" : "Delete my account"}
          </Text>
        </Pressable>

        <Pressable onPress={() => router.back()} style={{ alignItems: "center", paddingVertical: 10 }}>
          <Text style={[ty.body, { color: t.sub, fontWeight: "600" }]}>
            Keep my account
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
