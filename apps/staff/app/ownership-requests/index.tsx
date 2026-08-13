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
import { useOwnershipRequests } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { OWNERSHIP_OPEN, statusLabel, statusTone } from "@/lib/status";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Filter = "OPEN" | "ALL";

export default function OwnershipRequestsList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const [filter, setFilter] = useState<Filter>("OPEN");
  const q = useOwnershipRequests();

  if (!authed) return <Redirect href="/login" />;

  const rows = (q.data ?? []).filter((r) =>
    filter === "OPEN" ? OWNERSHIP_OPEN.includes(r.status) : true,
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
        <ErrorState message="Couldn't load requests." onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState message="Nothing in this queue." />
      ) : (
        rows.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(`/ownership-requests/${r.id}` as never)}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <Text style={{ ...ty.h2, fontSize: 16, color: t.ink, flex: 1 }}>{r.place.name}</Text>
                <Pill label={statusLabel(r.status)} tone={statusTone(r.status)} />
              </View>
              <Muted style={{ marginTop: 3 }}>
                {r.contact_name} · {r.contact_email}
              </Muted>
              {r.organization ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 11 }}>
                  <Pill label={r.organization.name} tone="neutral" />
                  {r.organization.status ? (
                    <Pill label={statusLabel(r.organization.status)} tone={statusTone(r.organization.status)} />
                  ) : null}
                </View>
              ) : null}
              <Muted style={{ marginTop: 10 }}>Filed {relativeTime(r.created_at)}</Muted>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
