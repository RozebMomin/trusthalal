import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import {
  ActionBar,
  Button,
  Card,
  ErrorState,
  Loading,
  Muted,
  Screen,
  SectionLabel,
} from "@/components/ui";
import { usePatchUser, useUsers } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import type { UserRole } from "@/lib/api/types";
import { statusLabel } from "@/lib/status";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

const ROLES: UserRole[] = ["CONSUMER", "OWNER", "VERIFIER", "ADMIN"];

function InfoLine({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: space.md,
        paddingVertical: 11,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.line,
      }}
    >
      <Text style={{ ...ty.body, color: t.sub }}>{label}</Text>
      <Text style={{ ...ty.body, fontWeight: "600", color: t.ink, flexShrink: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}

export default function UserDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const users = useUsers();
  const patch = usePatchUser();

  const [role, setRole] = useState<UserRole | null>(null);
  const [active, setActive] = useState<boolean | null>(null);

  if (!authed) return <Redirect href="/login" />;
  if (users.isLoading)
    return <View style={{ flex: 1, backgroundColor: t.bg }}><Loading /></View>;

  const u = users.data?.find((x) => x.id === id);
  if (users.isError || !u)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this user." onRetry={() => void users.refetch()} />
      </View>
    );

  const curRole = role ?? u.role;
  const curActive = active ?? u.is_active;
  const dirty = curRole !== u.role || curActive !== u.is_active;

  const save = async () => {
    try {
      await patch.mutateAsync({ id: u.id, payload: { role: curRole, is_active: curActive } });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Try again.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen contentStyle={{ paddingTop: space.md }}>
        <View>
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>{u.display_name ?? u.email}</Text>
          <Muted style={{ marginTop: 2 }}>{u.email}</Muted>
        </View>

        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          <InfoLine label="Account" value={statusLabel(u.account_state)} />
          <InfoLine label="Email verified" value={u.email_verified_at ? "Yes" : "No"} last />
        </Card>

        <View>
          <SectionLabel>Role</SectionLabel>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {ROLES.map((r) => {
              const on = curRole === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: 9,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: on ? t.accent : t.line,
                    backgroundColor: on ? t.accentSoft : t.card,
                  }}
                >
                  <Text style={{ ...ty.label, color: on ? t.accentDeep : t.sub }}>{r.toLowerCase()}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View>
          <SectionLabel>Access</SectionLabel>
          <Pressable
            onPress={() => setActive(!curActive)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: t.card,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 12,
              paddingHorizontal: space.lg,
              paddingVertical: 14,
            }}
          >
            <Text style={{ ...ty.body, color: t.ink }}>Account active</Text>
            <View
              style={{
                width: 46,
                height: 28,
                borderRadius: 999,
                backgroundColor: curActive ? t.accent : t.line,
                padding: 3,
                alignItems: curActive ? "flex-end" : "flex-start",
              }}
            >
              <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: "#fff" }} />
            </View>
          </Pressable>
        </View>
      </Screen>

      {dirty ? (
        <ActionBar>
          <Button title="Save changes" variant="primary" loading={patch.isPending} onPress={save} />
        </ActionBar>
      ) : null}
    </View>
  );
}
