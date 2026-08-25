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
import type { HalalHistoryEvent, HalalProfileEmbed, PlaceDetail, SupplierProvenance } from "@/lib/api/types";

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
  DELISTED: "Removed from platform",
  RELISTED: "Re-listed",
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
  DELISTED: "slash",
  RELISTED: "refresh-cw",
};

/** Public-safe labels for a dispute's category, shown on DISPUTE_* rows. */
const DISPUTE_CATEGORY_LABELS: Record<string, string> = {
  PORK_SERVED: "Pork concern",
  ALCOHOL_PRESENT: "Alcohol concern",
  MENU_POSTURE_INCORRECT: "Menu accuracy",
  SLAUGHTER_METHOD_INCORRECT: "Slaughter method",
  CERTIFICATION_INVALID: "Certification",
  PLACE_CLOSED: "Closed",
  OTHER: "Other",
};

/** How a resolved dispute was decided. */
const DISPUTE_OUTCOME_LABELS: Record<string, string> = {
  UPHELD: "upheld",
  DISMISSED: "dismissed",
  WITHDRAWN: "withdrawn",
};

/** The secondary line under a history row's title, when the event carries one:
 *  the public-safe reason for a de-list/re-list, or the category (+ outcome)
 *  behind a dispute. Everything else has no detail line. */
function eventDetail(event: HalalHistoryEvent): string | null {
  const category = event.dispute_category
    ? (DISPUTE_CATEGORY_LABELS[event.dispute_category] ?? event.dispute_category)
    : null;
  switch (event.event_type) {
    case "DELISTED":
    case "RELISTED":
      return event.description ?? null;
    case "DISPUTE_OPENED":
      return category;
    case "DISPUTE_RESOLVED": {
      const outcome = event.dispute_outcome
        ? (DISPUTE_OUTCOME_LABELS[event.dispute_outcome] ?? event.dispute_outcome)
        : null;
      const parts = [category, outcome].filter(Boolean) as string[];
      return parts.length ? parts.join(", ") : (event.description ?? null);
    }
    default:
      return null;
  }
}

function methodLabel(m: string | null | undefined): string | null {
  if (!m || m === "NOT_SERVED") return null;
  // Chicken (hand/machine).
  if (m === "HAND_CUT") return "Hand-slaughtered";
  if (m === "MACHINE_CUT") return "Machine-slaughtered";
  // Served, but the method wasn't confirmed on the visit — surfaced so the
  // consumer knows it's on the menu and can ask staff for the specifics.
  if (m === "NOT_DISCLOSED") return "Method not confirmed";
  // Red meat (zabihah axis).
  if (m === "ZABIHAH") return "Zabihah";
  if (m === "NOT_ZABIHAH") return "Not zabihah";
  if (m === "UNSURE") return "Zabihah status unconfirmed";
  return m.charAt(0) + m.slice(1).toLowerCase().replaceAll("_", " ");
}

const RED_MEATS = new Set(["BEEF", "LAMB", "GOAT"]);
const SOURCING_MEAT_ORDER = ["CHICKEN", "TURKEY", "DUCK", "BEEF", "LAMB", "GOAT", "FISH", "OTHER"];

/** Species-aware label for a per-product method: red meat maps hand/machine to
 *  the zabihah axis; chicken keeps hand/machine (via methodLabel). */
function productMethodText(meatType: string, method: string): string {
  if (RED_MEATS.has(meatType)) {
    if (method === "HAND_CUT" || method === "MACHINE_CUT") return "Zabihah";
    if (method === "NOT_DISCLOSED") return "Zabihah status unconfirmed";
    if (method === "NOT_SERVED") return "Not served";
    return method.charAt(0) + method.slice(1).toLowerCase().replaceAll("_", " ");
  }
  return methodLabel(method) ?? method;
}

