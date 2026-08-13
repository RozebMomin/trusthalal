import { Feather } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { Button, Card, H1, Muted, Screen, SectionLabel } from "@/components/ui";
import { useAuth } from "@/lib/auth/auth-store";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 11,
      }}
    >
      <Text style={{ ...ty.body, color: t.sub }}>{label}</Text>
      <Text style={{ ...ty.body, fontWeight: "600", color: t.ink }}>{value}</Text>
    </View>
  );
}

export default function Me() {
  const t = useTheme();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <H1>Me</H1>

      <SectionLabel>Account</SectionLabel>
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        <Row label="Email" value={user?.email ?? "—"} />
        <View style={{ height: 1, backgroundColor: t.line }} />
        <Row label="Name" value={user?.display_name ?? "—"} />
        <View style={{ height: 1, backgroundColor: t.line }} />
        <Row label="Role" value={user?.role ?? "—"} />
      </Card>

      <View style={{ marginTop: space.md }}>
        <Pressable
          onPress={() => void logout()}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.sm,
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: 12,
            paddingVertical: 14,
          }}
        >
          <Feather name="log-out" size={16} color={t.danger} />
          <Text style={{ ...ty.label, fontWeight: "700", color: t.danger }}>Sign out</Text>
        </Pressable>
      </View>

      <Muted style={{ textAlign: "center", marginTop: space.md }}>
        Trust Halal Staff
      </Muted>
    </Screen>
  );
}
