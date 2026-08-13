import { Redirect, useRouter } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";

import { Card, EmptyState, ErrorState, Loading, Muted, Pill, Screen } from "@/components/ui";
import { usePhotoReports } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export default function ReportedPhotosList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const q = usePhotoReports();

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
          <Pressable key={r.photo_id} onPress={() => router.push(`/reported-photos/${r.photo_id}` as never)}>
            <Card style={{ flexDirection: "row", gap: 13, alignItems: "center" }}>
              <Image
                source={{ uri: r.url }}
                style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: t.card2 }}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <Text style={{ ...ty.label, color: t.ink, flex: 1 }} numberOfLines={1}>
                    {r.place_name ?? "Photo"}
                  </Text>
                  <Pill label={`${r.open_report_count} open`} tone="danger" />
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {r.reasons.map((reason) => (
                    <Pill key={reason} label={statusLabel(reason)} tone="neutral" />
                  ))}
                </View>
                <Muted style={{ marginTop: 8 }}>Last report {relativeTime(r.latest_report_at)}</Muted>
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
