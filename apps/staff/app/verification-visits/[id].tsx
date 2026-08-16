import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import {
  ActionBar,
  Body,
  Button,
  Card,
  ErrorState,
  Field,
  IconTile,
  Loading,
  Muted,
  Pill,
  Screen,
  SectionLabel,
} from "@/components/ui";
import {
  useDecideVisit,
  useVerificationVisit,
  useVisitUnderReview,
} from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { statusLabel, statusTone } from "@/lib/status";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { DISCLOSURE_LABEL, disclosureTone } from "./index";

const MENU_POSTURE: Record<string, string> = {
  FULLY_HALAL: "Fully halal",
  MIXED_SEPARATE_KITCHENS: "Mixed, separate kitchens",
  HALAL_OPTIONS_ADVERTISED: "Halal options advertised",
  HALAL_UPON_REQUEST: "Halal upon request",
  MIXED_SHARED_KITCHEN: "Mixed, shared kitchen",
};
const ALCOHOL: Record<string, string> = {
  NONE: "None",
  BEER_AND_WINE_ONLY: "Beer and wine only",
  FULL_BAR: "Full bar",
};
const FINDING_LABEL: Record<string, string> = {
  HAND_CUT: "Hand-cut",
  MACHINE_CUT: "Machine-cut",
  ZABIHAH: "Zabihah",
  NOT_ZABIHAH: "Not zabihah",
  NOT_SERVED: "Not served",
  UNSURE: "Unsure",
};
function findingTone(f: string): "green" | "amber" | "neutral" {
  if (f === "HAND_CUT" || f === "ZABIHAH") return "green";
  if (f === "UNSURE") return "amber";
  return "neutral";
}
const EVIDENCE_LABEL: Record<string, string> = {
  VERBAL: "verbal",
  INVOICE: "invoice seen",
  CERTIFICATE: "cert seen",
};
const MEAT_LABEL: Record<string, string> = {
  CHICKEN: "Chicken",
  BEEF: "Beef",
  LAMB: "Lamb",
  GOAT: "Goat",
};
const AMENITY_LABEL: Record<string, string> = {
  PRAYER_SPACE: "Prayer space",
  WUDU: "Wudu area",
  BIDET: "Bidet / shattaf",
  BABY_CHANGING: "Baby changing",
};
const AMENITY_VALUE_LABEL: Record<string, string> = {
  YES: "Yes",
  ON_REQUEST: "On request",
  NO: "No",
  UNSURE: "Unsure",
};
function amenityTone(v: string): "green" | "amber" | "neutral" {
  if (v === "YES") return "green";
  if (v === "ON_REQUEST" || v === "UNSURE") return "amber";
  return "neutral";
}
const MENU_SCOPE_LABEL: Record<string, string> = {
  MEAT_GROUP: "A meat group is halal",
  SPECIFIC_ITEMS: "Specific dishes are halal",
};

type Action = "accept" | "reject" | null;

