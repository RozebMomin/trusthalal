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
import { useHalalClaims } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import type { HalalClaimStatus } from "@/lib/api/types";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Filter = HalalClaimStatus | "ALL";

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

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

const CLAIM_TYPE_LABEL: Record<string, string> = {
  INITIAL: "Initial",
  RENEWAL: "Renewal",
  RECONCILIATION: "Dispute-triggered",
};

export default function ClaimsList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const [filter, setFilter] = useState<Filter>("PENDING_REVIEW");
  const q = useHalalClaims(filter);

  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { label: "Pending", value: "PENDING_REVIEW" },
          { label: "Needs info", value: "NEEDS_MORE_INFO" },
          { label: "All", value: "ALL" },
        ]}
      />

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message="Couldn't load claims." onRetry={() => void q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState message="Nothing in this queue." />
      ) : (
        q.data.map((c) => {
          const loc = [c.place?.city, c.place?.region].filter(Boolean).join(", ");
          const hasCert = Boolean(c.structured_response?.has_certification);
          return (
            <Pressable key={c.id} onPress={() => router.push(`/claims/${c.id}` as never)}>
              <Card>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 10,
                  }}
                >
                  <Text style={{ ...ty.h2, fontSize: 16, color: t.ink, flex: 1 }}>
                    {c.place?.name ?? "Unknown place"}
                  </Text>
                  <Pill label={statusLabel(c.status)} tone={statusTone(c.status)} />
                </View>
                {loc ? <Muted style={{ marginTop: 3 }}>{loc}</Muted> : null}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 11 }}>
                  <Pill label={CLAIM_TYPE_LABEL[c.claim_type] ?? c.claim_type} tone="neutral" />
                  {hasCert ? <Pill label="Cert on file" tone="neutral" /> : null}
                </View>
                <Muted style={{ marginTop: 10 }}>Submitted {relativeTime(c.submitted_at)}</Muted>
              </Card>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}
