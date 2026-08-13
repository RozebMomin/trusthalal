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
import { useSuppliers } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { statusLabel } from "@/lib/status";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export function tierTone(tier: string) {
  if (tier === "VERIFIED") return "green" as const;
  if (tier === "DOCUMENTED") return "info" as const;
  return "neutral" as const;
}

type Filter = "ACTIVE" | "ALL";

export default function SuppliersList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const q = useSuppliers(filter === "ALL");

  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { label: "Active", value: "ACTIVE" },
          { label: "All", value: "ALL" },
        ]}
      />

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message="Couldn't load suppliers." onRetry={() => void q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState message="No suppliers." />
      ) : (
        q.data.map((s) => {
          const loc = [s.city, s.region, s.country_code].filter(Boolean).join(", ");
          return (
            <Pressable key={s.id} onPress={() => router.push(`/suppliers/${s.id}` as never)}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <Text style={{ ...ty.h2, fontSize: 16, color: t.ink, flex: 1 }}>{s.name}</Text>
                  <Pill label={statusLabel(s.verification_tier)} tone={tierTone(s.verification_tier)} />
                </View>
                {loc ? <Muted style={{ marginTop: 3 }}>{loc}</Muted> : null}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Pill label={`${s.product_count} product${s.product_count === 1 ? "" : "s"}`} tone="neutral" />
                  {s.revoked_at ? <Pill label="revoked" tone="danger" /> : null}
                </View>
              </Card>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}
