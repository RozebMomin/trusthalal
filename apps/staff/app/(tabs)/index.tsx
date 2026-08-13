import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Card, H1, IconTile, Muted, Screen, SectionLabel, QueueRow } from "@/components/ui";
import {
  useDisputes,
  useHalalClaims,
  useOwnershipRequests,
  usePhotoReports,
  useReviewReports,
  useVerificationVisits,
  useVerifierApplications,
} from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { DISPUTE_OPEN, OWNERSHIP_OPEN, VISIT_OPEN } from "@/lib/status";
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
  const verifiers = useVerifierApplications("PENDING");
  const pendingVerifiers = verifiers.data?.length ?? 0;
  const ownership = useOwnershipRequests();
  const openOwnership = (ownership.data ?? []).filter((r) =>
    OWNERSHIP_OPEN.includes(r.status),
  ).length;
  const disputes = useDisputes();
  const openDisputes = (disputes.data ?? []).filter((d) =>
    DISPUTE_OPEN.includes(d.status),
  ).length;
  const visits = useVerificationVisits();
  const openVisits = (visits.data ?? []).filter((v) =>
    VISIT_OPEN.includes(v.status),
  ).length;
  const reviewReports = useReviewReports();
  const openReviewReports = reviewReports.data?.length ?? 0;
  const photoReports = usePhotoReports();
  const openPhotoReports = photoReports.data?.length ?? 0;

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
          <QueueRow icon="alert-octagon" tone="danger" label="Disputes" count={openDisputes} countTone="danger" onPress={() => router.push("/disputes")} />
          <QueueRow icon="map-pin" tone="info" label="Verification visits" count={openVisits} countTone="info" onPress={() => router.push("/verification-visits")} />
          <QueueRow icon="flag" tone="amber" label="Reported reviews" count={openReviewReports} onPress={() => router.push("/reported-reviews")} />
          <QueueRow icon="image" tone="amber" label="Reported photos" count={openPhotoReports} onPress={() => router.push("/reported-photos")} />
          <QueueRow icon="user-check" tone="info" label="Verifier applications" count={pendingVerifiers} countTone="info" last onPress={() => router.push("/verifier-applications")} />
        </Card>
      </View>

      <View>
        <SectionLabel>Manage</SectionLabel>
        <Card padded={false}>
          <QueueRow icon="map" tone="green" label="Places" onPress={() => router.push("/places")} />
          <QueueRow icon="briefcase" tone="neutral" label="Ownership requests" count={openOwnership} onPress={() => router.push("/ownership-requests")} />
          <QueueRow icon="users" tone="neutral" label="Users" disabled />
          <QueueRow icon="truck" tone="neutral" label="Suppliers" disabled />
          <QueueRow icon="home" tone="neutral" label="Organizations" last disabled />
        </Card>
      </View>
    </Screen>
  );
}
