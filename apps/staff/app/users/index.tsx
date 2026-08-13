import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Card, EmptyState, ErrorState, Loading, Muted, Pill, Screen } from "@/components/ui";
import { useUsers } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { statusLabel } from "@/lib/status";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export function roleTone(role: string) {
  if (role === "ADMIN") return "info" as const;
  if (role === "VERIFIER") return "green" as const;
  if (role === "OWNER") return "amber" as const;
  return "neutral" as const;
}

export default function UsersList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const [q, setQ] = useState("");
  const users = useUsers();

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = users.data ?? [];
    if (!term) return all;
    return all.filter(
      (u) =>
        u.email.toLowerCase().includes(term) ||
        (u.display_name ?? "").toLowerCase().includes(term),
    );
  }, [users.data, q]);

  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: t.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.line,
          paddingHorizontal: space.md,
        }}
      >
        <Feather name="search" size={18} color={t.sub} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by name or email"
          placeholderTextColor={t.sub}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, paddingVertical: 12, color: t.ink, ...ty.body }}
        />
      </View>

      {users.isLoading ? (
        <Loading />
      ) : users.isError ? (
        <ErrorState message="Couldn't load users." onRetry={() => void users.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="No users found." />
      ) : (
        rows.map((u) => (
          <Pressable key={u.id} onPress={() => router.push(`/users/${u.id}` as never)}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <Text style={{ ...ty.label, color: t.ink, flex: 1 }} numberOfLines={1}>
                  {u.display_name ?? u.email}
                </Text>
                <Pill label={u.role.toLowerCase()} tone={roleTone(u.role)} />
              </View>
              <Muted style={{ marginTop: 3 }}>{u.email}</Muted>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <Pill label={u.is_active ? "active" : "inactive"} tone={u.is_active ? "green" : "danger"} />
                <Pill label={statusLabel(u.account_state)} tone="neutral" />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
