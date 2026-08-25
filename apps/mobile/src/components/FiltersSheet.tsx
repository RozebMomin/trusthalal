import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "./Button";
import { OptionCard } from "./SearchDefaultDetail";
import { Sheet } from "@/ui/kit";
import type {
  SearchPlacesParams,
  SlaughterMethod,
  ValidationTier,
} from "@/lib/api/types";

type MCIName = keyof typeof MaterialCommunityIcons.glyphMap;

const POSTURES = [
  { v: "FULLY_HALAL", label: "Fully halal" },
  { v: "MIXED_SEPARATE_KITCHENS", label: "Separate kitchen" },
  { v: "HALAL_OPTIONS_ADVERTISED", label: "Halal options" },
  { v: "HALAL_UPON_REQUEST", label: "On request" },
] as const;

/** Per-meat filter fields. Chicken uses hand/machine; red meat uses a zabihah
 *  toggle plus an "include unsure" add-on. */
type MeatFilterField = "chicken_slaughter" | "beef_zabihah" | "lamb_zabihah" | "goat_zabihah";

const MEAT_FILTERS: ReadonlyArray<{ field: MeatFilterField; label: string; icon: MCIName; red: boolean }> = [
  { field: "chicken_slaughter", label: "Chicken", icon: "food-drumstick-outline", red: false },
  { field: "beef_zabihah", label: "Beef", icon: "cow", red: true },
  { field: "lamb_zabihah", label: "Lamb", icon: "sheep", red: true },
  { field: "goat_zabihah", label: "Goat", icon: "food-steak", red: true },
];

/** Family-amenity priority boosts. NOT restrictive — these re-rank rather than
 *  filter, so they're kept out of countFilters and given a distinct section. */
const AMENITY_BOOSTS: ReadonlyArray<{ value: string; label: string; icon: MCIName }> = [
  { value: "PRAYER_SPACE", label: "Prayer space", icon: "mosque" },
  { value: "WUDU", label: "Wudu area", icon: "water-outline" },
  { value: "BIDET", label: "Bidet", icon: "toilet" },
  { value: "BABY_CHANGING", label: "Baby changing", icon: "baby-carriage" },
];

const TIER_LABEL: Record<string, string> = {
  TRUST_HALAL_VERIFIED: "Verified",
  CERTIFICATE_ON_FILE: "Certified",
};
function tierLabel(v: ValidationTier | undefined | null): string {
  return v ? (TIER_LABEL[v] ?? "Any claim") : "Any claim";
}

export type Filters = Pick<
  SearchPlacesParams,
  | "min_validation_tier"
  | "min_menu_posture"
  | "no_pork"
  | "no_alcohol_served"
  | "has_certification"
  | "open_now"
  | "chicken_slaughter"
  | "beef_zabihah"
  | "lamb_zabihah"
  | "goat_zabihah"
  | "boost_amenities"
>;

export function countFilters(f: Filters) {
  let n = [f.min_validation_tier, f.min_menu_posture, f.no_pork, f.no_alcohol_served, f.has_certification, f.open_now].filter(Boolean).length;
  for (const { field } of MEAT_FILTERS) n += f[field]?.length ?? 0;
  // boost_amenities is intentionally NOT counted — it re-ranks, never removes.
  return n;
}