function monthYear(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Expanded trust profile — mockup 23. Full per-meat sourcing, kitchen, and
 *  certificate (with View cert). Opened as a full-screen modal from the place
 *  detail's "Details ›". Verification history is its own screen now
 *  (app/place-history/[id]), reached from the place's "Trust history" row. */
export function TrustProfileSheet({
  place,
  onClose,
}: {
  place: PlaceDetail;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const p = place.halal_profile;
  const [certOpen, setCertOpen] = useState(false);
  // History opens as a layer ON TOP of this sheet (both are modals), so
  // backing out of history returns here — the evidence — not to place detail.
  // That preserves the flow the user actually took (place → evidence → history).
  const [historyOpen, setHistoryOpen] = useState(false);

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

  // Carry the raw method through so the pill can tone an unconfirmed meat
  // differently from a confirmed one. NOT_SERVED meats are dropped.
  const meats = (
    [
      ["Chicken", p?.chicken_slaughter],
      ["Beef", p?.beef_zabihah],
      ["Lamb", p?.lamb_zabihah],
      ["Goat", p?.goat_zabihah],
    ] as Array<[string, string | null | undefined]>
  ).filter(([, m]) => m && m !== "NOT_SERVED") as Array<[string, string]>;

  // Meats traced to a registry supplier via a sourcing link. Additive to the
  // per-meat rows above — shows who and how well-evidenced, never re-ranking
  // the method. Self-attested entries are omitted (they're already covered).
  const supplierBacked = (p?.supplier_provenance ?? []).filter(
    (x) => x.source === "supplier",
  );

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

        <ScrollView
          contentContainerStyle={{ paddingTop: space.md, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl }}
        >
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
              {(p.meat_products?.length ?? 0) > 0 ? (
                <GroupedSourcing profile={p} servesPork={servesPork} />
              ) : (
              <>
              {meats.length > 0 || servesPork ? (
                <Section title="Sourcing · per meat">
                  {meats.map(([meat, raw], i) => (
                    <SheetRow
                      key={meat}
                      label={meat}
                      last={!servesPork && i === meats.length - 1}
                      right={
                        <Pill
                          label={(methodLabel(raw) ?? raw).toUpperCase()}
                          tone={raw === "NOT_DISCLOSED" ? "zinc" : "accent"}
                        />
                      }
                    />
                  ))}
                  {servesPork ? (
                    <SheetRow label="Pork" last right={<Pill label="ON THE MENU" tone="danger" />} />
                  ) : null}
                </Section>
              ) : null}

              {supplierBacked.length > 0 ? (
                <Section title="Supplier sourcing">
                  {supplierBacked.map((x, i) => {
                    const attribution =
                      x.confidence === "VERIFIED"
                        ? "verified"
                        : x.confidence === "DOCUMENTED"
                          ? "documented"
                          : p?.owner_attested
                            ? "as stated by owner"
                            : "reported by community";
                    return (
                      <SheetRow
                        key={x.meat_type}
                        label={x.meat_type.charAt(0) + x.meat_type.slice(1).toLowerCase()}
                        last={i === supplierBacked.length - 1}
                        right={
                          // Stack the supplier name over the attribution so a
                          // long "· reported by community" can't run off-screen.
                          <View style={{ flex: 1, alignItems: "flex-end" }}>
                            <Text
                              style={[ty.body, { color: t.ink, fontFamily: "Inter_700Bold", fontSize: 17, textAlign: "right" }]}
                              numberOfLines={2}
                            >
                              {x.supplier_name ?? "Supplier"}
                            </Text>
                            {x.certifying_body_name ? (
                              <Text
                                style={[ty.small, { color: t.sub, fontSize: 12.5, marginTop: 1, textAlign: "right" }]}
                                numberOfLines={2}
                              >
                                Certified by {x.certifying_body_name}
                              </Text>
                            ) : null}
                            <Text style={[ty.small, { color: t.sub, fontSize: 12.5, marginTop: 2, textAlign: "right" }]}>
                              {attribution}
                            </Text>
                          </View>
                        }
                      />
                    );
                  })}
                </Section>
              ) : null}
              </>
              )}

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

          {/* Jump to the full timeline. Opens as a layer on top of this sheet
              (see historyOpen) so backing out returns here, not to place
              detail — the flow the user took was place → evidence → history. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View trust history"
            onPress={() => {
              capture("trust_history_opened", {
                place_id: place.id,
                place_name: place.name,
                from: "profile_sheet",
              });
              setHistoryOpen(true);
            }}
            style={{
              marginTop: 8,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: t.card,
              borderRadius: radii.xl,
              paddingHorizontal: 18,
              paddingVertical: 16,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
              <Feather name="activity" size={18} color={t.accentDeep} />
              <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_600SemiBold", fontSize: 16 }]}>
                View trust history
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={t.sub} />
          </Pressable>
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

      {historyOpen ? (
        <HistorySubSheet place={place} onClose={() => setHistoryOpen(false)} />
      ) : null}
    </Modal>
  );
}

/** The trust-history timeline presented as a slide-in layer on top of the
 *  profile sheet. It's its own modal (over the sheet's modal) so dismissing it
 *  returns to the evidence, not to the place screen — matching the path the
 *  user took to get here. Same chrome as the parent sheet for continuity. */
function HistorySubSheet({ place, onClose }: { place: PlaceDetail; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
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
          <Pressable onPress={handleClose} accessibilityLabel="Back to trust profile" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Feather name="chevron-left" size={20} color={t.sub} />
            <Text numberOfLines={1} style={[ty.label, { color: t.sub, fontSize: 14, flexShrink: 1 }]}>Trust profile</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingTop: space.md, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl }}
        >
          <Text style={[ty.title, { color: t.ink, fontSize: 30, lineHeight: 34, marginTop: 4, marginBottom: space.md }]}>
            Trust history
          </Text>
          <Text style={[ty.body, { color: t.sub, fontSize: 14, marginBottom: space.xl }]}>
            Verifications, disputes and changes over time.
          </Text>
          <HalalHistoryTimeline placeId={place.id} />
        </ScrollView>
      </Animated.View>
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

function provenanceMeatLabel(meat: string): string {
  return meat.charAt(0) + meat.slice(1).toLowerCase();
}

/** Weakest-tier attribution, matching the consumer ConfidenceChip: name the
 *  source when it's only self-stated (owner's word vs. community). */
function attributionLabel(
  confidence: "SELF_STATED" | "DOCUMENTED" | "VERIFIED",
  ownerAttested: boolean,
): string {
  if (confidence === "VERIFIED") return "verified";
  if (confidence === "DOCUMENTED") return "documented";
  return ownerAttested ? "as stated by owner" : "reported by community";
}

// Core meats with a profile column, for the "not served" footnote.
const CORE_MEATS: ReadonlyArray<{ key: string; label: string; col: keyof HalalProfileEmbed }> = [
  { key: "CHICKEN", label: "chicken", col: "chicken_slaughter" },
  { key: "BEEF", label: "beef", col: "beef_zabihah" },
  { key: "LAMB", label: "lamb", col: "lamb_zabihah" },
  { key: "GOAT", label: "goat", col: "goat_zabihah" },
];

/** The single sourcing view: every product the restaurant listed, grouped under
 *  its meat, with the registry-backed cert + confidence on the group header.
 *  Replaces the old per-meat rows + separate composed box, which collapsed
 *  multiple suppliers for one meat (e.g. two beef suppliers) into one row. */
function GroupedSourcing({
  profile,
  servesPork,
}: {
  profile: HalalProfileEmbed;
  servesPork: boolean;
}) {
  const t = useTheme();
  const products = profile.meat_products ?? [];
  const ownerAttested = profile.owner_attested ?? false;

  // Registry-backed signal per meat (a live supplier link composed it).
  const provByMeat = new Map<string, SupplierProvenance>();
  for (const x of profile.supplier_provenance ?? []) {
    if (x.source === "supplier") provByMeat.set(x.meat_type, x);
  }

  const groups = SOURCING_MEAT_ORDER.map((meat) => ({
    meat,
    items: products.filter((pr) => pr.meat_type === meat),
  })).filter((g) => g.items.length > 0);

  // "lamb, goat aren't served here" — core meats with no product and a
  // NOT_SERVED column.
  const absent = CORE_MEATS.filter(
    (m) =>
      String(profile[m.col]) === "NOT_SERVED" &&
      !products.some((pr) => pr.meat_type === m.key),
  ).map((m) => m.label);

  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[ty.seg, { color: t.sub, fontSize: 15, letterSpacing: 0.4, marginBottom: 12, marginLeft: 2 }]}>
        Meat sourcing
      </Text>
      <View style={{ gap: 12 }}>
        {groups.map((g) => {
          const prov = provByMeat.get(g.meat);
          return (
            <View key={g.meat} style={{ backgroundColor: t.card, borderRadius: radii.xl, overflow: "hidden" }}>
              <View
                style={{
                  paddingHorizontal: 18, paddingVertical: 12,
                  borderBottomWidth: 1, borderBottomColor: t.line,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                  <Text style={[ty.seg, { color: t.sub, fontSize: 13, letterSpacing: 0.4 }]}>
                    {provenanceMeatLabel(g.meat)}
                  </Text>
                  {prov ? (
                    <Pill
                      label={attributionLabel(prov.confidence, ownerAttested)}
                      tone={prov.confidence === "VERIFIED" ? "accent" : "zinc"}
                    />
                  ) : null}
                </View>
                {prov?.certifying_body_name ? (
                  <Text style={[ty.small, { color: t.sub, fontSize: 12, marginTop: 4 }]}>
                    certified by {prov.certifying_body_name}
                  </Text>
                ) : null}
              </View>
              {g.items.map((pr, i) => {
                const where = [pr.supplier_city, pr.supplier_state].filter(Boolean).join(", ");
                const supplierLine = [pr.supplier_name, where].filter(Boolean).join(" · ");
                return (
                  <View
                    key={`${pr.product_name}-${i}`}
                    style={{ paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.sm }}>
                      <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_600SemiBold", fontSize: 16, flexShrink: 1 }]} numberOfLines={2}>
                        {pr.product_name}
                      </Text>
                      <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_700Bold", fontSize: 13, textAlign: "right" }]}>
                        {productMethodText(pr.meat_type, pr.slaughter_method)}
                      </Text>
                    </View>
                    {supplierLine ? (
                      <Text style={[ty.small, { color: t.sub, fontSize: 12.5, marginTop: 3 }]}>
                        {supplierLine}
                        {pr.certifying_authority ? ` · certified by ${pr.certifying_authority}` : ""}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>
      {servesPork ? (
        <View style={{ marginTop: 12, backgroundColor: t.card, borderRadius: radii.xl, paddingHorizontal: 18 }}>
          <SheetRow label="Pork" last right={<Pill label="ON THE MENU" tone="danger" />} />
        </View>
      ) : null}
      {absent.length > 0 ? (
        <Text style={[ty.small, { color: t.sub, fontSize: 13, marginTop: 12, marginLeft: 2 }]}>
          {absent.join(", ")} {absent.length === 1 ? "isn't" : "aren't"} served here.
        </Text>
      ) : null}
    </View>
  );
}

/** The verification-history timeline as a self-contained card. Fetches its own
 *  data so it can be dropped anywhere the place id is known — inside the
 *  expanded profile sheet, and on the tombstone screen where it's the only
 *  thing explaining the removal. */
export function HalalHistoryTimeline({ placeId }: { placeId: string }) {
  const t = useTheme();
  const history = useHalalHistory(placeId, true);

  if (history.isLoading) {
    return <Text style={[ty.small, { color: t.sub }]}>Loading…</Text>;
  }
  if ((history.data?.length ?? 0) === 0) {
    return <Text style={[ty.small, { color: t.sub }]}>No recorded changes yet.</Text>;
  }
  return (
    <View style={{ backgroundColor: t.card, borderRadius: radii.xl, paddingHorizontal: 18 }}>
      {history.data!.map((e, i) => (
        <HistoryRow key={i} event={e} last={i === history.data!.length - 1} />
      ))}
    </View>
  );
}

/** One verification-history line: leading avatar (verifier visit) or event
 *  icon, a title (with the handle highlighted for visits), an optional detail
 *  line (de-list reason, dispute category/outcome), and the month on the right
 *  — matching the mockup's card rows. A removal (DELISTED) is drawn in the
 *  danger colour so it never reads as a routine change. */
function HistoryRow({ event, last }: { event: HalalHistoryEvent; last: boolean }) {
  const t = useTheme();
  const isVisit = event.event_type === "VERIFIER_VISIT";
  const isRemoval = event.event_type === "DELISTED";
  const handle = event.actor_handle;
  const initial = (event.actor_display_name ?? event.actor_handle ?? "")
    .trim()
    .replace(/^@/, "")
    .charAt(0)
    .toUpperCase();
  const date = new Date(event.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const detail = eventDetail(event);

  return (
    <View
      style={{
        flexDirection: "row", alignItems: detail ? "flex-start" : "center", gap: 12,
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
        <View style={{ width: 30, alignItems: "center", marginTop: detail ? 1 : 0 }}>
          <Feather name={EVENT_ICONS[event.event_type] ?? "activity"} size={17} color={isRemoval ? t.danger : t.sub} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        {isVisit && handle ? (
          <Text style={[ty.body, { color: t.ink, fontSize: 15 }]}>
            Visit by <Text style={{ color: t.accentDeep, fontFamily: "Inter_700Bold" }}>{handle}</Text>
          </Text>
        ) : (
          <Text
            style={[
              ty.body,
              {
                color: isRemoval ? t.danger : t.ink,
                fontFamily: isRemoval ? "Inter_700Bold" : "Inter_600SemiBold",
                fontSize: 15,
              },
            ]}
          >
            {EVENT_LABELS[event.event_type] ?? event.event_type}
          </Text>
        )}
        {detail ? (
          <Text style={[ty.small, { color: t.sub, fontSize: 13, marginTop: 2, lineHeight: 18 }]}>{detail}</Text>
        ) : null}
      </View>
      <Text style={[ty.small, { color: t.sub, fontSize: 13 }]}>{date}</Text>
    </View>
  );
}
