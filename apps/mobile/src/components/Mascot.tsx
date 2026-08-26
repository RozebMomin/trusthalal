import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { mockupPx, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * Hilal — the crescent-moon guide who walks a verifier through filing a visit.
 * A warm, encouraging voice in a speech bubble beside the mascot, with a very
 * subtle idle bob so it feels alive without being distracting. One static art
 * asset (assets/mascot.png), reused across steps with changing copy.
 */
export function Mascot({ title, line }: { title?: string; line: string }) {
  const t = useTheme();
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1700, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: space.sm }}>
      <Animated.Image
        source={require("../../assets/mascot.png")}
        style={{ width: 62, height: 62, transform: [{ translateY }] }}
        resizeMode="contain"
        accessibilityLabel="Hilal, your guide"
      />
      <View
        style={{
          flex: 1,
          backgroundColor: t.accentSoft,
          borderRadius: 16,
          borderTopLeftRadius: 4,
          paddingHorizontal: 14,
          paddingVertical: 11,
          gap: 3,
          marginTop: 6,
        }}
      >
        {title ? (
          <Text style={[ty.title, { color: t.ink, fontSize: mockupPx(15.5), lineHeight: mockupPx(18.5) }]}>
            {title}
          </Text>
        ) : null}
        <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(11), lineHeight: mockupPx(15.5) }]}>
          {line}
        </Text>
      </View>
    </View>
  );
}
