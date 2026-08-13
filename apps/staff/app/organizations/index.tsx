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
import { useOrganizations } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { statusLabel, statusTone } from "@/lib/status";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Filter = "REVIEW" | "ALL";

export default function OrganizationsList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const [filter, setFilter] = useState<Filter>("REVIEW");
  const q = useOrganizations();

  if (!authed) return <Redirect href="/login" />;

  const rows = (q.data ?? []).filter((o) =>
    filter === "REVIEW" ? o.status === "UNDER_REVIEW" : true,
  );

  return (
    <Screen>
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { label: "Under review", value: "REVIEW" },
          { label: "All", value: "ALL" },
        ]}
      />

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message="Couldn't load organizations." onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="Nothing here." />
      ) : (
        rows.map((o) => {
          const loc = [o.city, o.region].filter(Boolean).join(", ");
          return (
            <Pressable key={o.id} onPress={() => router.push(`/organizations/${o.id}` as never)}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <Text style={{ ...ty.h2, fontSize: 16, color: t.ink, flex: 1 }}>{o.name}</Text>
                  <Pill label={statusLabel(o.status)} tone={statusTone(o.status)} />
                </View>
                {o.contact_email ? <Muted style={{ marginTop: 3 }}>{o.contact_email}</Muted> : null}
                {loc ? <Muted style={{ marginTop: 2 }}>{loc}</Muted> : null}
                {o.submitted_at ? (
                  <Muted style={{ marginTop: 10 }}>Submitted {relativeTime(o.submitted_at)}</Muted>
                ) : null}
              </Card>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}
