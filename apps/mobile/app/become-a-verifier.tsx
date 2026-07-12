import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api/client";
import { useCurrentUser, useMyVerifierApplications, useSubmitVerifierApplication } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";
import { Card, Seg, Tag } from "@/ui/kit";

/** Mockup 27, wired: pitch → short application → status tracking.
 *  Anonymous applications are allowed by the API, but the app asks
 *  for sign-in first so status tracking works — one account, one
 *  identity across diner and verifier life. */
export default function BecomeAVerifier() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const apps = useMyVerifierApplications(Boolean(me));
  const submit = useSubmitVerifierApplication();

  const [formOpen, setFormOpen] = useState(false);
  const [motivation, setMotivation] = useState("");
  const [background, setBackground] = useState("");
  const [instagram, setInstagram] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pending = apps.data?.find((a) => a.status === "PENDING");
  const rejected = apps.data?.find((a) => a.status === "REJECTED");
  const tooShort = motivation.trim().length > 0 && motivation.trim().length < 20;

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
      setFormOpen(false);
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

  const PitchRow = ({ emoji, text, last }: { emoji: string; text: string; last?: boolean }) => (
    <View
      style={{
        flexDirection: "row", alignItems: "center", gap: 14,
        paddingVertical: 18, paddingHorizontal: 18,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: t.line,
      }}
    >
      <Text style={{ fontSize: 22 }}>{emoji}</Text>
      <Text style={[ty.body, { color: t.ink, fontSize: 17, lineHeight: 24, flex: 1 }]}>{text}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.md, padding: space.lg, paddingBottom: 60 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Feather name="chevron-left" size={20} color={t.sub} />
          <Text style={[ty.label, { color: t.sub, fontSize: 14 }]}>Profile</Text>
        </Pressable>

        <View style={{ marginTop: 18, width: 56, height: 56, borderRadius: 18, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
          <Feather name="shield" size={27} color={t.onAccent} />
        </View>
        <Text style={[ty.title, { color: t.ink, marginTop: 18, fontSize: 34, lineHeight: 39 }]}>You eat out anyway.{"\n"}Make it count.</Text>
        <Text style={[ty.body, { color: t.sub, marginTop: 12, fontSize: 18, lineHeight: 26 }]}>
          Verifiers eat at halal spots and file short, honest reports. Your name backs the badge diners trust.
        </Text>

        {/* Status states replace the CTA once an application exists */}
        {pending ? (
          <Card style={{ marginTop: 16, padding: space.lg, gap: 6 }}>
            <Tag label="APPLICATION IN REVIEW" tone="amber" />
            <Text style={[ty.small, { color: t.sub }]}>
              Submitted {new Date(pending.submitted_at).toLocaleDateString()}. A human reviews every
              application — usually within a week. You'll see the result here.
            </Text>
          </Card>
        ) : me?.role === "VERIFIER" ? (
          <Card style={{ marginTop: 16, padding: space.lg, gap: 6 }}>
            <Tag label="✓ YOU'RE A VERIFIER" tone="solid" />
            <Text style={[ty.small, { color: t.sub }]}>The field kit for filing visits from your phone arrives in an upcoming build.</Text>
          </Card>
        ) : (
          <>
            <Card style={{ marginTop: 18 }}>
              <PitchRow emoji="🍽" text="One visit a month — that's it" />
              <PitchRow emoji="📝" text="10-minute report, filed from the table" />
              <PitchRow emoji="🌍" text="Public profile you can link anywhere" last />
            </Card>
            <View
              style={{
                marginTop: 14,
                padding: 20,
                borderRadius: radii.xl,
                backgroundColor: t.amberSoft,
                borderWidth: 1,
                borderColor: "rgba(251,191,36,0.45)",
              }}
            >
              <Text style={[ty.label, { color: t.amber, fontSize: 14 }]}>The one non-negotiable</Text>
              <Text style={[ty.body, { color: t.amber, fontSize: 15, lineHeight: 21, marginTop: 5 }]}>
                Every visit discloses who paid for the meal. Comped is fine. Hidden is not.
              </Text>
            </View>
            {rejected?.decision_note ? (
              <Card style={{ marginTop: 10, padding: space.lg }}>
                <Seg>From your last application</Seg>
                <Text style={[ty.small, { color: t.sub, marginTop: 4 }]}>{rejected.decision_note}</Text>
              </Card>
            ) : null}

            {!me ? (
              <View style={{ marginTop: 16, gap: 10 }}>
                <Button title="Sign in to apply" variant="accent" onPress={() => router.push("/(auth)/sign-in")} />
                <Text style={[ty.small, { color: t.sub, fontSize: 13, textAlign: "center" }]}>
                  Applications are tied to your account so you can track the result.
                </Text>
              </View>
            ) : !formOpen ? (
              <View style={{ marginTop: 16 }}>
                <Button title="Apply — takes 5 minutes" variant="accent" onPress={() => setFormOpen(true)} />
              </View>
            ) : (
              <View style={{ marginTop: 14, gap: space.sm }}>
                <Seg>Why do you want to do this?</Seg>
                <TextInput
                  style={[field, { minHeight: 100, textAlignVertical: "top" }]}
                  multiline
                  maxLength={2000}
                  placeholder="A few honest sentences. Where you're based, what you eat, why this matters to you."
                  placeholderTextColor={t.sub}
                  value={motivation}
                  onChangeText={setMotivation}
                />
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={[ty.small, { color: tooShort ? t.danger : t.sub }]}>
                    {tooShort ? "At least 20 characters." : "Honest beats polished."}
                  </Text>
                  <Text style={[ty.small, { color: t.sub }]}>{motivation.trim().length}/2000</Text>
                </View>
                <Seg>Anything else about you? (optional)</Seg>
                <TextInput
                  style={[field, { minHeight: 70, textAlignVertical: "top" }]}
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
                <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
                  Applying as {me.display_name ?? me.email} · we may contact you at {me.email}
                </Text>
              </View>
            )}
            <Text style={[ty.small, { color: t.sub, fontSize: 13, textAlign: "center", marginTop: 14 }]}>
              Applications reviewed by a human · usually within a week
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
