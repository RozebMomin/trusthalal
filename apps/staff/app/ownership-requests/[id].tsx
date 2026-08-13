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
  useApproveOwnershipRequest,
  useOwnershipRequests,
  useRejectOwnershipRequest,
  useRequestOwnershipEvidence,
} from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { OWNERSHIP_OPEN, statusLabel, statusTone } from "@/lib/status";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Action = "approve" | "reject" | "evidence" | null;

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

export default function OwnershipRequestDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const all = useOwnershipRequests();

  const approve = useApproveOwnershipRequest();
  const reject = useRejectOwnershipRequest();
  const evidence = useRequestOwnershipEvidence();

  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");

  if (!authed) return <Redirect href="/login" />;
  if (all.isLoading)
    return <View style={{ flex: 1, backgroundColor: t.bg }}><Loading /></View>;

  const r = all.data?.find((x) => x.id === id);
  if (all.isError || !r)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this request." onRetry={() => void all.refetch()} />
      </View>
    );

  const open = OWNERSHIP_OPEN.includes(r.status);
  const loc = [r.place.address, r.place.city, r.place.region].filter(Boolean).join(", ");
  const busy = approve.isPending || reject.isPending || evidence.isPending;

  async function submit() {
    if (action !== "approve" && !note.trim())
      return Alert.alert("A note is required.");
    try {
      if (action === "approve") {
        await approve.mutateAsync({ id: r.id, payload: { note: note.trim() || null } });
      } else if (action === "reject") {
        await reject.mutateAsync({ id: r.id, payload: { reason: note.trim() } });
      } else if (action === "evidence") {
        await evidence.mutateAsync({ id: r.id, payload: { note: note.trim() } });
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
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>{r.place.name}</Text>
          {loc ? <Muted style={{ marginTop: 2 }}>{loc}</Muted> : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pill label={statusLabel(r.status)} tone={statusTone(r.status)} />
            <Pill label={`filed ${relativeTime(r.created_at)}`} tone="neutral" />
          </View>
        </View>

        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          <InfoLine label="Contact" value={r.contact_name} />
          <InfoLine label="Email" value={r.contact_email} />
          {r.organization ? (
            <InfoLine
              label="Organization"
              value={`${r.organization.name}${r.organization.status ? ` (${statusLabel(r.organization.status)})` : ""}`}
              last
            />
          ) : null}
        </Card>

        {r.message ? (
          <View>
            <SectionLabel>Message</SectionLabel>
            <Card>
              <Body>{r.message}</Body>
            </Card>
          </View>
        ) : null}

        <View>
          <SectionLabel>Evidence ({r.attachments.length})</SectionLabel>
          {r.attachments.length === 0 ? (
            <Card>
              <Muted>None uploaded.</Muted>
            </Card>
          ) : (
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {r.attachments.map((att, i) => (
                <View
                  key={att.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 11,
                    paddingVertical: 12,
                    borderBottomWidth: i === r.attachments.length - 1 ? 0 : 1,
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

        {r.decision_note ? (
          <View>
            <SectionLabel>Admin note</SectionLabel>
            <Card>
              <Body>{r.decision_note}</Body>
            </Card>
          </View>
        ) : null}
      </Screen>

      {open && action === null ? (
        <ActionBar>
          <Button title="Reject" variant="danger" onPress={() => setAction("reject")} />
          <Button title="Evidence" variant="secondary" onPress={() => setAction("evidence")} />
          <Button title="Approve" variant="primary" onPress={() => setAction("approve")} />
        </ActionBar>
      ) : null}

      {action !== null ? (
        <ActionBar>
          <View style={{ flex: 1, gap: space.sm }}>
            <Field
              label={
                action === "approve"
                  ? "Note (optional)"
                  : action === "reject"
                    ? "Reason (shown to owner)"
                    : "What to upload (shown to owner)"
              }
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Add context…"
            />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <Button title="Cancel" variant="secondary" onPress={() => { setAction(null); setNote(""); }} style={{ flex: 1 }} />
              <Button
                title={action === "approve" ? "Approve" : action === "reject" ? "Reject" : "Request"}
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
