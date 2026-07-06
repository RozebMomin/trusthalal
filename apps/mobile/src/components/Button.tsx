import * as Haptics from "expo-haptics";
import { ActivityIndicator, Pressable, Text } from "react-native";
import { radii, type Palette } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Variant = "primary" | "accent" | "secondary";

function bg(v: Variant, t: Palette, pressed: boolean) {
  if (v === "accent") return pressed ? t.accentDeep : t.accent;
  if (v === "secondary") return t.card;
  return pressed ? "#26262B" : t.ink;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
}) {
  const t = useTheme();
  const fg = variant === "secondary" ? t.ink : "#FFFFFF";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => ({
        backgroundColor: bg(variant, t, pressed),
        borderRadius: radii.lg,
        paddingVertical: 14,
        alignItems: "center",
        opacity: disabled ? 0.5 : 1,
        borderWidth: variant === "secondary" ? 1 : 0,
        borderColor: t.line,
        minHeight: 48,
        justifyContent: "center",
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontFamily: "Inter_700Bold", fontSize: 14 }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
