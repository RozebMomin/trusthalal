import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

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
import { useResolveReviewReport, useReviewReport } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import type { ModerationAction } from "@/lib/api/types";

type Action = "uphold" | "dismiss" | null;
const MOD_OPTIONS: { value: ModerationAction; label: string }[] = [
  { value: "NONE", label: "Keep up" },
  { value: "HIDE", label: "Hide" },
  { value: "REMOVE", label: "Remove" },
];

export default function ReportedReviewDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useReviewReport(id);
  const resolve = useResolveReviewReport();

  const [action, setAction] = useState<Action>(null);
  const [mod, setMod] = useState<ModerationAction>("REMOVE");
  const [note, setNote] = useState("");

  if (!authed) return <Redirect href="/login" />;
  if (q.isLoading)
    return <View style={{ flex: 1, backgroundColor: t.bg }}><Loading /></View>;
  if (q.isError || !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this report." onRetry={() => void q.refetch()} />
      </View>
    );

  const { review, reports } = q.data;
  const openReports = reports.filter((rp) => rp.status === "OPEN");
  const stars = "★".repeat(Math.max(0, Math.min(5, review.rating)));

  async function submit() {
    try {
      await resolve.mutateAsync({
        reviewId: review.id,
        payload: {
          decision: action === "uphold" ? "UPHELD" : "DISMISSED",
          action: action === "uphold" ? mod : "NONE",
          resolution_note: note.trim() || null,
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
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>{review.place_name ?? "Review"}</Text>
          <Muted style={{ marginTop: 2 }}>
            {review.author.display_name ?? "Anonymous"} · {stars} · {statusLabel(review.status)}
          </Muted>
          <Muted style={{ marginTop: 2 }}>
            {review.author_review_count} reviews
            {review.author_account_age_days != null ? ` · account ${review.author_account_age_days}d old` : ""}
          </Muted>
        </View>

        <Card>
          <Body>{review.body}</Body>
        </Card>

        <View>
          <SectionLabel>Reports ({openReports.length} open)</SectionLabel>
          <Card padded={false} style={{ paddingHorizontal: space.lg }}>
            {reports.map((rp, i) => (
              <View
                key={rp.id}
                style={{
                  paddingVertical: 12,
                  borderBottomWidth: i === reports.length - 1 ? 0 : 1,
                  borderBottomColor: t.line,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Pill label={statusLabel(rp.reason)} tone={rp.status === "OPEN" ? "amber" : "neutral"} />
                  <Muted>{relativeTime(rp.created_at)}</Muted>
                </View>
                {rp.detail ? <Text style={{ ...ty.body, color: t.ink }}>{rp.detail}</Text> : null}
                <Muted>
                  {rp.reporter_display_name ?? "Someone"}
                  {rp.reporter_relationship === "OWNER" ? " (owner)" : ""}
                </Muted>
              </View>
            ))}
          </Card>
        </View>
      </Screen>

      {action === null ? (
        <ActionBar>
          <Button title="Dismiss" variant="secondary" onPress={() => setAction("dismiss")} />
          <Button title="Uphold" variant="danger" onPress={() => setAction("uphold")} />
        </ActionBar>
      ) : (
        <ActionBar>
          <View style={{ flex: 1, gap: space.sm }}>
            {action === "uphold" ? (
              <View style={{ flexDirection: "row", gap: 6 }}>
                {MOD_OPTIONS.map((o) => {
                  const on = mod === o.value;
                  return (
                    <Pressable
                      key={o.value}
                      onPress={() => setMod(o.value)}
                      style={{
                        flex: 1,
                        alignItems: "center",
                        paddingVertical: 8,
                        borderRadius: radii.md,
                        borderWidth: 1,
                        borderColor: on ? t.danger : t.line,
                        backgroundColor: on ? t.dangerSoft : "transparent",
                      }}
                    >
                      <Text style={{ ...ty.small, color: on ? t.danger : t.sub }}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <Field
              label={action === "uphold" ? "Note to author (shown if hidden/removed)" : "Note (optional)"}
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Add context…"
            />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <Button title="Cancel" variant="secondary" onPress={() => { setAction(null); setNote(""); }} style={{ flex: 1 }} />
              <Button
                title={action === "uphold" ? "Uphold" : "Dismiss"}
                variant={action === "uphold" ? "danger" : "primary"}
                loading={resolve.isPending}
                onPress={submit}
                style={{ flex: 2 }}
              />
            </View>
          </View>
        </ActionBar>
      )}
    </View>
  );
}
