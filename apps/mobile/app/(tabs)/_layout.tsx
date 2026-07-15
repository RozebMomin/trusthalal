import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { Platform, StyleSheet, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser } from "@/lib/api/hooks";
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
  // The Verify tab is verifier-only. Read the role once here so both the
  // native and frosted bars can add/hide it.
  const { data: me } = useCurrentUser();
  const isVerifier = me?.role === "VERIFIER";
  return IOS_26 ? (
    <GlassNativeTabs isVerifier={isVerifier} />
  ) : (
    <FrostedPillTabs isVerifier={isVerifier} />
  );
}

function GlassNativeTabs({ isVerifier }: { isVerifier: boolean }) {
  const t = useTheme();
  return (
    // tintColor drives the selected-tab color on the system bar — without
    // it iOS falls back to its default blue. Match the brand deep emerald.
    <NativeTabs tintColor={t.accentDeep}>
      <NativeTabs.Trigger name="index">
        <Icon sf="safari.fill" drawable="ic_explore" />
        <Label>Explore</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <Icon sf="heart.fill" drawable="ic_saved" />
        <Label>Saved</Label>
      </NativeTabs.Trigger>
      {/* Always declared so the route has a trigger; `hidden` (not a
          conditional null child) keeps it out of the bar for non-verifiers. */}
      <NativeTabs.Trigger name="verify" hidden={!isVerifier}>
        <Icon sf="checkmark.seal.fill" drawable="ic_verify" />
        <Label>Verify</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf="person.fill" drawable="ic_profile" />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function FrostedPillTabs({ isVerifier }: { isVerifier: boolean }) {
  const t = useTheme();
  const dark = useColorScheme() === "dark";
  const insets = useSafeAreaInsets();
  // Lift the floating pill above the device's bottom safe area. On Android
  // with on-screen nav buttons insets.bottom is ~48; with gesture nav it's
  // small — either way, sit a fixed gap above it instead of a hardcoded
  // margin that the system nav overlaps. iOS keeps its tuned home-indicator gap.
  const barMarginBottom =
    Platform.OS === "ios" ? 28 : Math.max(insets.bottom, 8) + 10;
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
          marginBottom: barMarginBottom,
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
      {/* Verifier-only. href:null hides the tab (and its route) for everyone
          else — the badge only appears once the account is a VERIFIER. */}
      <Tabs.Screen
        name="verify"
        options={{
          title: "Verify",
          href: isVerifier ? undefined : null,
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? "shield-checkmark" : "shield-checkmark-outline"} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? "person" : "person-outline"} color={color} size={22} /> }} />
    </Tabs>
  );
}
