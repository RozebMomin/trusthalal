import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { useTheme } from "@/lib/theme/useTheme";

/** Floating pill nav from the mockups. Verify + Activity tabs join in
 *  Phase 11 (verifier field-kit, push). */
export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accentDeep,
        tabBarInactiveTintColor: t.sub,
        tabBarStyle: {
          position: "absolute",
          left: 18,
          right: 18,
          bottom: Platform.OS === "ios" ? 24 : 14,
          height: 62,
          borderRadius: 999,
          backgroundColor: t.card,
          borderTopWidth: 0,
          paddingTop: 8,
          paddingBottom: 10,
          shadowColor: "#000",
          shadowOpacity: 0.14,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        },
        tabBarLabelStyle: { fontFamily: "Inter_600SemiBold", fontSize: 9 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Explore", tabBarIcon: (p) => <Feather name="compass" {...p} size={21} /> }} />
      <Tabs.Screen name="saved" options={{ title: "Saved", tabBarIcon: (p) => <Feather name="heart" {...p} size={21} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: (p) => <Feather name="user" {...p} size={21} /> }} />
    </Tabs>
  );
}
