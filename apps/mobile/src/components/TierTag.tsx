import { Text, View } from "react-native";
import { toneStyle, type PrimarySignal } from "@/lib/halal-display";
import { useTheme } from "@/lib/theme/useTheme";

/** The most important pixel on every screen. */
export function TierTag({ signal }: { signal: PrimarySignal }) {
  const t = useTheme();
  const s = toneStyle(signal.tone, t);
  return (
    <View
      accessibilityLabel={signal.description}
      style={{
        alignSelf: "flex-start",
        backgroundColor: s.bg,
        borderColor: s.border,
        borderWidth: 1,
        borderStyle: s.dashed ? "dashed" : "solid",
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 3.5,
      }}
    >
      <Text
        style={{
          color: s.fg,
          fontFamily: "Inter_700Bold",
          fontSize: 9.5,
          letterSpacing: 0.3,
        }}
      >
        {signal.label}
      </Text>
    </View>
  );
}
