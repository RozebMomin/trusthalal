import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { Platform, StyleSheet, useColorScheme } from "react-native";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * Tab bar strategy:
 *  - iOS 26+ → the system's real Liquid Glass capsule via native tabs
 *    (needs an Xcode 26 build; refraction, scroll-edge effects, all free).
 *  - iOS <26 and Android → our own floating frosted pill: expo-blur
 *    BlurView background (true blur, graceful contrast overlay),
 *    correct radius/shadow, no fighting the system.
 * Same three tabs either way; Verify + Activity join in Phase 11.
 */
const IOS_26 =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

export default function TabsLayout() {
  return IOS_26 ? <GlassNativeTabs /> : <FrostedPillTabs />;
}

function GlassNativeTabs() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf="safari.fill" drawable="ic_explore" />
        <Label>Explore</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <Icon sf="heart.fill" drawable="ic_saved" />
        <Label>Saved</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf="person.fill" drawable="ic_profile" />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function FrostedPillTabs() {
  const t = useTheme();
  const dark = useColorScheme() === "dark";
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accentDeep,
        tabBarInactiveTintColor: t.sub,
        tabBarLabelStyle: { fontFamily: "Inter_600SemiBold", fontSize: 9 },
        tabBarStyle: {
          position: "absolute",
          // Margins, not left/right offsets — React Navigation's bar
          // container ignores edge offsets, which stretched the pill
          // full-width. Margins inset it reliably on both platforms.
          marginHorizontal: 18,
          marginBottom: Platform.OS === "ios" ? 28 : 16,
          height: 62,
          borderRadius: 999,
          overflow: "hidden",
          borderTopWidth: 0,
          backgroundColor: "transparent",
          paddingTop: 8,
          paddingBottom: 10,
          shadowColor: "#000",
          shadowOpacity: 0.16,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        },
        tabBarBackground: () => (
          <BlurView
            intensity={dark ? 40 : 60}
            tint={dark ? "dark" : "light"}
            style={[
              StyleSheet.absoluteFill,
              // Soft wash on top of the blur so labels keep AA contrast
              // over busy photo content scrolling underneath.
              { backgroundColor: dark ? "rgba(22,22,25,0.55)" : "rgba(255,255,255,0.55)" },
            ]}
          />
        ),
      }}
    >
      {/* Filled icon when active, outline when not — mockup convention,
          and it mirrors what SF Symbols do on the iOS 26 native bar. */}
      <Tabs.Screen name="index" options={{ title: "Explore", tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? "compass" : "compass-outline"} color={color} size={22} /> }} />
      <Tabs.Screen name="saved" options={{ title: "Saved", tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? "heart" : "heart-outline"} color={color} size={22} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? "person" : "person-outline"} color={color} size={22} /> }} />
    </Tabs>
  );
}
