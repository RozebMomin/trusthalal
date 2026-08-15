import { Feather } from "@expo/vector-icons";
import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import type { Palette } from "@/lib/theme";

export function Screen({
  children,
  scroll = true,
  topInset = false,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  /** Add the top safe-area inset. Use on screens with no native header
   *  (e.g. the tab screens) so content clears the status bar / notch. */
  topInset?: boolean;
  contentStyle?: object;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const top = (topInset ? insets.top : 0) + space.md;
  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: topInset ? insets.top : 0 }}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        paddingHorizontal: 18,
        paddingBottom: insets.bottom + space.xl,
        gap: space.md,
        ...contentStyle,
        paddingTop: top,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: object;
  padded?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: t.line,
        overflow: "hidden",
        ...(padded ? { padding: space.lg } : {}),
        ...style,
      }}
    >
      {children}
    </View>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text style={{ ...ty.title, fontSize: 30, color: t.ink }}>{children}</Text>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={{
        ...ty.seg,
        color: t.sub,
        marginLeft: 4,
        marginBottom: space.sm,
        marginTop: space.xs,
      }}
    >
      {children}
    </Text>
  );
}

export function Muted({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: object;
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[ty.small, { color: t.sub }, style]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: object;
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[ty.body, { color: t.ink }, style]}>
      {children}
    </Text>
  );
}

type Tone = "neutral" | "amber" | "info" | "green" | "danger" | "slate";

function toneColors(t: Palette, tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case "amber":
      return { bg: t.amberSoft, fg: t.amber };
    case "info":
      return { bg: t.infoSoft, fg: t.info };
    case "green":
      return { bg: t.accentSoft, fg: t.accentDeep };
    case "danger":
      return { bg: t.dangerSoft, fg: t.danger };
    case "slate":
      return { bg: t.slate, fg: t.onSlate };
    default:
      return { bg: t.card2, fg: t.sub };
  }
}

export function IconTile({
  icon,
  tone = "neutral",
}: {
  icon: keyof typeof Feather.glyphMap;
  tone?: Tone;
}) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View
      style={{
        width: 38,
        height: 38,
        borderRadius: 11,
        backgroundColor: c.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Feather name={icon} size={18} color={c.fg} />
    </View>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: c.bg,
        borderRadius: radii.pill,
        paddingHorizontal: 9,
        paddingVertical: 4,
      }}
    >
      <Text style={{ ...ty.seg, color: c.fg }}>{label}</Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: t.card2,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: t.line,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 7,
              borderRadius: 8,
              backgroundColor: active ? t.card : "transparent",
            }}
          >
            <Text style={{ ...ty.label, color: active ? t.ink : t.sub }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A row inside a grouped Card: icon tile + label + optional count + chevron. */
export function QueueRow({
  icon,
  tone,
  label,
  count,
  countTone = "amber",
  last = false,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  tone?: Tone;
  label: string;
  count?: number;
  countTone?: Tone;
  last?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 13,
        paddingHorizontal: 14,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.line,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <IconTile icon={icon} tone={tone} />
      <Text style={{ ...ty.body, fontWeight: "600", color: t.ink, flex: 1 }}>
        {label}
      </Text>
      {count !== undefined && count > 0 ? (
        <Pill label={String(count)} tone={countTone} />
      ) : null}
      {disabled ? (
        <Pill label="Soon" tone="neutral" />
      ) : (
        <Feather name="chevron-right" size={18} color={t.sub} />
      )}
    </Pressable>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: object;
}) {
  const t = useTheme();
  const bg =
    variant === "primary" ? t.accent : variant === "danger" ? "transparent" : "transparent";
  const fg =
    variant === "primary" ? t.onAccent : variant === "danger" ? t.danger : t.ink;
  const border =
    variant === "primary" ? "transparent" : variant === "danger" ? t.danger : t.line;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={{
        backgroundColor: bg,
        opacity: isDisabled ? 0.5 : 1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 13,
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ ...ty.label, fontWeight: "700", color: fg }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...ty.seg, color: t.sub }}>{label}</Text>
      <TextInput
        placeholderTextColor={t.sub}
        style={{
          backgroundColor: t.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.line,
          paddingHorizontal: space.md,
          paddingVertical: 12,
          color: t.ink,
          ...ty.body,
        }}
        {...props}
      />
    </View>
  );
}

/** Sticky bottom bar for primary actions (sits outside the scroll view). */
export function ActionBar({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 9,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: insets.bottom + 12,
        borderTopWidth: 1,
        borderTopColor: t.line,
        backgroundColor: t.card,
      }}
    >
      {children}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ padding: space.xxl, alignItems: "center" }}>
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ padding: space.xl, gap: space.md, alignItems: "center" }}>
      <Feather name="alert-triangle" size={22} color={t.danger} />
      <Text style={{ ...ty.body, color: t.ink, textAlign: "center" }}>{message}</Text>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View style={{ padding: space.xxl, alignItems: "center" }}>
      <Feather name="inbox" size={22} color={t.sub} />
      <Text style={{ ...ty.small, color: t.sub, marginTop: space.sm }}>{message}</Text>
    </View>
  );
}
