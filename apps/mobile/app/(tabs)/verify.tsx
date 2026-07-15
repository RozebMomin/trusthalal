import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { useCurrentUser, useMyVerificationVisits } from "@/lib/api/hooks";
import type { VerificationVisitStatus } from "@/lib/api/types";
import { visitDraft, type VisitDraft } from "@/lib/visit-draft";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Cell, Chip, Seg, Tag } from "@/ui/kit";

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

const TOTAL_STEPS = 5;

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** A draft is worth surfacing once the verifier has picked a place or put
 *  any content into it — an empty shell shouldn't nag from the home. */
function draftHasContent(d: VisitDraft | null): d is VisitDraft {
  if (!d) return false;
  return Boolean(
    d.selected || d.ordered?.length || d.notes?.trim() || d.photos?.length || (d.step ?? 0) > 0,
  );
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

  // Reload the on-device draft every time the tab regains focus, so a
  // "Save as draft" from the wizard shows up here immediately on return.
  const [draft, setDraft] = useState<VisitDraft | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      visitDraft.load().then((d) => alive && setDraft(d));
      return () => {
        alive = false;
      };
    }, []),
  );

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

  const hasDraft = draftHasContent(draft);
  const discardDraft = () => {
    void visitDraft.clear();
    setDraft(null);
  };

  return (
    // The safe-area gap is a fixed OUTER padding, not part of the scroll
    // content — otherwise re-tapping the tab lets iOS re-apply the inset and
    // the whole screen drifts down a little each time.
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          paddingTop: space.md,
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

        {/* Resume-a-draft card. Appears after a "Save as draft" and points
            back into the same wizard, which rehydrates from the draft. */}
        {hasDraft ? (
          <Card
            style={{
              padding: space.lg,
              borderWidth: 1.5,
              borderStyle: "dashed",
              borderColor: t.line,
              backgroundColor: t.bg,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Tag label="DRAFT" tone="amber" />
                <Text style={[ty.label, { color: t.ink, marginTop: 6 }]}>
                  {draft.selected?.name ?? "New visit"}
                </Text>
                <Text style={[ty.small, { color: t.sub }]}>
                  Step {Math.min((draft.step ?? 0) + 1, TOTAL_STEPS)} of {TOTAL_STEPS}
                  {draft.photos?.length ? ` · ${draft.photos.length} photo${draft.photos.length === 1 ? "" : "s"}` : ""}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 8 }}>
                <Chip label="Resume" on onPress={() => router.push("/file-visit")} />
                <Pressable onPress={discardDraft} hitSlop={8}>
                  <Text style={[ty.small, { color: t.sub }]}>Discard</Text>
                </Pressable>
              </View>
            </View>
          </Card>
        ) : (
          <>
            <Button title="File a visit" variant="accent" icon="plus" onPress={() => router.push("/file-visit")} />
            <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
              Log a restaurant you visited — with an honest disclosure of who paid.
            </Text>
          </>
        )}

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
    </View>
  );
}
