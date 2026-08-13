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
  useDispute,
  useRequestOwnerReconciliation,
  useResolveDispute,
} from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { statusLabel, statusTone } from "@/lib/status";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { DISPUTE_ATTR } from "./index";

type Action = "uphold" | "dismiss" | "reconcile" | null;
const DECIDABLE = ["OPEN", "ADMIN_REVIEWING"];

export default function DisputeDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useDispute(id);
  const resolve = useResolveDispute();
  const reconcile = useRequestOwnerReconciliation();

  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");

  if (!authed) return <Redirect href="/login" />;
  if (q.isLoading)
    return <View style={{ flex: 1, backgroundColor: t.bg }}><Loading /></View>;
  if (q.isError || !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this dispute." onRetry={() => void q.refetch()} />
      </View>
    );

  const d = q.data;
  const decidable = DECIDABLE.includes(d.status);
  const busy = resolve.isPending || reconcile.isPending;

  async function submit() {
    if (action === "dismiss" && !note.trim())
      return Alert.alert("A note is required to dismiss.");
    try {
      if (action === "uphold") {
        await resolve.mutateAsync({ id: d.id, payload: { decision: "RESOLVED_UPHELD", admin_decision_note: note.trim() || null } });
      } else if (action === "dismiss") {
        await resolve.mutateAsync({ id: d.id, payload: { decision: "RESOLVED_DISMISSED", admin_decision_note: note.trim() } });
      } else if (action === "reconcile") {
        await reconcile.mutateAsync({ id: d.id, note: note.trim() || null });
      }
      router.back();
    } catch (err) {
      Alert.alert("Couldn't submit", err instanceof Error ? err.message : "Try again.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen contentStyle={{ paddingTop: space.md }}>
        <View>
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>
            {DISPUTE_ATTR[d.disputed_attribute] ?? d.disputed_attribute}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pill label={statusLabel(d.status)} tone={statusTone(d.status)} />
            <Pill label={`filed ${relativeTime(d.submitted_at)}`} tone="neutral" />
          </View>
        </View>

        <View>
          <SectionLabel>What the diner reported</SectionLabel>
          <Card>
            <Body>{d.description}</Body>
          </Card>
        </View>

        <View>
          <SectionLabel>Evidence ({d.attachments.length})</SectionLabel>
          {d.attachments.length === 0 ? (
            <Card>
              <Muted>None attached.</Muted>
            </Card>
          ) : (
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {d.attachments.map((att, i) => (
                <View
                  key={att.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 11,
                    paddingVertical: 12,
                    borderBottomWidth: i === d.attachments.length - 1 ? 0 : 1,
                    borderBottomColor: t.line,
                  }}
                >
                  <IconTile icon="paperclip" tone="neutral" />
                  <Text style={{ ...ty.body, fontWeight: "600", color: t.ink, flex: 1 }} numberOfLines={1}>
                    {att.original_filename}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </View>

        {d.admin_decision_note ? (
          <View>
            <SectionLabel>Admin note</SectionLabel>
            <Card>
              <Body>{d.admin_decision_note}</Body>
            </Card>
          </View>
        ) : null}
      </Screen>

      {decidable && action === null ? (
        <ActionBar>
          <Button title="Dismiss" variant="danger" onPress={() => setAction("dismiss")} />
          <Button title="Reconcile" variant="secondary" onPress={() => setAction("reconcile")} />
          <Button title="Uphold" variant="primary" onPress={() => setAction("uphold")} />
        </ActionBar>
      ) : null}

      {action !== null ? (
        <ActionBar>
          <View style={{ flex: 1, gap: space.sm }}>
            <Field
              label={
                action === "dismiss"
                  ? "Reason (shown to the diner)"
                  : action === "reconcile"
                    ? "Note to the owner (optional)"
                    : "Note (optional)"
              }
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Add context…"
            />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <Button title="Cancel" variant="secondary" onPress={() => { setAction(null); setNote(""); }} style={{ flex: 1 }} />
              <Button
                title={action === "uphold" ? "Uphold" : action === "dismiss" ? "Dismiss" : "Request"}
                variant={action === "dismiss" ? "danger" : "primary"}
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
