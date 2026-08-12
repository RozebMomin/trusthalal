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

export function Screen({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pad = {
    paddingHorizontal: space.lg,
    paddingBottom: insets.bottom + space.xl,
  };
  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, ...pad, paddingTop: space.md }}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ ...pad, paddingTop: space.md, gap: space.md }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.card,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: t.line,
        padding: space.lg,
        gap: space.sm,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[ty.title, { color: t.ink }]}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[ty.small, { color: t.sub }, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: React.ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[ty.body, { color: t.ink }, style]}>{children}</Text>;
}

type ButtonVariant = "primary" | "secondary" | "danger";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const bg =
    variant === "primary" ? t.accent : variant === "danger" ? t.danger : t.card;
  const fg =
    variant === "secondary" ? t.ink : variant === "primary" ? t.onAccent : "#FFFFFF";
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={{
        backgroundColor: bg,
        opacity: isDisabled ? 0.5 : 1,
        borderRadius: radii.md,
        borderWidth: variant === "secondary" ? 1 : 0,
        borderColor: t.line,
        paddingVertical: 13,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[ty.label, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[ty.small, { color: t.sub }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.sub}
        style={{
          backgroundColor: t.card,
          borderRadius: radii.md,
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

type Tone = "neutral" | "amber" | "green" | "danger" | "info";

export function Pill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const t = useTheme();
  const map: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: t.zincSoft, fg: t.zinc },
    amber: { bg: t.amberSoft, fg: t.amber },
    green: { bg: t.accentSoft, fg: t.accentDeep },
    danger: { bg: t.dangerSoft, fg: t.danger },
    info: { bg: t.infoSoft, fg: t.info },
  };
  const c = map[tone];
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: c.bg,
        borderRadius: radii.pill,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      <Text style={{ ...ty.seg, color: c.fg }}>{label}</Text>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: t.card,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: t.line,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[ty.label, { color: t.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[ty.small, { color: t.sub }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      <Feather name="chevron-right" size={18} color={t.sub} />
    </Pressable>
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
      <Text style={[ty.body, { color: t.ink, textAlign: "center" }]}>{message}</Text>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View style={{ padding: space.xxl, alignItems: "center" }}>
      <Feather name="inbox" size={22} color={t.sub} />
      <Text style={[ty.small, { color: t.sub, marginTop: space.sm }]}>{message}</Text>
    </View>
  );
}
