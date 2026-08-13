import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { IconTile, Muted, Screen } from "@/components/ui";
import { useAuth } from "@/lib/auth/auth-store";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

function ActionCard({
  icon,
  title,
  body,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          backgroundColor: t.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.line,
          padding: space.lg,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        }}
      >
        <IconTile icon={icon} tone="green" />
        <View style={{ flex: 1 }}>
          <Text style={{ ...ty.body, fontWeight: "700", color: t.ink }}>{title}</Text>
          <Muted style={{ marginTop: 2 }}>{body}</Muted>
        </View>
        <Feather name="chevron-right" size={18} color={t.sub} />
      </View>
    </Pressable>
  );
}

export default function PlacesHub() {
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      <ActionCard
        icon="plus"
        title="Add a place"
        body="Search Google and add one restaurant"
        onPress={() => router.push("/places/add" as never)}
      />
      <ActionCard
        icon="layers"
        title="Bulk add"
        body="Stage several, preview, then import"
        onPress={() => router.push("/places/bulk" as never)}
      />
      <Muted style={{ marginTop: space.sm, marginLeft: 4 }}>
        Adding a place creates its catalog entry from Google. Owners claim and
        submit halal details separately.
      </Muted>
    </Screen>
  );
}
