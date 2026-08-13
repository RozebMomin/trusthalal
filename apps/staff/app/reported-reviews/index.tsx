import { Redirect, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Card, EmptyState, ErrorState, Loading, Muted, Pill, Screen } from "@/components/ui";
import { useReviewReports } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export default function ReportedReviewsList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const q = useReviewReports();

  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message="Couldn't load reports." onRetry={() => void q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState message="No open reports." />
      ) : (
        q.data.map((r) => (
          <Pressable key={r.review_id} onPress={() => router.push(`/reported-reviews/${r.review_id}` as never)}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <Text style={{ ...ty.h2, fontSize: 16, color: t.ink, flex: 1 }}>
                  {r.place_name ?? "Review"}
                </Text>
                <Pill label={`${r.open_report_count} open`} tone="danger" />
              </View>
              {r.targets_reply ? (
                <View style={{ marginTop: 6 }}>
                  <Pill label="Owner reply" tone="amber" />
                </View>
              ) : null}
              <Text style={{ ...ty.body, color: t.ink, marginTop: 8 }} numberOfLines={2}>
                {r.excerpt}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {r.reasons.map((reason) => (
                  <Pill key={reason} label={statusLabel(reason)} tone="neutral" />
                ))}
              </View>
              <Muted style={{ marginTop: 10 }}>Last report {relativeTime(r.latest_report_at)}</Muted>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
