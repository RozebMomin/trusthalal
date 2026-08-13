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
import { useVerifierApplications } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import type { VerifierApplicationStatus } from "@/lib/api/types";
import { relativeTime } from "@/lib/format";
import { statusLabel, statusTone } from "@/lib/status";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Filter = VerifierApplicationStatus | "ALL";

export default function VerifierApplicationsList() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const [filter, setFilter] = useState<Filter>("PENDING");
  const q = useVerifierApplications(filter);

  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { label: "Pending", value: "PENDING" },
          { label: "Approved", value: "APPROVED" },
          { label: "All", value: "ALL" },
        ]}
      />

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message="Couldn't load applications." onRetry={() => void q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState message="Nothing in this queue." />
      ) : (
        q.data.map((a) => (
          <Pressable key={a.id} onPress={() => router.push(`/verifier-applications/${a.id}` as never)}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <Text style={{ ...ty.h2, fontSize: 16, color: t.ink, flex: 1 }}>{a.applicant_name}</Text>
                <Pill label={statusLabel(a.status)} tone={statusTone(a.status)} />
              </View>
              <Muted style={{ marginTop: 3 }}>{a.applicant_email}</Muted>
              <Text style={{ ...ty.body, color: t.ink, marginTop: 10 }} numberOfLines={2}>
                {a.motivation}
              </Text>
              <Muted style={{ marginTop: 10 }}>Applied {relativeTime(a.submitted_at)}</Muted>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
