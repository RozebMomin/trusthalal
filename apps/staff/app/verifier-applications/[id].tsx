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
import { useDecideVerifierApplication, useVerifierApplications } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { statusLabel, statusTone } from "@/lib/status";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Action = "approve" | "reject" | null;

export default function VerifierApplicationDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const all = useVerifierApplications("ALL");
  const decide = useDecideVerifierApplication();

  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");

  if (!authed) return <Redirect href="/login" />;
  if (all.isLoading)
    return <View style={{ flex: 1, backgroundColor: t.bg }}><Loading /></View>;

  const a = all.data?.find((x) => x.id === id);
  if (all.isError || !a)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this application." onRetry={() => void all.refetch()} />
      </View>
    );

  const pending = a.status === "PENDING";
  const socials = a.social_links
    ? Object.entries(a.social_links).filter(([, v]) => Boolean(v))
    : [];

  async function submit() {
    if (action === "reject" && !note.trim())
      return Alert.alert("A note is required to reject.");
    try {
      await decide.mutateAsync({
        id: a.id,
        payload: {
          decision: action === "approve" ? "APPROVED" : "REJECTED",
          decision_note: note.trim() || null,
        },
      });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't submit", err instanceof Error ? err.message : "Try again.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen contentStyle={{ paddingTop: space.md }}>
        <View>
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>{a.applicant_name}</Text>
          <Muted style={{ marginTop: 2 }}>{a.applicant_email}</Muted>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pill label={statusLabel(a.status)} tone={statusTone(a.status)} />
            <Pill label={`applied ${relativeTime(a.submitted_at)}`} tone="neutral" />
          </View>
        </View>

        <View>
          <SectionLabel>Motivation</SectionLabel>
          <Card>
            <Body>{a.motivation}</Body>
          </Card>
        </View>

        {a.background ? (
          <View>
            <SectionLabel>Background</SectionLabel>
            <Card>
              <Body>{a.background}</Body>
            </Card>
          </View>
        ) : null}

        {socials.length > 0 ? (
          <View>
            <SectionLabel>Social</SectionLabel>
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {socials.map(([k, v], i) => (
                <View
                  key={k}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: 11,
                    borderBottomWidth: i === socials.length - 1 ? 0 : 1,
                    borderBottomColor: t.line,
                  }}
                >
                  <Text style={{ ...ty.body, color: t.sub }}>{k}</Text>
                  <Text style={{ ...ty.body, fontWeight: "600", color: t.ink }}>{String(v)}</Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {a.decision_note ? (
          <View>
            <SectionLabel>Decision note</SectionLabel>
            <Card>
              <Body>{a.decision_note}</Body>
            </Card>
          </View>
        ) : null}
      </Screen>

      {pending && action === null ? (
        <ActionBar>
          <Button title="Reject" variant="danger" onPress={() => setAction("reject")} />
          <Button title="Approve" variant="primary" onPress={() => setAction("approve")} />
        </ActionBar>
      ) : null}

      {action !== null ? (
        <ActionBar>
          <View style={{ flex: 1, gap: space.sm }}>
            <Field
              label={action === "approve" ? "Note (optional)" : "Reason (shown to applicant)"}
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Add context…"
            />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <Button title="Cancel" variant="secondary" onPress={() => { setAction(null); setNote(""); }} style={{ flex: 1 }} />
              <Button
                title={action === "approve" ? "Approve" : "Reject"}
                variant={action === "reject" ? "danger" : "primary"}
                loading={decide.isPending}
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
