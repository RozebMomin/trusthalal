/**
 * UI kit — one primitive per mockup CSS class, so a screen built here
 * reads like the mockup HTML. Source of truth:
 * docs/2026-07-06-mobile-app-mockups.html (repo root).
 *
 *   .tag → <Tag>          .chip → <Chip>       .card → <Card>
 *   .search → <SearchBar> .glassbtn → <GlassBtn> .seg → <Seg>
 *   .cell → <Cell>        .icbox → <IcBox>     .steps → <Steps>
 *   .btn → components/Button (existing)
 *
 * Pure presentation: no hooks, no API imports. Screens pass fixtures
 * now, live data later — that swap must never change these files.
 */
import { Feather } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { radii, space, type as ty, type Palette } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

/** .tag — v2 tier/status tag. tone: solid|wash|amber|zinc|danger|dashed|glass */
export function Tag({
  label,
  tone = "zinc",
  mini = false,
}: {
  label: string;
  tone?: "solid" | "wash" | "amber" | "zinc" | "danger" | "dashed" | "glass";
  /** Illustration-scale tag (~6.5px) — decoration inside mini cards,
   *  not a readable label. Matches the mockup-28 graphic. */
  mini?: boolean;
}) {
  const t = useTheme();
  const map: Record<string, { bg: string; fg: string; dashed?: boolean }> = {
    solid: { bg: t.accent, fg: "#fff" },
    wash: { bg: t.accentSoft, fg: t.accentDeep },
    amber: { bg: t.amberSoft, fg: t.amber },
    zinc: { bg: t.zincSoft, fg: t.zinc },
    danger: { bg: t.dangerSoft, fg: t.danger },
    dashed: { bg: "transparent", fg: t.sub, dashed: true },
    glass: { bg: "rgba(255,255,255,0.92)", fg: "#0B0B0E" },
  };
  const s = map[tone];
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: s.bg,
        borderRadius: mini ? 5 : 8,
        paddingHorizontal: mini ? 5 : 8,
        paddingVertical: mini ? 2 : 3.5,
        borderWidth: s.dashed ? 1 : 0,
        borderColor: t.line,
        borderStyle: s.dashed ? "dashed" : "solid",
      }}
    >
      <Text style={{ color: s.fg, fontFamily: "Inter_700Bold", fontSize: mini ? 6.5 : 9.5, letterSpacing: 0.3 }}>
        {label}
      </Text>
    </View>
  );
}

/** .chip — pill filter/selector. ghost = outlined variant. */
export function Chip({
  label,
  on,
  ghost,
  icon,
  onPress,
}: {
  label: string;
  on?: boolean;
  ghost?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: on ? t.ink : ghost ? "transparent" : t.card,
        borderWidth: ghost && !on ? 1 : 0,
        borderColor: t.line,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 8,
        minHeight: 34,
        shadowColor: "#000",
        shadowOpacity: ghost || on ? 0 : 0.04,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      }}
    >
      {icon ? <Feather name={icon} size={12} color={on ? "#fff" : t.ink} /> : null}
      <Text style={{ color: on ? "#fff" : t.ink, fontFamily: "Inter_600SemiBold", fontSize: 11.5 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** .card — white floating surface. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.card,
          borderRadius: radii.xl,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.05,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** .search — big rounded search field shell (screens own the TextInput). */
export function SearchShell({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        backgroundColor: t.card,
        borderRadius: 18,
        paddingHorizontal: 14,
        minHeight: 48,
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      }}
    >
      {children}
    </View>
  );
}

/** .glassbtn — circular glass control (over photos / headers). */
export function GlassBtn({
  icon,
  label,
  onPress,
  tint,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress?: () => void;
  tint?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 36,
        height: 36,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.92)",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
      }}
    >
      <Feather name={icon} size={17} color={tint ?? "#0B0B0E"} />
    </Pressable>
  );
}

/** .seg — tracked uppercase section label. */
export function Seg({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <Text style={[ty.seg, { color: t.sub }, style as object]}>{children}</Text>;
}

/** .cell — settings/list row inside a Card. */
export function Cell({
  left,
  right,
  onPress,
  last,
}: {
  left: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.sm,
        paddingVertical: 13,
        paddingHorizontal: space.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.line,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, flex: 1 }}>{left}</View>
      {right}
    </Pressable>
  );
}

/** .icbox — rounded icon square used in rows. */
export function IcBox({
  icon,
  bg,
  fg,
}: {
  icon: keyof typeof Feather.glyphMap;
  bg: string;
  fg: string;
}) {
  return (
    <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Feather name={icon} size={16} color={fg} />
    </View>
  );
}

/** .steps — thin progress bar segments for multi-step flows. */
export function Steps({ total, done }: { total: number; done: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={{ flex: 1, height: 3, borderRadius: 999, backgroundColor: i < done ? t.accent : t.line }} />
      ))}
    </View>
  );
}

export function toneFor(t: Palette) {
  return t;
}

// ---------------------------------------------------------------------------
// Sheet — bottom-sheet container that animates CORRECTLY: the scrim
// fades in place while the panel slides. RN Modal's animationType
// "slide" moves the whole subtree (scrim included), which reads as a
// black slab riding up and down with the sheet.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from "react";
import { Animated, Modal } from "react-native";

export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 190, useNativeDriver: true }).start(() =>
        setMounted(false),
      );
    }
  }, [visible, anim]);

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(9,9,11,0.5)", opacity: anim }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "88%",
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [640, 0] }) },
          ],
        }}
      >
        <View
          style={{
            backgroundColor: t.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: space.lg,
            paddingBottom: 34,
          }}
        >
          <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 4, backgroundColor: t.line, marginVertical: 12 }} />
          {children}
        </View>
      </Animated.View>
    </Modal>
  );
}
