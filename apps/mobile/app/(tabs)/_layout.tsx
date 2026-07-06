import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useTheme } from "@/lib/theme/useTheme";

/** v0 tabs per docs/first-slice.md: Explore · Saved · Profile.
 *  Verify + Activity join in Phase 11 (verifier field-kit, push). */
export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accentDeep,
        tabBarInactiveTintColor: t.sub,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line },
        tabBarLabelStyle: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Explore",
          tabBarIcon: ({ color, size }) => <Feather name="compass" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: "Saved",
          tabBarIcon: ({ color, size }) => <Feather name="heart" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
