import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import {
  Body,
  Button,
  Card,
  ErrorState,
  Field,
  H1,
  Loading,
  Muted,
  Pill,
  Screen,
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
  NONE: "No alcohol",
  BEER_AND_WINE_ONLY: "Beer and wine only",
  FULL_BAR: "Full bar",
};
const SLAUGHTER: Record<string, string> = {
  HAND_CUT: "Hand-slaughtered",
  MACHINE_CUT: "Machine-slaughtered",
  NOT_SERVED: "Not served",
};
const TIERS: { value: ValidationTier; label: string }[] = [
  { value: "SELF_ATTESTED", label: "Owner-attested" },
  { value: "CERTIFICATE_ON_FILE", label: "Certificate on file" },
  { value: "TRUST_HALAL_VERIFIED", label: "Verified in person" },
];

type Action = "approve" | "reject" | "request-info" | null;

function Line({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Text style={[ty.small, { color: t.sub }]}>{label}</Text>
      <Text style={[ty.small, { color: t.ink, flexShrink: 1, textAlign: "right" }]}>
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
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.isError || !q.data)
    return (
      <Screen>
        <ErrorState message="Couldn't load this claim." onRetry={() => void q.refetch()} />
      </Screen>
    );

  const c = q.data;
  const r = c.structured_response;
  const decidable = c.status === "PENDING_REVIEW" || c.status === "NEEDS_MORE_INFO";
  const needsOverride = c.status !== "PENDING_REVIEW";
  const busy = approve.isPending || reject.isPending || requestInfo.isPending;

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
    <Screen>
      <View style={{ gap: 4 }}>
        <H1>{c.place?.name ?? "Unknown place"}</H1>
        {c.place?.address ? <Muted>{c.place.address}</Muted> : null}
        <View style={{ marginTop: space.xs }}>
          <Pill label={statusLabel(c.status)} tone={statusTone(c.status)} />
        </View>
      </View>

      <Card>
        <Text style={[ty.seg, { color: t.sub }]}>Questionnaire</Text>
        {r?.menu_posture ? (
          <Line label="Menu" value={MENU_POSTURE[r.menu_posture] ?? r.menu_posture} />
        ) : null}
        <Line label="Pork on menu" value={r?.has_pork ? "Yes" : "No"} />
        {r?.alcohol_policy ? (
          <Line label="Alcohol" value={ALCOHOL[r.alcohol_policy] ?? r.alcohol_policy} />
        ) : null}
        <Line label="Alcohol in cooking" value={r?.alcohol_in_cooking ? "Yes" : "No"} />
        <Line label="Certification" value={r?.has_certification ? "Yes" : "No"} />
        {r?.certifying_body_name ? (
          <Line label="Certifier" value={r.certifying_body_name} />
        ) : null}
      </Card>

      {r?.meat_products && r.meat_products.length > 0 ? (
        <Card>
          <Text style={[ty.seg, { color: t.sub }]}>Meat products</Text>
          {r.meat_products.map((p, i) => (
            <View key={i} style={{ gap: 2, paddingVertical: 4 }}>
              <Text style={[ty.label, { color: t.ink }]}>
                {p.product_name} ({p.meat_type.toLowerCase()})
              </Text>
              <Muted>
                {SLAUGHTER[p.slaughter_method] ?? p.slaughter_method}
                {p.supplier_name ? ` · ${p.supplier_name}` : ""}
              </Muted>
            </View>
          ))}
        </Card>
      ) : null}

      {r?.caveats ? (
        <Card>
          <Text style={[ty.seg, { color: t.sub }]}>Owner caveats</Text>
          <Body>{r.caveats}</Body>
        </Card>
      ) : null}

      <Card>
        <Text style={[ty.seg, { color: t.sub }]}>
          Attachments ({c.attachments.length})
        </Text>
        {c.attachments.length === 0 ? (
          <Muted>None attached.</Muted>
        ) : (
          c.attachments.map((a) => (
            <Muted key={a.id}>
              {a.original_filename} · {a.document_type.replace(/_/g, " ").toLowerCase()}
            </Muted>
          ))
        )}
      </Card>

      {decidable ? (
        <Card>
          <Text style={[ty.seg, { color: t.sub }]}>Decision</Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {(["approve", "request-info", "reject"] as const).map((a) => {
              const active = action === a;
              const color = a === "reject" ? t.danger : a === "approve" ? t.accent : t.info;
              return (
                <Pressable
                  key={a}
                  onPress={() => setAction(active ? null : a)}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    paddingVertical: 10,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: active ? color : t.line,
                    backgroundColor: active ? color : t.card,
                  }}
                >
                  <Text style={[ty.small, { color: active ? "#FFFFFF" : t.ink }]}>
                    {a === "request-info" ? "Request info" : a[0].toUpperCase() + a.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {action === "approve" ? (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <Text style={[ty.small, { color: t.sub }]}>Validation tier</Text>
              <View style={{ gap: space.xs }}>
                {TIERS.map((opt) => {
                  const active = tier === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setTier(opt.value)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                        padding: space.sm,
                        borderRadius: radii.md,
                        borderWidth: 1,
                        borderColor: active ? t.accent : t.line,
                      }}
                    >
                      <View
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 999,
                          borderWidth: 2,
                          borderColor: active ? t.accent : t.sub,
                          backgroundColor: active ? t.accent : "transparent",
                        }}
                      />
                      <Text style={[ty.body, { color: t.ink }]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {needsOverride ? (
                <Muted>
                  This claim isn&apos;t in the standard pending state; approving here overrides
                  its current status.
                </Muted>
              ) : null}
            </View>
          ) : null}

          {action ? (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <Field
                label={
                  action === "approve"
                    ? "Note (optional)"
                    : action === "reject"
                      ? "Reason (required, shown to owner)"
                      : "What's needed (required, shown to owner)"
                }
                value={note}
                onChangeText={setNote}
                multiline
                numberOfLines={3}
                placeholder="Add context…"
              />
              <Button
                title={
                  action === "approve"
                    ? "Approve claim"
                    : action === "reject"
                      ? "Reject claim"
                      : "Request more info"
                }
                variant={action === "reject" ? "danger" : "primary"}
                loading={busy}
                onPress={submit}
              />
            </View>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
