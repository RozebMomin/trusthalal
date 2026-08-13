import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import {
  ActionBar,
  Button,
  Card,
  ErrorState,
  Field,
  IconTile,
  Loading,
  Muted,
  Pill,
  SectionLabel,
} from "@/components/ui";
import {
  useApproveClaim,
  useHalalClaim,
  useRejectClaim,
  useRequestInfoClaim,
} from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import type { ValidationTier } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { statusLabel, statusTone } from "./index";

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
const SLAUGHTER: Record<string, string> = {
  HAND_CUT: "Hand-cut",
  MACHINE_CUT: "Machine-cut",
  NOT_SERVED: "Not served",
};
const TIERS: { value: ValidationTier; label: string }[] = [
  { value: "SELF_ATTESTED", label: "Owner-attested" },
  { value: "CERTIFICATE_ON_FILE", label: "Certificate" },
  { value: "TRUST_HALAL_VERIFIED", label: "Verified" },
];

type Action = "approve" | "reject" | "request-info" | null;

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

export default function ClaimDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useHalalClaim(id);

  const approve = useApproveClaim();
  const reject = useRejectClaim();
  const requestInfo = useRequestInfoClaim();

  const [action, setAction] = useState<Action>(null);
  const [tier, setTier] = useState<ValidationTier>("CERTIFICATE_ON_FILE");
  const [note, setNote] = useState("");

  if (!authed) return <Redirect href="/login" />;
  if (q.isLoading)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Loading />
      </View>
    );
  if (q.isError || !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this claim." onRetry={() => void q.refetch()} />
      </View>
    );

  const c = q.data;
  const r = c.structured_response;
  const decidable = c.status === "PENDING_REVIEW" || c.status === "NEEDS_MORE_INFO";
  const needsOverride = c.status !== "PENDING_REVIEW";
  const busy = approve.isPending || reject.isPending || requestInfo.isPending;

  function reset() {
    setAction(null);
    setNote("");
  }

  async function submit() {
    try {
      if (action === "approve") {
        await approve.mutateAsync({
          id: c.id,
          payload: {
            validation_tier: tier,
            decision_note: note.trim() || null,
            override_acknowledged: needsOverride || undefined,
          },
        });
      } else if (action === "reject") {
        if (!note.trim()) return Alert.alert("A reason is required to reject.");
        await reject.mutateAsync({ id: c.id, payload: { decision_note: note.trim() } });
      } else if (action === "request-info") {
        if (!note.trim()) return Alert.alert("Say what's needed from the owner.");
        await requestInfo.mutateAsync({ id: c.id, payload: { decision_note: note.trim() } });
      }
      router.back();
    } catch (err) {
      Alert.alert("Couldn't submit", err instanceof Error ? err.message : "Try again.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: space.md, paddingBottom: space.xl, gap: space.md }}
      >
        <View>
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>
            {c.place?.name ?? "Unknown place"}
          </Text>
          {c.place?.address ? <Muted style={{ marginTop: 2 }}>{c.place.address}</Muted> : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Pill label={statusLabel(c.status)} tone={statusTone(c.status)} />
            <Pill label={c.claim_type.toLowerCase()} tone="neutral" />
          </View>
        </View>

        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          {r?.menu_posture ? (
            <InfoLine label="Menu" value={MENU_POSTURE[r.menu_posture] ?? r.menu_posture} />
          ) : null}
          <InfoLine label="Pork on menu" value={r?.has_pork ? "Yes" : "No"} />
          {r?.alcohol_policy ? (
            <InfoLine label="Alcohol" value={ALCOHOL[r.alcohol_policy] ?? r.alcohol_policy} />
          ) : null}
          <InfoLine label="Certification" value={r?.has_certification ? "Yes" : "No"} />
          {r?.certifying_body_name ? (
            <InfoLine label="Certifier" value={r.certifying_body_name} last />
          ) : null}
        </Card>

        {r?.meat_products && r.meat_products.length > 0 ? (
          <View>
            <SectionLabel>Meat products</SectionLabel>
            <Card>
              {r.meat_products.map((p, i) => (
                <View key={i}>
                  {i > 0 ? (
                    <View style={{ height: 1, backgroundColor: t.line, marginVertical: 11 }} />
                  ) : null}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.label, color: t.ink }}>{p.product_name}</Text>
                      <Muted style={{ marginTop: 2 }}>
                        {p.meat_type.toLowerCase()}
                        {p.supplier_name ? ` · ${p.supplier_name}` : ""}
                      </Muted>
                    </View>
                    <Pill
                      label={SLAUGHTER[p.slaughter_method] ?? p.slaughter_method}
                      tone={p.slaughter_method === "HAND_CUT" ? "green" : "neutral"}
                    />
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {r?.caveats ? (
          <View>
            <SectionLabel>Owner caveats</SectionLabel>
            <Card>
              <Text style={{ ...ty.body, color: t.ink }}>{r.caveats}</Text>
            </Card>
          </View>
        ) : null}

        <View>
          <SectionLabel>Attachments ({c.attachments.length})</SectionLabel>
          {c.attachments.length === 0 ? (
            <Card>
              <Muted>None attached.</Muted>
            </Card>
          ) : (
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {c.attachments.map((a, i) => (
                <View
                  key={a.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 11,
                    paddingVertical: 12,
                    borderBottomWidth: i === c.attachments.length - 1 ? 0 : 1,
                    borderBottomColor: t.line,
                  }}
                >
                  <IconTile icon="file-text" tone="neutral" />
                  <Text style={{ ...ty.body, fontWeight: "600", color: t.ink, flex: 1 }} numberOfLines={1}>
                    {a.original_filename}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      {decidable && action === null ? (
        <ActionBar>
          <Button title="Reject" variant="danger" onPress={() => setAction("reject")} />
          <Button title="Request info" variant="secondary" onPress={() => setAction("request-info")} />
          <Button title="Approve" variant="primary" onPress={() => setAction("approve")} />
        </ActionBar>
      ) : null}

      {action !== null ? (
        <ActionBar>
          <View style={{ flex: 1, gap: space.sm }}>
            {action === "approve" ? (
              <View style={{ flexDirection: "row", gap: 6 }}>
                {TIERS.map((opt) => {
                  const on = tier === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setTier(opt.value)}
                      style={{
                        flex: 1,
                        alignItems: "center",
                        paddingVertical: 8,
                        borderRadius: radii.md,
                        borderWidth: 1,
                        borderColor: on ? t.accent : t.line,
                        backgroundColor: on ? t.accentSoft : "transparent",
                      }}
                    >
                      <Text style={{ ...ty.small, color: on ? t.accentDeep : t.sub }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <Field
              label={
                action === "approve"
                  ? "Note (optional)"
                  : action === "reject"
                    ? "Reason (shown to owner)"
                    : "What's needed (shown to owner)"
              }
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Add context…"
            />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <Button title="Cancel" variant="secondary" onPress={reset} style={{ flex: 1 }} />
              <Button
                title={action === "approve" ? "Approve" : action === "reject" ? "Reject" : "Send"}
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