function InfoLine({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: space.md,
        paddingVertical: 11,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.line,
      }}
    >
      <Text style={{ ...ty.body, color: t.sub }}>{label}</Text>
      <Text style={{ ...ty.body, fontWeight: "600", color: t.ink, flexShrink: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}

export default function VisitDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useVerificationVisit(id);
  const decide = useDecideVisit();
  const underReview = useVisitUnderReview();

  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");

  if (!authed) return <Redirect href="/login" />;
  if (q.isLoading)
    return <View style={{ flex: 1, backgroundColor: t.bg }}><Loading /></View>;
  if (q.isError || !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this visit." onRetry={() => void q.refetch()} />
      </View>
    );

  const v = q.data;
  const f = v.structured_findings;
  const decidable = v.status === "SUBMITTED" || v.status === "UNDER_REVIEW";
  const busy = decide.isPending || underReview.isPending;

  async function submit() {
    if (action === "reject" && !note.trim())
      return Alert.alert("A note is required to reject.");
    try {
      await decide.mutateAsync({
        id: v.id,
        payload: {
          decision: action === "accept" ? "ACCEPTED" : "REJECTED",
          decision_note: note.trim() || null,
        },
      });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't submit", err instanceof Error ? err.message : "Try again.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen contentStyle={{ paddingTop: space.md }}>
        <View>
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>{v.place?.name ?? "Visit"}</Text>
          <Muted style={{ marginTop: 2 }}>Visited {relativeTime(v.visited_at)}</Muted>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pill label={statusLabel(v.status)} tone={statusTone(v.status)} />
            <Pill label={DISCLOSURE_LABEL[v.disclosure] ?? v.disclosure} tone={disclosureTone(v.disclosure)} />
          </View>
        </View>

        {v.disclosure_note ? (
          <View>
            <SectionLabel>Disclosure</SectionLabel>
            <Card>
              <Body>{v.disclosure_note}</Body>
            </Card>
          </View>
        ) : null}

        {f ? (
          <View>
            <SectionLabel>Findings</SectionLabel>
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {f.menu_posture ? (
                <InfoLine label="Menu" value={MENU_POSTURE[f.menu_posture] ?? f.menu_posture} />
              ) : null}
              <InfoLine label="Pork on menu" value={f.has_pork ? "Yes" : "No"} />
              {f.alcohol_policy ? (
                <InfoLine label="Alcohol" value={ALCOHOL[f.alcohol_policy] ?? f.alcohol_policy} last />
              ) : null}
            </Card>
          </View>
        ) : null}

        {(() => {
          const obs = v.observations;
          if (!obs) return null;
          const checkEntries = Object.entries(obs.checks ?? {});
          const ordered = obs.ordered_items ?? [];
          const mp = obs.menu_partial;
          if (checkEntries.length === 0 && ordered.length === 0 && !mp) return null;
          return (
            <View>
              <SectionLabel>Observations</SectionLabel>
              <Card padded={false} style={{ paddingHorizontal: space.lg }}>
                {checkEntries.map(([k, val], i) => (
                  <InfoLine
                    key={k}
                    label={k}
                    value={String(val)}
                    last={i === checkEntries.length - 1 && !mp && ordered.length === 0}
                  />
                ))}
                {mp ? (
                  <View
                    style={{
                      paddingVertical: 11,
                      borderBottomWidth: ordered.length === 0 ? 0 : 1,
                      borderBottomColor: t.line,
                    }}
                  >
                    <Text style={{ ...ty.body, color: t.sub }}>Partial menu</Text>
                    <Body style={{ marginTop: 3 }}>
                      {MENU_SCOPE_LABEL[mp.scope] ?? mp.scope}
                      {mp.note ? ` — ${mp.note}` : ""}
                    </Body>
                  </View>
                ) : null}
                {ordered.length ? (
                  <View style={{ paddingVertical: 11 }}>
                    <Text style={{ ...ty.body, color: t.sub }}>Ordered</Text>
                    <Body style={{ marginTop: 3 }}>{ordered.join(", ")}</Body>
                  </View>
                ) : null}
              </Card>
            </View>
          );
        })()}

        {(() => {
          const amenityEntries = Object.entries(v.observations?.amenities ?? {});
          if (amenityEntries.length === 0) return null;
          return (
            <View>
              <SectionLabel>Amenities</SectionLabel>
              <Card padded={false} style={{ paddingHorizontal: space.lg }}>
                {amenityEntries.map(([k, val], i) => (
                  <View
                    key={k}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      paddingVertical: 12,
                      borderBottomWidth: i === amenityEntries.length - 1 ? 0 : 1,
                      borderBottomColor: t.line,
                    }}
                  >
                    <Text style={{ ...ty.label, color: t.ink }}>{AMENITY_LABEL[k] ?? k}</Text>
                    <Pill label={AMENITY_VALUE_LABEL[val] ?? val} tone={amenityTone(val)} />
                  </View>
                ))}
              </Card>
            </View>
          );
        })()}

        {(() => {
          const mc = v.observations?.meat_checks ?? {};
          const other = v.observations?.other_meat_checks ?? [];
          const rows = [
            ...Object.entries(mc).map(([meat, c]) => ({ key: meat, label: MEAT_LABEL[meat] ?? meat, c })),
            ...other.map((o, i) => ({ key: `other-${i}`, label: o.label, c: o })),
          ];
          if (rows.length === 0) return null;
          return (
            <View>
              <SectionLabel>Per-item findings</SectionLabel>
              <Card padded={false} style={{ paddingHorizontal: space.lg }}>
                {rows.map((r, i) => (
                  <View
                    key={r.key}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      paddingVertical: 12,
                      borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                      borderBottomColor: t.line,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.label, color: t.ink }}>{r.label}</Text>
                      {r.c.finding !== "NOT_SERVED" ? (
                        <Muted style={{ marginTop: 2 }}>{EVIDENCE_LABEL[r.c.evidence] ?? r.c.evidence}</Muted>
                      ) : null}
                    </View>
                    <Pill label={FINDING_LABEL[r.c.finding] ?? r.c.finding} tone={findingTone(r.c.finding)} />
                  </View>
                ))}
              </Card>
            </View>
          );
        })()}

        {v.notes_for_admin ? (
          <View>
            <SectionLabel>Notes for admin</SectionLabel>
            <Card>
              <Body>{v.notes_for_admin}</Body>
            </Card>
          </View>
        ) : null}

        <View>
          <SectionLabel>Attachments ({v.attachments.length})</SectionLabel>
          {v.attachments.length === 0 ? (
            <Card>
              <Muted>None attached.</Muted>
            </Card>
          ) : (
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {v.attachments.map((att, i) => (
                <View
                  key={att.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 11,
                    paddingVertical: 12,
                    borderBottomWidth: i === v.attachments.length - 1 ? 0 : 1,
                    borderBottomColor: t.line,
                  }}
                >
                  <IconTile icon="image" tone="neutral" />
                  <Text style={{ ...ty.body, fontWeight: "600", color: t.ink, flex: 1 }} numberOfLines={1}>
                    {att.original_filename}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </View>
      </Screen>

      {decidable && action === null ? (
        <ActionBar>
          <Button title="Reject" variant="danger" onPress={() => setAction("reject")} />
          {v.status === "SUBMITTED" ? (
            <Button title="Under review" variant="secondary" loading={underReview.isPending} onPress={() => underReview.mutate(v.id)} />
          ) : null}
          <Button title="Accept" variant="primary" onPress={() => setAction("accept")} />
        </ActionBar>
      ) : null}

      {action !== null ? (
        <ActionBar>
          <View style={{ flex: 1, gap: space.sm }}>
            <Field
              label={action === "accept" ? "Note (optional)" : "Reason (shown to verifier)"}
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Add context…"
            />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <Button title="Cancel" variant="secondary" onPress={() => { setAction(null); setNote(""); }} style={{ flex: 1 }} />
              <Button
                title={action === "accept" ? "Accept" : "Reject"}
                variant={action === "reject" ? "danger" : "primary"}
                loading={busy}
                onPress={submit}
                style={{ flex: 2 }}
              />
            </View>
          </View>
        </ActionBar>
      ) : null}
    </View>
  );
}
