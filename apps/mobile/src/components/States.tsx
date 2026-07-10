import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "./Button";

/** Empty / loading / error — every screen renders all states explicitly. */
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
    <View style={{ padding: space.xl, alignItems: "center", gap: space.md }}>
      <Text style={[ty.label, { color: t.ink }]}>Something went wrong</Text>
      <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>{message}</Text>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionTitle,
  onAction,
  secondaryActions,
  footerLink,
}: {
  title: string;
  body: string;
  actionTitle?: string;
  onAction?: () => void;
  /** Mockup-18 recovery row: e.g. Change city · Clear filters. */
  secondaryActions?: Array<{ title: string; onPress: () => void }>;
  /** Accent link under everything: "Know a halal spot here? …" */
  footerLink?: { title: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={{ padding: space.xxl, alignItems: "center", gap: space.sm }}>
      <View style={{ width: 76, height: 76, borderRadius: 26, backgroundColor: t.card, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3, marginBottom: space.sm }}>
        <Text style={{ fontSize: 28 }}>🔍</Text>
      </View>
      <Text style={[ty.h2, { color: t.ink, textAlign: "center" }]}>{title}</Text>
      <Text style={[ty.body, { color: t.sub, textAlign: "center" }]}>{body}</Text>
      {actionTitle && onAction ? (
        <View style={{ marginTop: space.sm, alignSelf: "stretch" }}>
          <Button title={actionTitle} onPress={onAction} />
        </View>
      ) : null}
      {secondaryActions && secondaryActions.length > 0 ? (
        <View style={{ flexDirection: "row", gap: space.sm, alignSelf: "stretch", marginTop: space.xs }}>
          {secondaryActions.map((a) => (
            <View key={a.title} style={{ flex: 1 }}>
              <Button title={a.title} variant="secondary" onPress={a.onPress} />
            </View>
          ))}
        </View>
      ) : null}
      {footerLink ? (
        <Pressable onPress={footerLink.onPress} accessibilityRole="link" style={{ marginTop: space.md }}>
          <Text style={[ty.small, { color: t.accentDeep, fontFamily: "Inter_600SemiBold" }]}>
            {footerLink.title} →
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
