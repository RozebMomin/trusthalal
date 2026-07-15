import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { useCurrentUser, useMyVerificationVisits } from "@/lib/api/hooks";
import type { VerificationVisitStatus } from "@/lib/api/types";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Cell, Seg, Tag } from "@/ui/kit";

/** Real verifier home — the verifier's own visit history + stats, wired
 *  to /me/verification-visits. Lives as a bottom-nav tab that only shows
 *  for VERIFIER accounts (see (tabs)/_layout.tsx). The old
 *  /ui/verifier-profile was a fixture mockup; this is the live surface. */

type Tone = "solid" | "wash" | "amber" | "zinc" | "danger" | "dashed" | "glass";

const STATUS_TAG: Record<VerificationVisitStatus, { label: string; tone: Tone }> = {
  ACCEPTED: { label: "ACCEPTED", tone: "wash" },
  SUBMITTED: { label: "IN REVIEW", tone: "amber" },
  UNDER_REVIEW: { label: "IN REVIEW", tone: "amber" },
  REJECTED: { label: "NOT ACCEPTED", tone: "danger" },
  WITHDRAWN: { label: "WITHDRAWN", tone: "zinc" },
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Stat({ n, l }: { n: string; l: string }) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, padding: space.md, alignItems: "center" }}>
      <Text style={[ty.h2, { color: t.ink }]}>{n}</Text>
      <Text style={[ty.seg, { color: t.sub, fontSize: 8.5, marginTop: 2 }]}>{l}</Text>
    </Card>
  );
}

export default function Verify() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const isVerifier = me?.role === "VERIFIER";
  const { data: visits, isLoading, isError, refetch } = useMyVerificationVisits(isVerifier);

  // Signed-out → sign-in. Signed-in non-verifier → the pitch. The tab is
  // hidden for non-verifiers, but a deep link could still land here; the
  // API would 403 anyway, so don't render the surface.
  useEffect(() => {
    if (me === null) router.replace("/(auth)/sign-in");
    else if (me && me.role !== "VERIFIER") router.replace("/become-a-verifier");
  }, [me]);

  if (!isVerifier) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  const rows = visits ?? [];
  const accepted = rows.filter((v) => v.status === "ACCEPTED").length;
  const inReview = rows.filter(
    (v) => v.status === "SUBMITTED" || v.status === "UNDER_REVIEW",
  ).length;
  const cities = new Set(
    rows.map((v) => v.place?.city).filter((c): c is string => Boolean(c)),
  ).size;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: 120,
        gap: space.md,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={[ty.title, { color: t.ink }]}>Verify</Text>
        <Tag label="✓ VERIFIER" tone="solid" />
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Stat n={String(accepted)} l="Accepted" />
        <Stat n={String(inReview)} l="In review" />
        <Stat n={String(cities)} l="Cities" />
      </View>

      <Button title="File a visit" variant="accent" icon="plus" onPress={() => router.push("/file-visit")} />
      <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
        Log a restaurant you visited — with an honest disclosure of who paid.
      </Text>

      <Seg>My visits</Seg>

      {isLoading ? (
        <Card style={{ padding: space.xl, alignItems: "center" }}>
          <ActivityIndicator color={t.accent} />
        </Card>
      ) : isError ? (
        <Card style={{ padding: space.lg, alignItems: "center", gap: space.sm }}>
          <Text style={[ty.body, { color: t.sub, textAlign: "center" }]}>
            Couldn't load your visits.
          </Text>
          <Pressable onPress={() => refetch()}>
            <Text style={[ty.label, { color: t.accentDeep, fontSize: 13 }]}>Retry</Text>
          </Pressable>
        </Card>
      ) : rows.length === 0 ? (
        <Card style={{ padding: space.xl, alignItems: "center", gap: 6 }}>
          <Feather name="map-pin" size={22} color={t.sub} />
          <Text style={[ty.label, { color: t.ink, fontSize: 14 }]}>No visits yet</Text>
          <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
            File your first visit after eating somewhere halal.
          </Text>
        </Card>
      ) : (
        <Card>
          {rows.map((v, i) => {
            const tag = STATUS_TAG[v.status];
            const place = v.place?.name ?? "Restaurant";
            const meta = [v.place?.city, shortDate(v.visited_at)]
              .filter(Boolean)
              .join(" · ");
            return (
              <Cell
                key={v.id}
                last={i === rows.length - 1}
                onPress={() => router.push(`/places/${v.place_id}`)}
                left={
                  <View>
                    <Text style={[ty.label, { color: t.ink, fontSize: 12.5 }]}>{place}</Text>
                    <Text style={[ty.small, { color: t.sub }]}>{meta}</Text>
                  </View>
                }
                right={<Tag label={tag.label} tone={tag.tone} />}
              />
            );
          })}
        </Card>
      )}

      <Text style={[ty.small, { color: t.sub, textAlign: "center", marginTop: 4 }]}>
        Every visit discloses who paid for the meal.
      </Text>
    </ScrollView>
  );
}
