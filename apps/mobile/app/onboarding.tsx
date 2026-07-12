import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";

export const ONBOARDED_KEY = "onboarded_v1";

async function finish() {
  await SecureStore.setItemAsync(ONBOARDED_KEY, "1");
  router.replace("/(tabs)");
}

/** Mockups 9–11: promise → tiers → location priming (denial path visible). */
export default function Onboarding() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);

  async function allowLocation() {
    await Location.requestForegroundPermissionsAsync().catch(() => undefined);
    await finish();
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {step === 0 && (
        <View style={{ flex: 1 }}>
          {/* Hero photo fills the top and fades into the bg — flex:1 so it
              grows to meet the bottom content block on any screen size. */}
          <View style={{ flex: 1 }}>
            <Image
              source={require("../assets/onboarding-hero.jpg")}
              style={{ width: "100%", height: "100%", resizeMode: "cover" }}
            />
            <LinearGradient
              colors={["transparent", t.bg]}
              style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 240 }}
            />
          </View>
          {/* Copy + CTA anchored together at the bottom, close by design. */}
          <View style={{ paddingHorizontal: space.xl, gap: space.md }}>
            <View style={{ width: 48, height: 48, borderRadius: radii.md, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
              <Feather name="check" size={24} color={t.onAccent} />
            </View>
            <Text style={[ty.title, { color: t.ink, fontSize: 30, lineHeight: 34 }]}>
              The last word{"\n"}on halal.
            </Text>
            <Text style={[ty.body, { color: t.sub }]}>
              Every halal claim on Trust Halal is checked — certificate, sourcing, or an in-person
              visit by someone from the community. The full record, before you eat.
            </Text>
          </View>
          <View style={{ paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
            <Button title="Get started" onPress={() => setStep(1)} />
            <Dots step={0} />
          </View>
          {/* Skip floats over the hero (light for contrast on the image). */}
          <Pressable onPress={finish} style={{ position: "absolute", top: insets.top + space.xs, right: space.xl }}>
            <Text style={[ty.label, { color: "rgba(255,255,255,0.92)", fontSize: 13 }]}>Skip</Text>
          </Pressable>
        </View>
      )}

      {step !== 0 && (
        <View style={{ flex: 1, paddingTop: insets.top + space.lg, paddingHorizontal: space.xl }}>
          <Pressable onPress={finish} style={{ alignSelf: "flex-end" }}>
            <Text style={[ty.label, { color: t.sub, fontSize: 13 }]}>Skip</Text>
          </Pressable>

      {step === 1 && (
        <View style={{ flex: 1, paddingTop: space.md }}>
          <Text style={[ty.title, { color: t.ink, fontSize: 26 }]}>
            Every place wears{"\n"}its level of proof.
          </Text>
          <Text style={[ty.body, { color: t.sub, marginTop: space.sm }]}>
            Look for the tag. Higher tiers mean stronger, third-party evidence.
          </Text>
          {/* Tiers grow to fill the screen so the proof ladder reads big. */}
          <View style={{ flex: 1, gap: space.md, marginTop: space.lg }}>
            <Tier label="✓ VERIFIED HALAL" title="Confirmed in person" body="A community verifier ate there and filed a public report." solid featured />
            <Tier label="CERTIFIED" title="Certificate on file" body="A current halal certificate from a recognized authority." amber />
            <Tier label="OWNER-ATTESTED" title="The owner says so" body="Claimed halal with details — not yet independently checked." />
          </View>
          <View style={{ paddingTop: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
            <Button title="Continue" onPress={() => setStep(2)} />
            <Dots step={1} />
          </View>
        </View>
      )}

      {step === 2 && (
        <View style={{ flex: 1, gap: space.md, paddingTop: space.xl }}>
          <View style={{ alignItems: "center", paddingVertical: space.xl }}>
            <View style={{ width: 176, height: 176, borderRadius: 999, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 104, height: 104, borderRadius: 999, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 52, height: 52, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
                  <Feather name="map-pin" size={24} color={t.onAccent} />
                </View>
              </View>
            </View>
          </View>
          <Text style={[ty.title, { color: t.ink, fontSize: 26 }]}>
            Halal near you,{"\n"}in two seconds.
          </Text>
          <Text style={[ty.body, { color: t.sub }]}>
            We use your location only while you're in the app, only to find places nearby. Never
            sold, never shared.
          </Text>
          <View style={{ marginTop: "auto", paddingBottom: space.xl, gap: space.sm }}>
            <Button title="Allow location" variant="accent" onPress={allowLocation} />
            <Pressable onPress={finish}>
              <Text style={[ty.label, { color: t.sub, textAlign: "center", paddingVertical: 10 }]}>
                Pick a city instead
              </Text>
            </Pressable>
            <Dots step={2} />
          </View>
        </View>
      )}
        </View>
      )}
    </View>
  );
}

function Dots({ step }: { step: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 5, justifyContent: "center" }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: i === step ? 18 : 5,
            height: 5,
            borderRadius: 999,
            backgroundColor: i === step ? t.ink : t.line,
          }}
        />
      ))}
    </View>
  );
}

function Tier({
  label,
  title,
  body,
  solid,
  amber,
  featured,
}: {
  label: string;
  title: string;
  body: string;
  solid?: boolean;
  amber?: boolean;
  featured?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        backgroundColor: t.card,
        borderRadius: radii.xl,
        padding: space.xl,
        borderWidth: featured ? 2 : 0,
        borderColor: t.accent,
        gap: 8,
      }}
    >
      <View
        style={{
          alignSelf: "flex-start",
          backgroundColor: solid ? t.accent : amber ? t.amberSoft : t.zincSoft,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 5,
        }}
      >
        <Text style={{ color: solid ? t.onAccent : amber ? t.amber : t.zinc, fontFamily: "Inter_700Bold", fontSize: 10.5 }}>
          {label}
        </Text>
      </View>
      <Text style={[ty.label, { color: t.ink, marginTop: 6, fontSize: 18 }]}>{title}</Text>
      <Text style={[ty.body, { color: t.sub }]}>{body}</Text>
    </View>
  );
}
