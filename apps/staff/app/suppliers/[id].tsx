import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import {
  ActionBar,
  Body,
  Button,
  Card,
  ErrorState,
  Field,
  Loading,
  Muted,
  Pill,
  Screen,
  SectionLabel,
} from "@/components/ui";
import { useRestoreSupplier, useRevokeSupplier, useSupplier } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { statusLabel } from "@/lib/status";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { tierTone } from "./index";

const SLAUGHTER: Record<string, string> = {
  HAND_CUT: "Hand-cut",
  MACHINE_CUT: "Machine-cut",
  NOT_SERVED: "Not served",
  NOT_DISCLOSED: "Not disclosed",
};

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

export default function SupplierDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useSupplier(id);
  const revoke = useRevokeSupplier();
  const restore = useRestoreSupplier();

  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");

  if (!authed) return <Redirect href="/login" />;
  if (q.isLoading)
    return <View style={{ flex: 1, backgroundColor: t.bg }}><Loading /></View>;
  if (q.isError || !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this supplier." onRetry={() => void q.refetch()} />
      </View>
    );

  const s = q.data;
  const isRevoked = Boolean(s.revoked_at);
  const loc = [s.city, s.region, s.country_code].filter(Boolean).join(", ");

  async function doRevoke() {
    try {
      await revoke.mutateAsync({ id: s.id, reason: reason.trim() || null });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't revoke", err instanceof Error ? err.message : "Try again.");
    }
  }
  async function doRestore() {
    try {
      await restore.mutateAsync(s.id);
      router.back();
    } catch (err) {
      Alert.alert("Couldn't restore", err instanceof Error ? err.message : "Try again.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen contentStyle={{ paddingTop: space.md }}>
        <View>
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>{s.name}</Text>
          {loc ? <Muted style={{ marginTop: 2 }}>{loc}</Muted> : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pill label={statusLabel(s.verification_tier)} tone={tierTone(s.verification_tier)} />
            {isRevoked ? <Pill label="revoked" tone="danger" /> : null}
          </View>
        </View>

        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          {s.certifying_body_name ? <InfoLine label="Certifier" value={s.certifying_body_name} /> : null}
          {s.website_url ? <InfoLine label="Website" value={s.website_url} /> : null}
          {s.aliases.length > 0 ? <InfoLine label="Also known as" value={s.aliases.join(", ")} last /> : null}
        </Card>

        {s.notes ? (
          <View>
            <SectionLabel>Notes</SectionLabel>
            <Card>
              <Body>{s.notes}</Body>
            </Card>
          </View>
        ) : null}

        <View>
          <SectionLabel>Products ({s.products.length})</SectionLabel>
          {s.products.length === 0 ? (
            <Card>
              <Muted>No product lines.</Muted>
            </Card>
          ) : (
            <Card>
              {s.products.map((p, i) => (
                <View key={p.id}>
                  {i > 0 ? <View style={{ height: 1, backgroundColor: t.line, marginVertical: 11 }} /> : null}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.label, color: t.ink }}>{p.product_name}</Text>
                      <Muted style={{ marginTop: 2 }}>
                        {p.meat_type.toLowerCase()} · {SLAUGHTER[p.slaughter_method] ?? p.slaughter_method}
                        {p.certifying_body_name ? ` · ${p.certifying_body_name}` : ""}
                      </Muted>
                    </View>
                    <Pill label={statusLabel(p.line_tier)} tone={tierTone(p.line_tier)} />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </View>
      </Screen>

      {isRevoked ? (
        <ActionBar>
          <Button title="Restore supplier" variant="primary" loading={restore.isPending} onPress={doRestore} />
        </ActionBar>
      ) : revoking ? (
        <ActionBar>
          <View style={{ flex: 1, gap: space.sm }}>
            <Field label="Reason (optional)" value={reason} onChangeText={setReason} multiline placeholder="Why revoke…" />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <Button title="Cancel" variant="secondary" onPress={() => { setRevoking(false); setReason(""); }} style={{ flex: 1 }} />
              <Button title="Revoke" variant="danger" loading={revoke.isPending} onPress={doRevoke} style={{ flex: 2 }} />
            </View>
          </View>
        </ActionBar>
      ) : (
        <ActionBar>
          <Button title="Revoke supplier" variant="danger" onPress={() => setRevoking(true)} />
        </ActionBar>
      )}
    </View>
  );
}
