import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api/client";
import {
  useVerificationVisit,
  useWithdrawVerificationVisit,
} from "@/lib/api/hooks";
import type { VerificationVisitStatus, VisitDisclosure } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Cell, Seg, Tag } from "@/ui/kit";

/** The verifier's own submission detail — reached by tapping a row on the
 *  Verify tab. Shows what was filed and lets them withdraw while it's still
 *  SUBMITTED (the API 409s once an admin moves it to review). */

type Tone = "solid" | "wash" | "amber" | "zinc" | "danger" | "dashed" | "glass";

const STATUS_TAG: Record<VerificationVisitStatus, { label: string; tone: Tone }> = {
  ACCEPTED: { label: "ACCEPTED", tone: "wash" },
  SUBMITTED: { label: "IN REVIEW", tone: "amber" },
  UNDER_REVIEW: { label: "IN REVIEW", tone: "amber" },
  REJECTED: { label: "NOT ACCEPTED", tone: "danger" },
  WITHDRAWN: { label: "WITHDRAWN", tone: "zinc" },
};

const DISCLOSURE_LABEL: Record<VisitDisclosure, string> = {
  SELF_FUNDED: "Self-funded",
  MEAL_COMPED: "Meal comped",
  PAID_PARTNERSHIP: "Paid partnership",
  OTHER_DISCLOSURE: "Other arrangement",
};

function longDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function VisitDetail() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: visit, isLoading, isError } = useVerificationVisit(id);
  const withdraw = useWithdrawVerificationVisit();

  function onWithdraw() {
    if (!visit) return;
    Alert.alert(
      "Withdraw this visit?",
      "It'll be pulled from the review queue. You can always file a new one.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            try {
              await withdraw.mutateAsync(visit.id);
              router.back();
            } catch (e) {
              Alert.alert(
                "Couldn't withdraw",
                e instanceof ApiError && e.status === 409
                  ? "This visit is already being reviewed, so it can't be withdrawn."
                  : e instanceof ApiError
                    ? e.message
                    : "Something went wrong. Try again in a moment.",
              );
            }
          },
        },
      ],
    );
  }

  const Header = (
    <Pressable
      onPress={() => router.back()}
      accessibilityLabel="Back"
      style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
    >
      <Feather name="chevron-left" size={20} color={t.sub} />
      <Text style={[ty.label, { color: t.sub, fontSize: 14 }]}>Back</Text>
    </Pressable>
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  if (isError || !visit) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, gap: space.md }}
      >
        {Header}
        <Text style={[ty.body, { color: t.sub }]}>Couldn&apos;t load this visit.</Text>
      </ScrollView>
    );
  }

  const tag = STATUS_TAG[visit.status];
  const obs = visit.observations;
  const checks = obs?.checks ?? {};
  const checkKeys = Object.keys(checks);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: 60,
        gap: space.md,
      }}
    >
      {Header}

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <Text style={[ty.title, { color: t.ink, flex: 1 }]}>
          {visit.place?.name ?? "Your visit"}
        </Text>
        <Tag label={tag.label} tone={tag.tone} />
      </View>
      <Text style={[ty.small, { color: t.sub }]}>
        {[visit.place?.city, visit.place?.region].filter(Boolean).join(", ")}
        {visit.place?.city ? " · " : ""}
        {longDate(visit.visited_at)}
      </Text>

      {/* Decision note, when an admin has weighed in. */}
      {visit.decision_note ? (
        <Card style={{ padding: space.lg, gap: 4 }}>
          <Seg>Reviewer note</Seg>
          <Text style={[ty.body, { color: t.ink }]}>{visit.decision_note}</Text>
        </Card>
      ) : null}

      <Seg>Disclosure</Seg>
      <Card style={{ padding: space.lg, gap: 4 }}>
        <Text style={[ty.label, { color: t.ink, fontSize: 14 }]}>
          {DISCLOSURE_LABEL[visit.disclosure]}
        </Text>
        {visit.disclosure_note ? (
          <Text style={[ty.small, { color: t.sub }]}>{visit.disclosure_note}</Text>
        ) : null}
      </Card>

      {obs?.ordered_items?.length ? (
        <>
          <Seg>Ordered</Seg>
          <Text style={[ty.body, { color: t.ink }]}>{obs.ordered_items.join(", ")}</Text>
        </>
      ) : null}

      {checkKeys.length ? (
        <>
          <Seg>Checks</Seg>
          <Card>
            {checkKeys.map((k, i) => (
              <Cell
                key={k}
                last={i === checkKeys.length - 1}
                left={<Text style={[ty.small, { color: t.ink, fontSize: 12.5 }]}>{k}</Text>}
                right={
                  <Tag
                    label={checks[k]}
                    tone={checks[k] === "PARTIAL" ? "amber" : "wash"}
                  />
                }
              />
            ))}
          </Card>
        </>
      ) : null}

      {visit.notes_for_admin ? (
        <>
          <Seg>Notes</Seg>
          <Card style={{ padding: space.lg }}>
            <Text style={[ty.body, { color: t.ink }]}>{visit.notes_for_admin}</Text>
          </Card>
        </>
      ) : null}

      {visit.attachments.length ? (
        <>
          <Seg>Photos ({visit.attachments.length})</Seg>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {visit.attachments.map((a) => (
              <View
                key={a.id}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 6,
                  backgroundColor: t.card, borderRadius: radii.md,
                  paddingHorizontal: 10, paddingVertical: 6,
                }}
              >
                <Feather name="image" size={13} color={t.sub} />
                <Text style={[ty.small, { color: t.ink }]}>{a.caption ?? "Photo"}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {visit.public_review_url ? (
        <>
          <Seg>Public review link</Seg>
          <Text style={[ty.small, { color: t.accentDeep }]}>{visit.public_review_url}</Text>
        </>
      ) : null}

      {visit.status === "SUBMITTED" ? (
        <View style={{ marginTop: space.md }}>
          <Button
            title="Withdraw this visit"
            variant="danger"
            icon="trash-2"
            loading={withdraw.isPending}
            onPress={onWithdraw}
          />
          <Text style={[ty.small, { color: t.sub, textAlign: "center", marginTop: 6 }]}>
            You can withdraw until a reviewer picks it up.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
