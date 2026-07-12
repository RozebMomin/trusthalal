import { Feather } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, Easing, Linking, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHalalHistory } from "@/lib/api/hooks";
import { primaryHalalSignal } from "@/lib/halal-display";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { TierTag } from "@/components/TierTag";
import type { PlaceDetail } from "@/lib/api/types";

const POSTURE_LABELS: Record<string, string> = {
  FULLY_HALAL: "Fully halal",
  MIXED_SEPARATE_KITCHENS: "Separate kitchen",
  HALAL_OPTIONS_ADVERTISED: "Halal options",
  HALAL_UPON_REQUEST: "On request",
  MIXED_SHARED_KITCHEN: "Shared kitchen",
};

const ALCOHOL_LABELS: Record<string, string> = {
  NONE: "None",
  BEER_AND_WINE_ONLY: "Beer & wine",
  FULL_BAR: "Full bar",
};

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Profile created",
  UPDATED: "Profile updated",
  EXPIRED: "Certification expired",
  DISPUTE_OPENED: "Dispute opened",
  DISPUTE_RESOLVED: "Dispute resolved",
  REVOKED: "Revoked",
  RESTORED: "Restored",
  VERIFIER_VISIT_ACCEPTED: "Verified in person",
};

function methodLabel(m: string | null | undefined): string | null {
  if (!m || m === "NOT_SERVED") return null;
  if (m === "ZABIHAH") return "Zabihah";
  if (m === "MACHINE") return "Machine";
  return m.charAt(0) + m.slice(1).toLowerCase().replaceAll("_", " ");
}

