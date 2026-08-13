import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  Pill,
  Screen,
  Segmented,
} from "@/components/ui";
import { useVerificationVisits } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { statusLabel, statusTone, VISIT_OPEN } from "@/lib/status";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export const DISCLOSURE_LABEL: Record<string, string> = {
  SELF_FUNDED: "Self-funded",
  MEAL_COMPED: "Meal comped",
  PAID_PARTNERSHIP: "Paid partnership",
  OTHER_DISCLOSURE: "Other",
};

export function disclosureTone(d: string): "green" | "amber" | "neutral" {
  if (d === "SELF_FUNDED") return "green";
  if (d === "MEAL_COMPED" || d === "PAID_PARTNERSHIP") return "amber";
  return "neutral";
}

type Filter = "OPEN" | "ALL";

export default function VerificationVisitsList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const [filter, setFilter] = useState<Filter>("OPEN");
  const q = useVerificationVisits();

  if (!authed) return <Redirect href="/login" />;

  const rows = (q.data ?? []).filter((v) =>
    filter === "OPEN" ? VISIT_OPEN.includes(v.status) : true,
  );

  return (
    <Screen>
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { label: "Open", value: "OPEN" },
          { label: "All", value: "ALL" },
        ]}
      />

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message="Couldn't load visits." onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="Nothing in this queue." />
      ) : (
        rows.map((v) => (
          <Pressable key={v.id} onPress={() => router.push(`/verification-visits/${v.id}` as never)}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <Text style={{ ...ty.h2, fontSize: 16, color: t.ink, flex: 1 }}>
                  {v.place?.name ?? "Visit"}
                </Text>
                <Pill label={statusLabel(v.status)} tone={statusTone(v.status)} />
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 11 }}>
                <Pill label={DISCLOSURE_LABEL[v.disclosure] ?? v.disclosure} tone={disclosureTone(v.disclosure)} />
              </View>
              <Muted style={{ marginTop: 10 }}>Visited {relativeTime(v.visited_at)}</Muted>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
