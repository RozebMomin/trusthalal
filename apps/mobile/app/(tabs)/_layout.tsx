import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";

/**
 * Native system tab bar (expo-router native tabs, SDK 54+).
 *
 * Why native instead of the custom floating pill we had: on iOS 26
 * the system bar renders as a floating Liquid Glass capsule with real
 * refraction, automatic scroll-edge effects, and correct safe-area
 * behavior — everything the JS pill approximated badly. On iOS 18 and
 * earlier it falls back to the classic tab bar; Android adapts to
 * Material 3. Requires a build with Xcode 26 for the glass effect.
 * The system owns the look — don't fight it with custom backgrounds.
 *
 * Icons are SF Symbols on iOS (drawable on Android). Verify + Activity
 * tabs join in Phase 11.
 */
export default function TabsLayout() {
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
