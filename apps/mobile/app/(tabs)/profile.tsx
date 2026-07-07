import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser, useLogout } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";

export default function Profile() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const logout = useLogout();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        paddingTop: insets.top + space.sm,
        paddingHorizontal: space.lg,
        gap: space.md,
      }}
    >
      <Text style={[ty.title, { color: t.ink }]}>Profile</Text>

      {me ? (
        <View style={{ backgroundColor: "#0B0B0E", borderRadius: radii.xl, padding: space.lg, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 46, height: 46, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontFamily: "Inter_800ExtraBold", fontSize: 17 }}>
              {(me.display_name ?? me.email).charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[ty.label, { color: "#fff", fontSize: 15 }]}>{me.display_name ?? me.email}</Text>
            <Text style={[ty.small, { color: "rgba(255,255,255,0.55)" }]}>{me.email}</Text>
          </View>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Button title="Sign in" onPress={() => router.push("/(auth)/sign-in")} />
          <Button
            title="Create a free account"
            variant="secondary"
            onPress={() => router.push("/(auth)/sign-up")}
          />
        </View>
      )}

      <View style={{ backgroundColor: t.card, borderRadius: radii.xl }}>
        <LinkRow
          icon="info"
          label="About Trust Halal"
          onPress={() => Linking.openURL("https://trusthalal.org")}
        />
        <LinkRow
          icon="shield"
          label="How we use AI · ethics"
          onPress={() => Linking.openURL("https://trusthalal.org/ethics")}
        />
        <LinkRow
          icon="home"
          label="Own a restaurant?"
          onPress={() => Linking.openURL("https://owner.trusthalal.org")}
        />
        <LinkRow
          icon="layers"
          label="UI gallery (dev)"
          onPress={() => router.push("/ui-gallery")}
          last
        />
      </View>

      {me ? (
        <Pressable onPress={() => logout.mutate()} accessibilityRole="button">
          <Text
            style={[ty.label, { color: t.danger, textAlign: "center", paddingVertical: space.md }]}
          >
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>
      ) : null}

      <Text style={[ty.small, { color: t.sub, textAlign: "center", marginTop: "auto", paddingBottom: space.lg }]}>
        HalalScout by Trust Halal · v0.1.0{"\n"}Community-built · Muslim-led
      </Text>
    </View>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
  last,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.line,
      }}
    >
      <Feather name={icon} size={17} color={t.sub} />
      <Text style={[ty.body, { color: t.ink, flex: 1 }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={t.sub} />
    </Pressable>
  );
}
