import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHalalHistory } from "@/lib/api/hooks";
import { capture } from "@/lib/analytics";
import { primaryHalalSignal } from "@/lib/halal-display";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { CertViewer } from "@/components/CertViewer";
import { TierTag } from "@/components/TierTag";
import type { HalalHistoryEvent, PlaceDetail } from "@/lib/api/types";

const TEST_FORCE_PORK = false;

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
  CLAIM_SUBMITTED: "Owner submitted claim",
  CLAIM_APPROVED: "Claim approved",
  VERIFIER_VISIT: "Verified in person",
  PROFILE_CREATED: "Profile created",
  PROFILE_UPDATED: "Profile updated",
  EXPIRED: "Certification expired",
  DISPUTE_OPENED: "Dispute opened",
  DISPUTE_RESOLVED: "Dispute resolved",
  REVOKED: "Revoked",
  RESTORED: "Restored",
};

const EVENT_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  CLAIM_SUBMITTED: "file-plus",
  CLAIM_APPROVED: "check-circle",
  PROFILE_CREATED: "file-text",
  PROFILE_UPDATED: "edit-2",
  EXPIRED: "clock",
  DISPUTE_OPENED: "flag",
  DISPUTE_RESOLVED: "check-circle",
  REVOKED: "x-circle",
  RESTORED: "rotate-ccw",
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
  const [certOpen, setCertOpen] = useState(false);

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

  // Pork is only surfaced when actually served (a red alert), not as a
  // "not served" row on the majority of places.
  const servesPork = TEST_FORCE_PORK || !!p?.has_pork;

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
        {/* Pinned header — stays put while the profile scrolls under it. */}
        <View
          style={{
            paddingTop: insets.top + space.sm,
            paddingBottom: 10,
            paddingHorizontal: space.lg,
            backgroundColor: t.bg,
            borderBottomWidth: 1,
            borderBottomColor: t.line,
          }}
        >
          <Pressable onPress={handleClose} accessibilityLabel="Back" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Feather name="chevron-left" size={20} color={t.sub} />
            <Text numberOfLines={1} style={[ty.label, { color: t.sub, fontSize: 14, flexShrink: 1 }]}>{place.name}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingTop: space.md, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl }}>
          {p ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <TierTag signal={primaryHalalSignal(p)} />
              <Text style={[ty.small, { color: t.sub, fontSize: 13 }]}>since {monthYear(p.last_verified_at)}</Text>
            </View>
          ) : null}
          <Text style={[ty.title, { color: t.ink, fontSize: 30, lineHeight: 34, marginTop: 4, marginBottom: space.xl }]}>
            Trust profile
          </Text>

          {p ? (
            <>
              {meats.length > 0 || servesPork ? (
                <Section title="Sourcing · per meat">
                  {meats.map(([meat, m], i) => (
                    <SheetRow
                      key={meat}
                      label={meat}
                      last={!servesPork && i === meats.length - 1}
                      right={<Pill label={m.toUpperCase()} />}
                    />
                  ))}
                  {servesPork ? (
                    <SheetRow label="Pork" last right={<Pill label="ON THE MENU" tone="danger" />} />
                  ) : null}
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
                      <Text style={[ty.label, { color: t.ink, fontSize: 17 }]}>{p.certifying_body_name ?? "On file"}</Text>
                      {p.certificate_expires_at ? (
                        <Text style={[ty.small, { color: t.sub, fontSize: 13, marginTop: 3 }]}>
                          expires {new Date(p.certificate_expires_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                        </Text>
                      ) : null}
                    </View>
                    {p.certificate_url ? (
                      <Pressable
                        onPress={() => {
                          capture("certificate_viewed", { place_id: place.id, place_name: place.name });
                          setCertOpen(true);
                        }}
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

          <Text style={[ty.seg, { color: t.sub, fontSize: 15, letterSpacing: 0.4, marginBottom: 12, marginLeft: 2 }]}>Verification history</Text>
          {history.isLoading ? (
            <Text style={[ty.small, { color: t.sub }]}>Loading…</Text>
          ) : (history.data?.length ?? 0) === 0 ? (
            <Text style={[ty.small, { color: t.sub }]}>No recorded changes yet.</Text>
          ) : (
            <View style={{ backgroundColor: t.card, borderRadius: radii.xl, paddingHorizontal: 18 }}>
              {history.data!.map((e, i) => (
                <HistoryRow key={i} event={e} last={i === history.data!.length - 1} />
              ))}
            </View>
          )}
        </ScrollView>
      </Animated.View>

      {certOpen && p?.certificate_url ? (
        <CertViewer
          url={p.certificate_url}
          contentType={p.certificate_content_type}
          title={p.certifying_body_name ?? "Certificate"}
          subtitle={
            p.certificate_expires_at
              ? `Expires ${new Date(p.certificate_expires_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`
              : "No expiry on file"
          }
          onClose={() => setCertOpen(false)}
        />
      ) : null}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[ty.seg, { color: t.sub, fontSize: 15, letterSpacing: 0.4, marginBottom: 12, marginLeft: 2 }]}>{title}</Text>
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
      <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_600SemiBold", fontSize: 17 }]}>{label}</Text>
      {right}
    </View>
  );
}

function Value({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_700Bold", fontSize: 17 }]}>{text}</Text>;
}

function Pill({ label, tone = "accent" }: { label: string; tone?: "accent" | "zinc" | "danger" }) {
  const t = useTheme();
  const bg = tone === "danger" ? t.dangerSoft : tone === "zinc" ? t.zincSoft : t.accentSoft;
  const fg = tone === "danger" ? t.danger : tone === "zinc" ? t.zinc : t.accentDeep;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 }}>
      <Text style={{ color: fg, fontFamily: "Inter_700Bold", fontSize: 12.5, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

/** One verification-history line: leading avatar (verifier visit) or event
 *  icon, a title (with the handle highlighted for visits), and the month on
 *  the right — matching the mockup's card rows. */
function HistoryRow({ event, last }: { event: HalalHistoryEvent; last: boolean }) {
  const t = useTheme();
  const isVisit = event.event_type === "VERIFIER_VISIT";
  const handle = event.actor_handle;
  const initial = (event.actor_display_name ?? event.actor_handle ?? "")
    .trim()
    .replace(/^@/, "")
    .charAt(0)
    .toUpperCase();
  const date = new Date(event.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" });

  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center", gap: 12,
        paddingVertical: 15, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.line,
      }}
    >
      {isVisit ? (
        <View style={{ width: 30, height: 30, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
          {initial ? (
            <Text style={{ color: t.onAccent, fontFamily: "Inter_800ExtraBold", fontSize: 13 }}>{initial}</Text>
          ) : (
            <Feather name="check" size={15} color={t.onAccent} />
          )}
        </View>
      ) : (
        <View style={{ width: 30, alignItems: "center" }}>
          <Feather name={EVENT_ICONS[event.event_type] ?? "activity"} size={17} color={t.sub} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        {isVisit && handle ? (
          <Text style={[ty.body, { color: t.ink, fontSize: 15 }]}>
            Visit by <Text style={{ color: t.accentDeep, fontFamily: "Inter_700Bold" }}>{handle}</Text>
          </Text>
        ) : (
          <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_600SemiBold", fontSize: 15 }]}>
            {EVENT_LABELS[event.event_type] ?? event.event_type}
          </Text>
        )}
      </View>
      <Text style={[ty.small, { color: t.sub, fontSize: 13 }]}>{date}</Text>
    </View>
  );
}
