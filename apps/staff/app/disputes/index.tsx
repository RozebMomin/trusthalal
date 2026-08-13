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
import { useDisputes } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { DISPUTE_OPEN, statusLabel, statusTone } from "@/lib/status";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export const DISPUTE_ATTR: Record<string, string> = {
  PORK_SERVED: "Pork served",
  ALCOHOL_PRESENT: "Alcohol present",
  MENU_POSTURE_INCORRECT: "Menu posture wrong",
  SLAUGHTER_METHOD_INCORRECT: "Slaughter method wrong",
  CERTIFICATION_INVALID: "Certification invalid",
  PLACE_CLOSED: "Place closed",
  OTHER: "Other",
};

type Filter = "OPEN" | "ALL";

export default function DisputesList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const [filter, setFilter] = useState<Filter>("OPEN");
  const q = useDisputes();

  if (!authed) return <Redirect href="/login" />;

  const rows = (q.data ?? []).filter((d) =>
    filter === "OPEN" ? DISPUTE_OPEN.includes(d.status) : true,
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
        <ErrorState message="Couldn't load disputes." onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="Nothing in this queue." />
      ) : (
        rows.map((d) => (
          <Pressable key={d.id} onPress={() => router.push(`/disputes/${d.id}` as never)}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <Text style={{ ...ty.h2, fontSize: 16, color: t.ink, flex: 1 }}>
                  {DISPUTE_ATTR[d.disputed_attribute] ?? d.disputed_attribute}
                </Text>
                <Pill label={statusLabel(d.status)} tone={statusTone(d.status)} />
              </View>
              <Text style={{ ...ty.body, color: t.ink, marginTop: 8 }} numberOfLines={2}>
                {d.description}
              </Text>
              <Muted style={{ marginTop: 10 }}>Filed {relativeTime(d.submitted_at)}</Muted>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
