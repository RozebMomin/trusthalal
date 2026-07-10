import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export function UiScreen({ title, children, dark }: { title?: string; children: React.ReactNode; dark?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: dark ? "#0C0C0F" : t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.md, padding: space.lg, gap: space.md, paddingBottom: 80 }}>
      <Pressable onPress={() => router.back()} accessibilityLabel="Back" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Feather name="chevron-left" size={18} color={dark ? "#8E8E96" : t.sub} />
        <Text style={[ty.label, { color: dark ? "#8E8E96" : t.sub, fontSize: 13 }]}>Back</Text>
      </Pressable>
      {title ? <Text style={[ty.title, { color: dark ? "#fff" : t.ink }]}>{title}</Text> : null}
      {children}
    </ScrollView>
  );
}
