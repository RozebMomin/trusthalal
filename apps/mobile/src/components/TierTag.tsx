import { Text, View } from "react-native";
import { toneStyle, type PrimarySignal } from "@/lib/halal-display";
import { useTheme } from "@/lib/theme/useTheme";

/** The most important pixel on every screen. */
export function TierTag({
  signal,
  onPhoto = false,
}: {
  signal: PrimarySignal;
  /** Riding an image: the muted tone's transparent background blends
   *  into photos, so it gets a solid white-glass backing (mockup-1
   *  "NO INFO YET" treatment). Solid/wash tones are already opaque. */
  onPhoto?: boolean;
}) {
  const t = useTheme();
  const s = toneStyle(signal.tone, t);
  if (onPhoto && signal.tone === "muted") {
    s.bg = "rgba(255,255,255,0.92)";
    s.fg = "#52525B";
    s.border = "#A1A1AA";
  }
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
