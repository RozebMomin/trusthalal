import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Card, H1, IconTile, Muted, Screen, SectionLabel, QueueRow } from "@/components/ui";
import { useHalalClaims } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

function initials(email: string | undefined): string {
  if (!email) return "?";
  const local = email.split("@")[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

export default function Queues() {
  const t = useTheme();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const claims = useHalalClaims("PENDING_REVIEW");
  const pending = claims.data?.length ?? 0;

  return (
    <Screen topInset>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <H1>Queues</H1>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            backgroundColor: t.slate,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ ...ty.seg, color: t.onSlate }}>{initials(user?.email)}</Text>
        </View>
      </View>

      <Card style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
        <IconTile icon={pending > 0 ? "alert-triangle" : "check-circle"} tone={pending > 0 ? "amber" : "green"} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...ty.body, fontWeight: "700", color: t.ink }}>
            {pending > 0 ? `${pending} claim${pending === 1 ? "" : "s"} waiting on you` : "You're all caught up"}
          </Text>
          <Muted>{pending > 0 ? "Tap Halal claims to review" : "No claims pending review"}</Muted>
        </View>
      </Card>

      <View>
        <SectionLabel>Review</SectionLabel>
        <Card padded={false}>
          <QueueRow icon="check-circle" tone="green" label="Halal claims" count={pending} onPress={() => router.push("/claims")} />
          <QueueRow icon="alert-octagon" tone="danger" label="Disputes" disabled />
          <QueueRow icon="map-pin" tone="info" label="Verification visits" disabled />
          <QueueRow icon="flag" tone="amber" label="Reported reviews" disabled />
          <QueueRow icon="image" tone="amber" label="Reported photos" disabled />
          <QueueRow icon="user-check" tone="info" label="Verifier applications" last disabled />
        </Card>
      </View>

      <View>
        <SectionLabel>Manage</SectionLabel>
        <Card padded={false}>
          <QueueRow icon="map" tone="green" label="Places" onPress={() => router.push("/places")} />
          <QueueRow icon="briefcase" tone="neutral" label="Ownership requests" disabled />
          <QueueRow icon="users" tone="neutral" label="Users" disabled />
          <QueueRow icon="truck" tone="neutral" label="Suppliers" disabled />
          <QueueRow icon="home" tone="neutral" label="Organizations" last disabled />
        </Card>
      </View>
    </Screen>
  );
}
