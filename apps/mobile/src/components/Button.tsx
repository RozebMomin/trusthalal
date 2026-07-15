import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { radii, space, type Palette } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Variant = "primary" | "accent" | "secondary" | "danger";

function bg(v: Variant, t: Palette, pressed: boolean) {
  if (v === "accent") return pressed ? t.accentDeep : t.accent;
  if (v === "secondary") return t.card;
  if (v === "danger") return t.dangerSoft; // soft red — destructive but not the CTA
  return t.ink; // pressed feedback comes from opacity below
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Feather.glyphMap;
}) {
  const t = useTheme();
  const fg =
    variant === "secondary"
      ? t.ink
      : variant === "danger"
        ? t.danger
        : variant === "accent"
          ? t.onAccent
          : t.onInk;
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
        paddingHorizontal: space.xl,
        alignItems: "center",
        opacity: disabled ? 0.5 : pressed && (variant === "primary" || variant === "danger") ? 0.85 : 1,
        borderWidth: variant === "secondary" || variant === "danger" ? 1 : 0,
        borderColor: variant === "danger" ? t.danger : t.line,
        minHeight: 48,
        justifyContent: "center",
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {icon ? <Feather name={icon} size={18} color={fg} /> : null}
          <Text style={{ color: fg, fontFamily: "Inter_800ExtraBold", fontSize: 16 }}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
