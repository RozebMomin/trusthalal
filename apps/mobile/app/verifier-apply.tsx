import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api/client";
import { useCurrentUser, useSubmitVerifierApplication } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";
import { capture } from "@/lib/analytics";
import { Seg } from "@/ui/kit";

/** Dedicated verifier-application screen. Reached from the "Become a
 *  verifier" pitch via the Apply button — a full screen with the
 *  questions, rather than an inline form, so the flow reads cleanly.
 *  On submit we pop back to the pitch, which refreshes to the
 *  "in review" state (the submit mutation invalidates the applications
 *  query). */
export default function VerifierApply() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const submit = useSubmitVerifierApplication();

  const [motivation, setMotivation] = useState("");
  const [background, setBackground] = useState("");
  const [instagram, setInstagram] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tooShort = motivation.trim().length > 0 && motivation.trim().length < 20;

  // Applications are tied to an account. If somehow reached signed-out,
  // send them to sign-in rather than letting them fill a form that can't
  // be submitted.
  useEffect(() => {
    if (me === null) router.replace("/(auth)/sign-in");
  }, [me]);

  async function onSubmit() {
    if (!me) return;
    setError(null);
    try {
      await submit.mutateAsync({
        applicant_email: me.email,
        applicant_name: me.display_name ?? me.email,
        motivation: motivation.trim(),
        background: background.trim() || undefined,
        social_links: instagram.trim() ? { instagram: instagram.trim() } : undefined,
      });
      capture("verifier_application_submitted");
      router.back();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? "Too many applications from this network — try again in an hour."
          : e instanceof ApiError
            ? e.message
            : "Something went wrong. Try again in a moment.",
      );
    }
  }

  const field = {
    backgroundColor: t.card, borderRadius: radii.lg, paddingHorizontal: space.lg,
    paddingVertical: 12, color: t.ink, ...ty.body,
  } as const;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + space.md, padding: space.lg, paddingBottom: 60 }}
      >
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Feather name="chevron-left" size={20} color={t.sub} />
          <Text style={[ty.label, { color: t.sub, fontSize: 14 }]}>Back</Text>
        </Pressable>

        <Text style={[ty.title, { color: t.ink, marginTop: 16, fontSize: 28, lineHeight: 33 }]}>Verifier application</Text>
        <Text style={[ty.body, { color: t.sub, marginTop: 8, fontSize: 16, lineHeight: 23 }]}>
          A few honest questions. A human reviews every application — usually within a week.
        </Text>

        {/* The disclosure rule up front, before they invest in the form. */}
        <View
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: radii.xl,
            backgroundColor: t.amberSoft,
            borderWidth: 1,
            borderColor: "rgba(251,191,36,0.45)",
          }}
        >
          <Text style={[ty.label, { color: t.amber, fontSize: 13 }]}>The one non-negotiable</Text>
          <Text style={[ty.body, { color: t.amber, fontSize: 14, lineHeight: 20, marginTop: 4 }]}>
            Every visit discloses who paid for the meal. Comped is fine. Hidden is not.
          </Text>
        </View>

        <View style={{ marginTop: 18, gap: space.sm }}>
          <Seg>Why do you want to do this?</Seg>
          <TextInput
            style={[field, { minHeight: 120, textAlignVertical: "top" }]}
            multiline
            maxLength={2000}
            placeholder="A few honest sentences. Where you're based, what you eat, why this matters to you."
            placeholderTextColor={t.sub}
            value={motivation}
            onChangeText={setMotivation}
            autoFocus
          />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[ty.small, { color: tooShort ? t.danger : t.sub }]}>
              {tooShort ? "At least 20 characters." : "Honest beats polished."}
            </Text>
            <Text style={[ty.small, { color: t.sub }]}>{motivation.trim().length}/2000</Text>
          </View>

          <Seg>Anything else about you? (optional)</Seg>
          <TextInput
            style={[field, { minHeight: 80, textAlignVertical: "top" }]}
            multiline
            maxLength={2000}
            placeholder="Food-writing, mosque involvement, community organizing — anything relevant."
            placeholderTextColor={t.sub}
            value={background}
            onChangeText={setBackground}
          />

          <Seg>Instagram (optional)</Seg>
          <TextInput
            style={field}
            autoCapitalize="none"
            placeholder="@yourhandle"
            placeholderTextColor={t.sub}
            value={instagram}
            onChangeText={setInstagram}
          />

          {error ? <Text style={[ty.small, { color: t.danger }]}>{error}</Text> : null}

          <Button
            title="Submit application"
            variant="accent"
            loading={submit.isPending}
            disabled={motivation.trim().length < 20}
            onPress={onSubmit}
          />
          {me ? (
            <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
              Applying as {me.display_name ?? me.email} · we may contact you at {me.email}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
