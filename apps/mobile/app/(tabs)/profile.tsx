import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser, useLogout } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";
import { Card, Cell, IcBox, Seg, Tag } from "@/ui/kit";

// The onboarding-replay tool shows in local dev AND in beta builds that set
// EXPO_PUBLIC_DEV_TOOLS=1 (the eas.json "beta" profile). The public App Store
// build uses the "production" profile without that flag, so it disappears —
// that's how you "revoke" it. The UI gallery below stays strictly __DEV__
// because it renders fabricated trust data.
const SHOW_DEV_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === "1";

/** Mockup 8: dark gradient account card, sectioned rows with colored
 *  icon boxes and live right-hand values, red sign-out, quiet footer. */
export default function Profile() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const logout = useLogout();

  const chev = <Feather name="chevron-right" size={16} color={t.sub} />;
  const rightText = (s: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text style={[ty.small, { color: t.sub }]}>{s}</Text>
      {chev}
    </View>
  );

  return (
    // Safe-area gap is a fixed outer padding so re-tapping the tab can't let
    // iOS re-apply the inset and drift the content down each time.
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingTop: space.sm, paddingHorizontal: space.lg, paddingBottom: 120, gap: space.md }}
    >
      <Text style={[ty.title, { color: t.ink }]}>Profile</Text>

      {me ? (
        <LinearGradient
          colors={["#0B0B0E", "#1F2937"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: radii.xl, padding: space.lg, flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          <LinearGradient
            colors={["#34D399", "#059669"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: 46, height: 46, borderRadius: 999, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_800ExtraBold", fontSize: 17 }}>
              {(me.display_name ?? me.email).charAt(0).toUpperCase()}
            </Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={[ty.label, { color: "#fff", fontSize: 15 }]}>{me.display_name ?? me.email}</Text>
            <Text style={[ty.small, { color: "rgba(255,255,255,0.55)" }]}>{me.email}</Text>
          </View>
          {me.role === "VERIFIER" ? <Tag label="✓ VERIFIER" tone="solid" /> : null}
        </LinearGradient>
      ) : (
        <View style={{ gap: space.sm }}>
          <Button title="Create a free account" onPress={() => router.push("/(auth)/sign-up")} />
          <Button title="Sign in" variant="secondary" onPress={() => router.push("/(auth)/sign-in")} />
        </View>
      )}

      {/* Tiles are `action` (an in-app screen) except Blocked people, which
          is `safety` — see IcBox for why that one earns an exception. This
          list previously ran emerald / blue / emerald / grey: four tones, no
          rule, which looks like a code the reader is failing to crack. */}
      <Seg style={{ marginTop: space.xs }}>Preferences</Seg>
      <Card>
        <Cell
          onPress={() => router.push("/search-preferences")}
          left={<><IcBox icon="sliders" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Search defaults</Text></>}
          right={chev}
        />
        <Cell
          onPress={() => router.push("/notifications")}
          left={<><IcBox icon="bell" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Notifications</Text></>}
          right={chev}
        />
        {/* Reachable without an email arriving. This is the only surface
            where a hidden or removed review is visible to its author, so
            burying it behind a notification would defeat the purpose. */}
        <Cell
          onPress={() => router.push("/my-reviews")}
          left={<><IcBox icon="message-square" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Your reviews</Text></>}
          right={chev}
        />
        {/* A block you can't undo is a trap. Guideline 1.2 requires the
            ability to block; this is the way back.

            The one red tile in the column, and the one row here that isn't
            a preference — it's the who-can-reach-me control. Someone opens
            this list because another person is bothering them, which is not
            a state you want to be reading four labels to escape. */}
        <Cell
          last
          onPress={() => router.push("/blocked")}
          left={<><IcBox icon="slash" tone="safety" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Blocked people</Text></>}
          right={chev}
        />
      </Card>

      <Seg>Trust Halal</Seg>
      <Card>
        {/* Verifiers reach their visits from the dedicated Verify tab, so
            there's no redundant row here. */}
        {me?.role !== "VERIFIER" ? (
          // The end-to-end verifier flow is live, so this is open to everyone
          // (signed-out users get the pitch, then sign-in on Apply).
          <Cell
            onPress={() => router.push("/become-a-verifier")}
            left={<><IcBox icon="shield" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Become a verifier</Text></>}
            right={chev}
          />
        ) : null}
        <Cell
          onPress={() => Linking.openURL("https://trusthalal.org/ethics")}
          left={<><IcBox icon="info" tone="external" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>How Trust Halal uses AI</Text></>}
          right={rightText("web ↗")}
        />
        <Cell
          last={!SHOW_DEV_TOOLS}
          onPress={() => Linking.openURL("https://owner.trusthalal.org/get-verified")}
          left={<><IcBox icon="home" tone="external" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Own a restaurant?</Text></>}
          right={rightText("web ↗")}
        />
        {/* Replay onboarding — dev + beta builds only (see SHOW_DEV_TOOLS). */}
        {SHOW_DEV_TOOLS ? (
          <Cell
            last={!__DEV__}
            onPress={async () => {
              await SecureStore.deleteItemAsync("onboarded_v1");
              router.replace("/onboarding");
            }}
            left={<><IcBox icon="refresh-cw" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Replay onboarding</Text></>}
            right={chev}
          />
        ) : null}
        {/* Fixture gallery stays strictly dev-only (renders fake trust data). */}
        {__DEV__ ? (
          <Cell
            last
            onPress={() => router.push("/ui-gallery")}
            left={<><IcBox icon="layers" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>UI gallery (dev)</Text></>}
            right={chev}
          />
        ) : null}
      </Card>

      {me ? (
        <>
          <Pressable onPress={() => logout.mutate()} accessibilityRole="button">
            <Text style={[ty.label, { color: t.danger, textAlign: "center", paddingVertical: space.md }]}>
              {logout.isPending ? "Signing out…" : "Sign out"}
            </Text>
          </Pressable>

          {/* Account deletion has to be reachable from account settings —
              App Store guideline 5.1.1(v), and Apple's guidance says to make
              it easy to find rather than buried. Quieter than Sign out
              because it's the rarer and more destructive of the two, but
              plainly labelled and one tap away. */}
          <Pressable
            onPress={() => router.push("/delete-account")}
            accessibilityRole="button"
          >
            <Text style={[ty.small, { color: t.sub, textAlign: "center", paddingBottom: space.md }]}>
              Delete account
            </Text>
          </Pressable>
        </>
      ) : null}

      {/* Published contact information — required for apps with
          user-generated content (guideline 1.2), and the app had no way to
          reach us at all before reviews shipped. */}
      <Pressable
        onPress={() => Linking.openURL("mailto:support@trusthalal.org")}
        accessibilityRole="button"
      >
        <Text style={[ty.small, { color: t.accentDeep, textAlign: "center", fontWeight: "600" }]}>
          Contact support
        </Text>
      </Pressable>

      <Text style={[ty.small, { color: t.sub, textAlign: "center", marginTop: space.sm }]}>
        Trust Halal · v0.1.0{"\n"}Community-built · Muslim-led
      </Text>
    </ScrollView>
    </View>
  );
}
