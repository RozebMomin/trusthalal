import { ActivityIndicator, Text, View } from "react-native";
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
}: {
  title: string;
  body: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ padding: space.xxl, alignItems: "center", gap: space.sm }}>
      <Text style={[ty.h2, { color: t.ink, textAlign: "center" }]}>{title}</Text>
      <Text style={[ty.body, { color: t.sub, textAlign: "center" }]}>{body}</Text>
      {actionTitle && onAction ? (
        <View style={{ marginTop: space.sm, alignSelf: "stretch" }}>
          <Button title={actionTitle} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