function monthYear(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Expanded trust profile — mockup 23. Full per-meat sourcing, kitchen,
 *  certificate (with View cert), and verification history. Opened as a
 *  full-screen modal from the place detail's "Details ›". */
export function TrustProfileSheet({ place, onClose }: { place: PlaceDetail; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const p = place.halal_profile;
  const history = useHalalHistory(place.id, true);

  // Slide in from the right (a push, matching the "Details ›" arrow), and
  // slide back out before unmounting. Modal itself is instant + transparent;
  // the panel carries the motion so the detail screen shows behind it.
  const { width } = useWindowDimensions();
  const tx = useRef(new Animated.Value(width)).current;
  useEffect(() => {
    Animated.timing(tx, {
      toValue: 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [tx]);
  const handleClose = () => {
    Animated.timing(tx, {
      toValue: width,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onClose());
  };

  const meats = [
    ["Chicken", methodLabel(p?.chicken_slaughter)],
    ["Beef", methodLabel(p?.beef_slaughter)],
    ["Lamb", methodLabel(p?.lamb_slaughter)],
    ["Goat", methodLabel(p?.goat_slaughter)],
  ].filter(([, m]) => m) as Array<[string, string]>;

  return (
    <Modal visible transparent animationType="none" onRequestClose={handleClose} statusBarTranslucent>
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: t.bg,
          transform: [{ translateX: tx }],
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 14,
          shadowOffset: { width: -4, height: 0 },
        }}
      >
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl }}>
          <Pressable onPress={handleClose} accessibilityLabel="Back" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: space.md }}>
            <Feather name="chevron-left" size={18} color={t.sub} />
            <Text numberOfLines={1} style={[ty.label, { color: t.sub, fontSize: 13, flexShrink: 1 }]}>{place.name}</Text>
          </Pressable>

          {p ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <TierTag signal={primaryHalalSignal(p)} />
              <Text style={[ty.small, { color: t.sub }]}>since {monthYear(p.last_verified_at)}</Text>
            </View>
          ) : null}
          <Text style={[ty.title, { color: t.ink, fontSize: 28, lineHeight: 32, marginTop: 4, marginBottom: space.xl }]}>
            Trust profile
          </Text>

          {p ? (
            <>
              {meats.length > 0 ? (
                <Section title="Sourcing · per meat">
                  {meats.map(([meat, m], i) => (
                    <SheetRow key={meat} label={meat} last={i === meats.length - 1 && !p.has_pork}
                      right={<Pill label={m.toUpperCase()} />} />
                  ))}
                  <SheetRow label="Pork" last right={<Pill label={p.has_pork ? "ON THE MENU" : "NOT SERVED"} tone={p.has_pork ? "danger" : "zinc"} />} />
                </Section>
              ) : null}

              <Section title="Kitchen">
                <SheetRow label="Menu coverage" right={<Value text={POSTURE_LABELS[p.menu_posture] ?? p.menu_posture} />} />
                <SheetRow label="Alcohol served" right={<Value text={p.alcohol_policy ? (ALCOHOL_LABELS[p.alcohol_policy] ?? p.alcohol_policy) : "Unknown"} />} />
                <SheetRow label="Alcohol in cooking" last right={<Value text={p.alcohol_in_cooking ? "Yes" : "No"} />} />
              </Section>

              {p.has_certification ? (
                <Section title="Certificate">
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingVertical: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[ty.label, { color: t.ink, fontSize: 16 }]}>{p.certifying_body_name ?? "On file"}</Text>
                      {p.certificate_expires_at ? (
                        <Text style={[ty.small, { color: t.sub, marginTop: 3 }]}>
                          expires {new Date(p.certificate_expires_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                        </Text>
                      ) : null}
                    </View>
                    {p.certificate_url ? (
                      <Pressable
                        onPress={() => Linking.openURL(p.certificate_url as string)}
                        style={{ backgroundColor: t.bg, borderRadius: 999, borderWidth: 1, borderColor: t.line, paddingHorizontal: 18, paddingVertical: 10 }}
                      >
                        <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 13 }}>View cert</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </Section>
              ) : null}
            </>
          ) : (
            <Text style={[ty.body, { color: t.sub }]}>No halal profile yet.</Text>
          )}

          <Text style={[ty.seg, { color: t.sub, marginBottom: 12, marginLeft: 2 }]}>Verification history</Text>
          {history.isLoading ? (
            <Text style={[ty.small, { color: t.sub }]}>Loading…</Text>
          ) : (history.data?.length ?? 0) === 0 ? (
            <Text style={[ty.small, { color: t.sub }]}>No recorded changes yet.</Text>
          ) : (
            <View>
              {history.data!.map((e, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 12, paddingVertical: 12 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: t.accent, marginTop: 5 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[ty.label, { color: t.ink, fontSize: 15 }]}>{EVENT_LABELS[e.event_type] ?? e.event_type}</Text>
                    {e.description ? <Text style={[ty.small, { color: t.sub, marginTop: 3, lineHeight: 18 }]}>{e.description}</Text> : null}
                    <Text style={[ty.small, { color: t.sub, marginTop: 4, fontSize: 11 }]}>
                      {new Date(e.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[ty.seg, { color: t.sub, marginBottom: 11, marginLeft: 2 }]}>{title}</Text>
      <View style={{ backgroundColor: t.card, borderRadius: radii.xl, paddingHorizontal: 18, paddingVertical: 6 }}>
        {children}
      </View>
    </View>
  );
}

function SheetRow({ label, right, last }: { label: string; right: React.ReactNode; last?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingVertical: 18, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.line, gap: space.md,
      }}
    >
      <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_600SemiBold", fontSize: 16 }]}>{label}</Text>
      {right}
    </View>
  );
}

function Value({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_700Bold", fontSize: 16 }]}>{text}</Text>;
}

function Pill({ label, tone = "accent" }: { label: string; tone?: "accent" | "zinc" | "danger" }) {
  const t = useTheme();
  const bg = tone === "danger" ? t.dangerSoft : tone === "zinc" ? t.zincSoft : t.accentSoft;
  const fg = tone === "danger" ? t.danger : tone === "zinc" ? t.zinc : t.accentDeep;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 }}>
      <Text style={{ color: fg, fontFamily: "Inter_700Bold", fontSize: 11.5, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}
