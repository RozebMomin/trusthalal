import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser, useMyVerifierApplications } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";
import { capture } from "@/lib/analytics";
import { Card, Seg, Tag } from "@/ui/kit";

/** Mockup 27, wired: pitch → status tracking. Tapping "Apply" pushes the
 *  dedicated /verifier-apply screen (the questions live there); this screen
 *  stays a clean pitch + status surface. Applications are tied to an
 *  account so status tracking works — one identity across diner and
 *  verifier life. */
export default function BecomeAVerifier() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const apps = useMyVerifierApplications(Boolean(me));

  const pending = apps.data?.find((a) => a.status === "PENDING");
  const rejected = apps.data?.find((a) => a.status === "REJECTED");

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
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={{ paddingTop: insets.top + space.md, padding: space.lg, paddingBottom: 60 }}
      >
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
            ) : (
              <View style={{ marginTop: 16 }}>
                <Button
                  title="Apply — takes 5 minutes"
                  variant="accent"
                  onPress={() => { capture("verifier_application_started"); router.push("/verifier-apply"); }}
                />
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
