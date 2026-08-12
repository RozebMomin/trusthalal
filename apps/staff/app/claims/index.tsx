import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  ListRow,
  Loading,
  Pill,
  Screen,
} from "@/components/ui";
import { useHalalClaims } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import type { HalalClaimStatus } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

const FILTERS: { label: string; value: HalalClaimStatus | "ALL" }[] = [
  { label: "Pending", value: "PENDING_REVIEW" },
  { label: "Needs info", value: "NEEDS_MORE_INFO" },
  { label: "All", value: "ALL" },
];

export function statusTone(s: HalalClaimStatus) {
  switch (s) {
    case "PENDING_REVIEW":
      return "amber" as const;
    case "NEEDS_MORE_INFO":
      return "info" as const;
    case "APPROVED":
      return "green" as const;
    case "REJECTED":
    case "REVOKED":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

export function statusLabel(s: HalalClaimStatus) {
  return s.replace(/_/g, " ").toLowerCase();
}

export default function ClaimsList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const [filter, setFilter] = useState<HalalClaimStatus | "ALL">("PENDING_REVIEW");
  const q = useHalalClaims(filter);

  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      <View style={{ flexDirection: "row", gap: space.sm, marginBottom: space.sm }}>
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <Pressable
              key={f.value}
              onPress={() => setFilter(f.value)}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: 8,
                borderRadius: radii.pill,
                backgroundColor: active ? t.accent : t.card,
                borderWidth: 1,
                borderColor: active ? t.accent : t.line,
              }}
            >
              <Text style={[ty.small, { color: active ? t.onAccent : t.sub }]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message="Couldn't load claims." onRetry={() => void q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState message="Nothing in this queue." />
      ) : (
        <View style={{ gap: space.sm }}>
          {q.data.map((c) => {
            const loc = [c.place?.city, c.place?.region].filter(Boolean).join(", ");
            return (
              <ListRow
                key={c.id}
                title={c.place?.name ?? "Unknown place"}
                subtitle={loc || c.claim_type}
                right={<Pill label={statusLabel(c.status)} tone={statusTone(c.status)} />}
                onPress={() => router.push(`/claims/${c.id}` as never)}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}
