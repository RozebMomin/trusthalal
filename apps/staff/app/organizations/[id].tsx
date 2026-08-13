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
  IconTile,
  Loading,
  Muted,
  Pill,
  Screen,
  SectionLabel,
} from "@/components/ui";
import {
  useOrganization,
  useRejectOrganization,
  useVerifyOrganization,
} from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { statusLabel, statusTone } from "@/lib/status";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Action = "verify" | "reject" | null;

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

export default function OrganizationDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useOrganization(id);
  const verify = useVerifyOrganization();
  const reject = useRejectOrganization();

  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");

  if (!authed) return <Redirect href="/login" />;
  if (q.isLoading)
    return <View style={{ flex: 1, backgroundColor: t.bg }}><Loading /></View>;
  if (q.isError || !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this organization." onRetry={() => void q.refetch()} />
      </View>
    );

  const o = q.data;
  const decidable = o.status === "UNDER_REVIEW";
  const loc = [o.address, o.city, o.region, o.postal_code].filter(Boolean).join(", ");
  const busy = verify.isPending || reject.isPending;

  async function submit() {
    if (!note.trim())
      return Alert.alert(action === "verify" ? "A note is required." : "A reason is required.");
    try {
      if (action === "verify") await verify.mutateAsync({ id: o.id, note: note.trim() });
      else await reject.mutateAsync({ id: o.id, reason: note.trim() });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't submit", err instanceof Error ? err.message : "Try again.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen contentStyle={{ paddingTop: space.md }}>
        <View>
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>{o.name}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pill label={statusLabel(o.status)} tone={statusTone(o.status)} />
          </View>
        </View>

        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          {o.contact_email ? <InfoLine label="Contact" value={o.contact_email} /> : null}
          {loc ? <InfoLine label="Address" value={loc} /> : null}
          {o.country_code ? <InfoLine label="Country" value={o.country_code} last /> : null}
        </Card>

        <View>
          <SectionLabel>Documents ({o.attachments.length})</SectionLabel>
          {o.attachments.length === 0 ? (
            <Card>
              <Muted>None uploaded.</Muted>
            </Card>
          ) : (
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {o.attachments.map((att, i) => (
                <View
                  key={att.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 11,
                    paddingVertical: 12,
                    borderBottomWidth: i === o.attachments.length - 1 ? 0 : 1,
                    borderBottomColor: t.line,
                  }}
                >
                  <IconTile icon="file-text" tone="neutral" />
                  <Text style={{ ...ty.body, fontWeight: "600", color: t.ink, flex: 1 }} numberOfLines={1}>
                    {att.original_filename}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </View>

        {o.decision_note ? (
          <View>
            <SectionLabel>Decision note</SectionLabel>
            <Card>
              <Body>{o.decision_note}</Body>
            </Card>
          </View>
        ) : null}
      </Screen>

      {decidable && action === null ? (
        <ActionBar>
          <Button title="Reject" variant="danger" onPress={() => setAction("reject")} />
          <Button title="Verify" variant="primary" onPress={() => setAction("verify")} />
        </ActionBar>
      ) : null}

      {action !== null ? (
        <ActionBar>
          <View style={{ flex: 1, gap: space.sm }}>
            <Field
              label={action === "verify" ? "Verification note" : "Reason (shown to owner)"}
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Add context…"
            />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <Button title="Cancel" variant="secondary" onPress={() => { setAction(null); setNote(""); }} style={{ flex: 1 }} />
              <Button
                title={action === "verify" ? "Verify" : "Reject"}
                variant={action === "reject" ? "danger" : "primary"}
                loading={busy}
                onPress={submit}
                style={{ flex: 2 }}
              />
            </View>
          </View>
        </ActionBar>
      ) : null}
    </View>
  );
}