export function FiltersSheet({
  visible,
  onClose,
  filters,
  onChange,
  resultCount,
}: {
  visible: boolean;
  onClose: () => void;
  filters: Filters;
  onChange: (f: Filters) => void;
  resultCount?: number;
}) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  const scrollMax = Math.round(height * 0.72);
  const [trustOpen, setTrustOpen] = useState(false);

  const setField = (field: MeatFilterField, value: string[] | undefined) =>
    onChange({ ...filters, [field]: value } as Filters);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: space.md }}>
        <Text style={[ty.h2, { color: t.ink }]}>Filters</Text>
        <Pressable onPress={() => onChange({})}>
          <Text style={[ty.small, { color: t.accentDeep, fontFamily: "Inter_700Bold" }]}>Reset</Text>
        </Pressable>
      </View>
      <ScrollView style={{ maxHeight: scrollMax }} showsVerticalScrollIndicator contentContainerStyle={{ paddingBottom: space.md }}>
        {/* Trust level — a summary card that opens the full picker. */}
        <Pressable
          onPress={() => setTrustOpen(true)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: t.accentSoft,
            borderRadius: radii.xl,
            padding: 16,
            marginBottom: space.lg,
          }}
        >
          <MaterialCommunityIcons name="shield-check" size={30} color={t.accentDeep} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 15.5 }}>
              Showing places that are{" "}
              <Text style={{ color: t.accentDeep }}>{tierLabel(filters.min_validation_tier)}</Text>
            </Text>
            <Text style={[ty.small, { color: t.sub, fontSize: 13, marginTop: 2 }]}>
              Change your minimum proof level
            </Text>
          </View>
          <Feather name="chevron-right" size={22} color={t.sub} />
        </Pressable>

        {/* Availability */}
        <Text style={[ty.seg, { color: t.sub, marginBottom: 8 }]}>Availability</Text>
        <Pressable
          onPress={() => onChange({ ...filters, open_now: filters.open_now ? undefined : true })}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: t.card,
            borderRadius: radii.xl,
            padding: 14,
          }}
        >
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
            <Feather name="clock" size={20} color={t.accentDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: t.ink }}>Places Open Now</Text>
          </View>
          <Switch
            value={!!filters.open_now}
            onValueChange={(v) => onChange({ ...filters, open_now: v ? true : undefined })}
            trackColor={{ true: t.accent, false: t.line }}
            accessibilityLabel="Open now"
          />
        </Pressable>

        {/* Menu coverage — single-select */}
        <Text style={[ty.seg, { color: t.sub, marginTop: space.lg, marginBottom: 8 }]}>Menu coverage</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {POSTURES.map((o) => {
            const on = filters.min_menu_posture === o.v;
            return <Chip key={o.v} on={on} label={o.label} onPress={() => onChange({ ...filters, min_menu_posture: on ? undefined : o.v })} />;
          })}
        </View>

        {/* Dietary — multi */}
        <Text style={[ty.seg, { color: t.sub, marginTop: space.lg, marginBottom: 8 }]}>Dietary</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Chip on={!!filters.no_pork} label="Pork-free" onPress={() => onChange({ ...filters, no_pork: filters.no_pork ? undefined : true })} />
          <Chip on={!!filters.no_alcohol_served} label="No alcohol served" onPress={() => onChange({ ...filters, no_alcohol_served: filters.no_alcohol_served ? undefined : true })} />
          <Chip on={!!filters.has_certification} label="Certificate on file" onPress={() => onChange({ ...filters, has_certification: filters.has_certification ? undefined : true })} />
        </View>

        {/* Meat preferences — per-meat cards with a segmented control */}
        <Text style={[ty.seg, { color: t.sub, marginTop: space.lg, marginBottom: 4 }]}>Meat preferences</Text>
        <Text style={[ty.small, { color: t.sub, marginBottom: 10 }]}>Choose how you want each type of meat to be prepared.</Text>
        <View style={{ backgroundColor: t.card, borderRadius: radii.xl, overflow: "hidden" }}>
          {MEAT_FILTERS.map(({ field, label, icon, red }, i) => {
            const selected = (filters[field] as string[] | undefined) ?? [];
            const zab = selected.includes("ZABIHAH");
            const unsure = selected.includes("UNSURE");
            return (
              <View key={field} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line, padding: 14, gap: 10 }}>
                {/* icon → label → selector, all inline */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
                    <MaterialCommunityIcons name={icon} size={18} color={t.accentDeep} />
                  </View>
                  <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 14, width: 52 }}>{label}</Text>
                  <View style={{ flex: 1 }}>
                    {red ? (
                      <Segmented
                        options={[
                          { key: "", label: "Any" },
                          { key: "ZABIHAH", label: "Zabihah" },
                        ]}
                        value={zab ? "ZABIHAH" : ""}
                        onSelect={(k) => setField(field, k ? (unsure ? ["ZABIHAH", "UNSURE"] : ["ZABIHAH"]) : undefined)}
                      />
                    ) : (
                      <Segmented
                        options={[
                          { key: "", label: "Any" },
                          { key: "HAND_CUT", label: "Hand-cut" },
                          { key: "MACHINE_CUT", label: "Machine-cut" },
                        ]}
                        value={selected[0] ?? ""}
                        onSelect={(k) => setField(field, k ? [k] : undefined)}
                      />
                    )}
                  </View>
                </View>
                {/* Include-unsure add-on stays subordinate, below the row */}
                {red && zab ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: unsure }}
                    onPress={() => setField(field, unsure ? ["ZABIHAH"] : ["ZABIHAH", "UNSURE"])}
                    style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 44 }}
                  >
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        borderWidth: unsure ? 0 : 1.5,
                        borderColor: t.line,
                        backgroundColor: unsure ? t.accent : "transparent",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {unsure ? <Feather name="check" size={13} color={t.onAccent} /> : null}
                    </View>
                    <Text style={{ color: t.sub, fontFamily: "Inter_500Medium", fontSize: 12, flex: 1, lineHeight: 16 }}>
                      Include unconfirmed zabihah status
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>

        {/* Prioritize for families — re-ranks, doesn't filter */}
        <View
          style={{
            marginTop: space.lg,
            backgroundColor: t.accentSoft,
            borderRadius: radii.xl,
            borderWidth: 1,
            borderColor: t.accent,
            padding: 14,
          }}
        >
          <Text style={[ty.seg, { color: t.accentDeep, marginBottom: 4 }]}>Prioritize for families</Text>
          <Text style={[ty.small, { color: t.sub, marginBottom: 10 }]}>Bubbles these up first — doesn&apos;t hide other places.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {AMENITY_BOOSTS.map((amenity) => {
              const selected = filters.boost_amenities ?? [];
              const on = selected.includes(amenity.value);
              return (
                <Chip
                  key={amenity.value}
                  on={on}
                  accent
                  icon={amenity.icon}
                  label={amenity.label}
                  onPress={() => {
                    const next = on ? selected.filter((v) => v !== amenity.value) : [...selected, amenity.value];
                    onChange({ ...filters, boost_amenities: next.length ? next : undefined });
                  }}
                />
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={{ paddingTop: space.md, marginTop: 2, borderTopWidth: 1, borderTopColor: t.line }}>
        <Button title={resultCount !== undefined ? `Show ${resultCount} places` : "Done"} onPress={onClose} />
      </View>

      <TrustDetail
        open={trustOpen}
        value={filters.min_validation_tier ?? undefined}
        onSelect={(v) => onChange({ ...filters, min_validation_tier: v })}
        onClose={() => setTrustOpen(false)}
      />
    </Sheet>
  );
}

/** A segmented single-select control. Selected segment fills with ink. */
function Segmented({
  options,
  value,
  onSelect,
}: {
  options: ReadonlyArray<{ key: string; label: string }>;
  value: string;
  onSelect: (key: string) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: t.zincSoft, borderRadius: 999, padding: 3 }}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable
            key={o.key || "any"}
            onPress={() => onSelect(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 999, backgroundColor: on ? t.ink : "transparent", alignItems: "center" }}
          >
            <Text style={{ color: on ? t.onInk : t.ink, fontFamily: on ? "Inter_700Bold" : "Inter_600SemiBold", fontSize: 12 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Full-screen trust-level picker, reusing the shared OptionCard so it matches
 *  the Search-defaults trust page. Applies live to the sheet's filters. */
function TrustDetail({
  open,
  value,
  onSelect,
  onClose,
}: {
  open: boolean;
  value: ValidationTier | undefined;
  onSelect: (v: ValidationTier | undefined) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tx = useRef(new Animated.Value(60)).current;
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (open) {
      tx.setValue(60);
      op.setValue(0);
      Animated.parallel([
        Animated.timing(tx, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    }
  }, [open, tx, op]);

  if (!open) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: t.bg, opacity: op, transform: [{ translateX: tx }] }}>
        <View style={{ flex: 1, paddingTop: insets.top + space.md }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + 24, gap: 12 }}>
            <Pressable onPress={onClose} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}>
              <Feather name="chevron-left" size={20} color={t.accentDeep} />
              <Text style={[ty.label, { color: t.accentDeep, fontSize: 15 }]}>Filters</Text>
            </Pressable>
            <Text style={[ty.title, { color: t.ink, fontSize: 28, lineHeight: 32, marginTop: 6 }]}>Minimum proof</Text>
            <Text style={[ty.small, { color: t.sub, fontSize: 14, lineHeight: 20, marginBottom: 4 }]}>
              Choose the minimum level of proof you want to see in your results.
            </Text>

            <View style={{ gap: 8 }}>
              <OptionCard
                icon="shield-check"
                title="Verified"
                recommended
                desc="Only show places verified in person by a Trust Halal community member."
                tag="Highest trust"
                tagIcon="account-group"
                kind="radio"
                on={value === "TRUST_HALAL_VERIFIED"}
                onPress={() => onSelect("TRUST_HALAL_VERIFIED")}
              />
              <OptionCard
                icon="certificate"
                title="Certified"
                desc="Only show places with a valid halal certificate from a recognized certifying body."
                tag="Third-party certified"
                tagIcon="shield-check-outline"
                kind="radio"
                on={value === "CERTIFICATE_ON_FILE"}
                onPress={() => onSelect("CERTIFICATE_ON_FILE")}
              />
              <OptionCard
                icon="magnify"
                title="Any claim"
                desc="Show all places with any halal claim, including self-attested."
                tag="Most results"
                tagIcon="information-outline"
                kind="radio"
                on={!value}
                onPress={() => onSelect(undefined)}
              />
            </View>
          </ScrollView>

          <View
            style={{
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: insets.bottom + space.sm,
              borderTopWidth: 1,
              borderTopColor: t.line,
            }}
          >
            <Button title="Done" variant="accent" onPress={onClose} />
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

function Chip({
  on,
  label,
  onPress,
  accent,
  icon,
}: {
  on: boolean;
  label: string;
  onPress: () => void;
  /** When selected, fill with the brand emerald instead of ink. */
  accent?: boolean;
  icon?: MCIName;
}) {
  const t = useTheme();
  const onBg = accent ? t.accent : t.ink;
  const onFg = accent ? t.onAccent : t.onInk;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: on ? onBg : "transparent",
        borderWidth: 1,
        borderColor: on ? onBg : t.line,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 8,
      }}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={15} color={on ? onFg : t.accentDeep} /> : null}
      <Text style={{ color: on ? onFg : t.ink, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}
