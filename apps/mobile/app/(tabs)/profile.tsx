import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser, useLogout, useMyFavorites } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";
import { Card, Cell, IcBox, Seg, Tag } from "@/ui/kit";

/** Mockup 8: dark gradient account card, sectioned rows with colored
 *  icon boxes and live right-hand values, red sign-out, quiet footer. */
export default function Profile() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const favorites = useMyFavorites(Boolean(me));
  const logout = useLogout();
  const savedCount = favorites.data?.length ?? 0;

  const chev = <Feather name="chevron-right" size={16} color={t.sub} />;
  const rightText = (s: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text style={[ty.small, { color: t.sub }]}>{s}</Text>
      {chev}
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg, paddingBottom: 120, gap: space.md }}
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

      <Seg style={{ marginTop: space.xs }}>Preferences</Seg>
      <Card>
        <Cell
          left={<><IcBox icon="sliders" bg={t.accentSoft} fg={t.accentDeep} /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Search defaults</Text></>}
          right={<Tag label="SOON" tone="dashed" />}
        />
        <Cell
          onPress={() => router.push("/ui/notifications")}
          left={<><IcBox icon="bell" bg="#EFF6FF" fg="#2563EB" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Notifications</Text></>}
          right={chev}
        />
        <Cell
          last
          onPress={() => router.push("/(tabs)/saved")}
          left={<><IcBox icon="heart" bg="#FDF2F8" fg="#DB2777" /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Saved places</Text></>}
          right={me ? rightText(`${savedCount} place${savedCount === 1 ? "" : "s"}`) : chev}
        />
      </Card>

      <Seg>Trust Halal</Seg>
      <Card>
        {me?.role === "VERIFIER" ? (
          <Cell
            onPress={() => router.push("/ui/verifier-profile")}
            left={<><IcBox icon="shield" bg={t.zincSoft} fg={t.zinc} /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>My verifier profile</Text></>}
            right={rightText("public")}
          />
        ) : null}
        <Cell
          onPress={() => Linking.openURL("https://trusthalal.org/ethics")}
          left={<><IcBox icon="info" bg={t.zincSoft} fg={t.zinc} /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>How Trust Halal uses AI</Text></>}
          right={chev}
        />
        <Cell
          onPress={() => Linking.openURL("https://owner.trusthalal.org")}
          left={<><IcBox icon="home" bg={t.zincSoft} fg={t.zinc} /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Own a restaurant?</Text></>}
          right={rightText("web ↗")}
        />
        <Cell
          last
          onPress={() => router.push("/ui-gallery")}
          left={<><IcBox icon="layers" bg={t.zincSoft} fg={t.zinc} /><Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>UI gallery (dev)</Text></>}
          right={chev}
        />
      </Card>

      {me ? (
        <Pressable onPress={() => logout.mutate()} accessibilityRole="button">
          <Text style={[ty.label, { color: t.danger, textAlign: "center", paddingVertical: space.md }]}>
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>
      ) : null}

      <Text style={[ty.small, { color: t.sub, textAlign: "center", marginTop: space.sm }]}>
        HalalScout by Trust Halal · v0.1.0{"\n"}Community-built · Muslim-led
      </Text>
    </ScrollView>
  );
}
