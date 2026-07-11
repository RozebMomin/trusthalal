import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Animated, Pressable, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * The save heart, with feelings. On save: success haptic, springy
 * overshoot pop, and a one-shot emerald ring bursting outward. On
 * unsave: light haptic and a quick dip. Animation keys off the
 * `saved` prop flipping, so optimistic updates drive it instantly —
 * no waiting on the network for the pop.
 */
export function HeartButton({
  saved,
  onPress,
  size = 18,
  glass = false,
  label,
  style,
}: {
  saved: boolean;
  onPress: () => void;
  size?: number;
  /** Wrap in the floating glass circle (place-detail hero style). */
  glass?: boolean;
  label?: string;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const prev = useRef(saved);

  useEffect(() => {
    if (saved === prev.current) return;
    const becameSaved = saved && !prev.current;
    prev.current = saved;

    if (becameSaved) {
      ring.setValue(0);
      Animated.parallel([
        Animated.sequence([
          Animated.spring(scale, { toValue: 1.35, speed: 40, bounciness: 12, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, speed: 20, bounciness: 14, useNativeDriver: true }),
        ]),
        Animated.timing(ring, { toValue: 1, duration: 420, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.8, duration: 90, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, speed: 30, bounciness: 8, useNativeDriver: true }),
      ]).start();
    }
  }, [saved, scale, ring]);

  const handle = () => {
    // Haptic fires on the tap (intent), not the server round-trip.
    if (saved) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    onPress();
  };

  const heart = (
    <Animated.View style={{ transform: [{ scale }], alignItems: "center", justifyContent: "center" }}>
      {/* Ring burst — expands and fades behind the heart on save. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: size * 1.6,
          height: size * 1.6,
          borderRadius: 999,
          borderWidth: 2,
          borderColor: t.accent,
          opacity: ring.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.55, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.9] }) }],
        }}
      />
      {/* Idle color is FIXED dark: this button sits on fixed white glass
          over photos, and t.ink flips near-white in dark mode. */}
      <Ionicons name={saved ? "heart" : "heart-outline"} size={size} color={saved ? t.danger : "#0B0B0E"} />
    </Animated.View>
  );

  if (glass) {
    return (
      <Pressable
        accessibilityLabel={label ?? (saved ? "Unsave" : "Save")}
        onPress={handle}
        style={[
          {
            width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.92)",
            alignItems: "center", justifyContent: "center", overflow: "visible",
            shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 }, elevation: 4,
          },
          style,
        ]}
      >
        {heart}
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityLabel={label ?? (saved ? "Unsave" : "Save")} onPress={handle} hitSlop={10} style={style}>
      {heart}
    </Pressable>
  );
}
