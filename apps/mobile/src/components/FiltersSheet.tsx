import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "./Button";
import { Sheet } from "@/ui/kit";
import type { SearchPlacesParams, SlaughterMethod, ValidationTier } from "@/lib/api/types";

const TIERS: Array<{ v: ValidationTier | undefined; label: string }> = [
  { v: undefined, label: "Any claim" },
  { v: "CERTIFICATE_ON_FILE", label: "Certified" },
  { v: "TRUST_HALAL_VERIFIED", label: "✓ Verified" },
];
const POSTURES = [
  { v: "FULLY_HALAL", label: "Fully halal" },
  { v: "MIXED_SEPARATE_KITCHENS", label: "Separate kitchen" },
  { v: "HALAL_OPTIONS_ADVERTISED", label: "Halal options" },
  { v: "HALAL_UPON_REQUEST", label: "On request" },
] as const;

/** Per-meat filter fields carried on Filters. Chicken uses hand/machine; red
 *  meat uses a zabihah toggle plus an "include unsure" option. */
type MeatFilterField =
  | "chicken_slaughter"
  | "beef_zabihah"
  | "lamb_zabihah"
  | "goat_zabihah";

const CHICKEN_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "HAND_CUT", label: "Hand-cut" },
  { value: "MACHINE_CUT", label: "Machine-cut" },
];
const ZABIHAH_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "ZABIHAH", label: "Zabihah" },
  { value: "UNSURE", label: "Include unsure" },
];

const MEAT_FILTERS: ReadonlyArray<{
  field: MeatFilterField;
  label: string;
  choices: ReadonlyArray<{ value: string; label: string }>;
}> = [
  { field: "chicken_slaughter", label: "Chicken", choices: CHICKEN_CHOICES },
  { field: "beef_zabihah", label: "Beef", choices: ZABIHAH_CHOICES },
  { field: "lamb_zabihah", label: "Lamb", choices: ZABIHAH_CHOICES },
  { field: "goat_zabihah", label: "Goat", choices: ZABIHAH_CHOICES },
];

/** Family-amenity priority boosts. NOT restrictive — these re-rank rather than
 *  filter, so they're deliberately kept out of countFilters and given a
 *  distinct "prioritize" section. */
const AMENITY_BOOSTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "PRAYER_SPACE", label: "Prayer space" },
  { value: "WUDU", label: "Wudu area" },
  { value: "BIDET", label: "Bidet" },
  { value: "BABY_CHANGING", label: "Baby changing" },
];

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
  // Each selected slaughter method is its own restrictive constraint.
  for (const { field } of MEAT_FILTERS) n += f[field]?.length ?? 0;
  // boost_amenities is intentionally NOT counted — it re-ranks, never removes,
  // so it must not inflate a badge that reads as "things are being filtered out".
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
  // Give the scroller most of the screen so the sheet reads as near-full-height
  // — the old fixed 520 hid the newer sections with no hint they were there.
  const scrollMax = Math.round(height * 0.72);
  return (
    <Sheet visible={visible} onClose={onClose}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: space.md }}>
          <Text style={[ty.h2, { color: t.ink }]}>Filters</Text>
          <Pressable onPress={() => onChange({})}>
            <Text style={[ty.small, { color: t.accentDeep, fontFamily: "Inter_700Bold" }]}>Reset</Text>
          </Pressable>
        </View>
        <ScrollView
          style={{ maxHeight: scrollMax }}
          showsVerticalScrollIndicator
          contentContainerStyle={{ paddingBottom: space.md }}
        >
          <Text style={[ty.seg, { color: t.sub, marginBottom: 8 }]}>Availability</Text>
          <Pressable
            onPress={() => onChange({ ...filters, open_now: filters.open_now ? undefined : true })}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: filters.open_now ? "rgba(22,163,74,0.12)" : "transparent",
              borderWidth: 1,
              borderColor: filters.open_now ? "#16A34A" : t.line,
              borderRadius: radii.md,
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <View>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: t.ink }}>Open now</Text>
              <Text style={[ty.small, { color: t.sub, marginTop: 2 }]}>
                Only show places confirmed open right now.
              </Text>
            </View>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: filters.open_now ? "#16A34A" : "transparent",
                borderWidth: filters.open_now ? 0 : 1.5,
                borderColor: t.line,
              }}
            >
              {filters.open_now ? (
                <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 12 }}>✓</Text>
              ) : null}
            </View>
          </Pressable>

          <Text style={[ty.seg, { color: t.sub, marginTop: space.lg, marginBottom: 8 }]}>Minimum proof</Text>
          <View style={{ flexDirection: "row", backgroundColor: t.zincSoft, borderRadius: radii.md, padding: 3 }}>
            {TIERS.map((o) => {
              const on = filters.min_validation_tier === o.v;
              return (
                <Pressable
                  key={o.label}
                  onPress={() => onChange({ ...filters, min_validation_tier: o.v })}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: 11, backgroundColor: on ? t.card : "transparent", alignItems: "center" }}
                >
                  <Text style={{ fontFamily: on ? "Inter_700Bold" : "Inter_600SemiBold", fontSize: 11, color: on ? t.ink : t.sub }}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[ty.small, { color: t.sub, marginTop: 6 }]}>
            Verified = a Trust Halal community member ate there and confirmed it in person.
          </Text>

          <Text style={[ty.seg, { color: t.sub, marginTop: space.lg, marginBottom: 8 }]}>Menu coverage</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {POSTURES.map((o) => {
              const on = filters.min_menu_posture === o.v;
              return (
                <Chip key={o.v} on={on} label={o.label} onPress={() => onChange({ ...filters, min_menu_posture: on ? undefined : o.v })} />
              );
            })}
          </View>

          <Text style={[ty.seg, { color: t.sub, marginTop: space.lg, marginBottom: 8 }]}>Dietary</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Chip on={!!filters.no_pork} label="Pork-free" onPress={() => onChange({ ...filters, no_pork: filters.no_pork ? undefined : true })} />
            <Chip on={!!filters.no_alcohol_served} label="No alcohol served" onPress={() => onChange({ ...filters, no_alcohol_served: filters.no_alcohol_served ? undefined : true })} />
            <Chip on={!!filters.has_certification} label="Certificate on file" onPress={() => onChange({ ...filters, has_certification: filters.has_certification ? undefined : true })} />
          </View>

          <Text style={[ty.seg, { color: t.sub, marginTop: space.lg, marginBottom: 4 }]}>Meat</Text>
          <Text style={[ty.small, { color: t.sub, marginBottom: 10 }]}>
            Chicken filters by hand vs machine. Beef, lamb and goat filter by zabihah — add &ldquo;Include unsure&rdquo; to also show unconfirmed places.
          </Text>
          <View style={{ gap: 10 }}>
            {MEAT_FILTERS.map(({ field, label, choices }) => {
              const selected = (filters[field] as string[] | undefined) ?? [];
              return (
                <View key={field} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <Text style={{ width: 58, color: t.ink, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>{label}</Text>
                  {choices.map((choice) => {
                    const on = selected.includes(choice.value);
                    return (
                      <Chip
                        key={choice.value}
                        on={on}
                        label={choice.label}
                        onPress={() => {
                          const next = on
                            ? selected.filter((v) => v !== choice.value)
                            : [...selected, choice.value];
                          onChange({ ...filters, [field]: next.length ? next : undefined });
                        }}
                      />
                    );
                  })}
                </View>
              );
            })}
          </View>

          {/* Distinct "prioritize" section — these RE-RANK, they never remove a
              place, so they get a tinted card, their own copy, and (via
              countFilters) stay out of the active-filter count. */}
          <View
            style={{
              marginTop: space.lg,
              backgroundColor: t.accentSoft,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: t.accent,
              padding: 14,
            }}
          >
            <Text style={[ty.seg, { color: t.accentDeep, marginBottom: 4 }]}>Prioritize for families</Text>
            <Text style={[ty.small, { color: t.sub, marginBottom: 10 }]}>
              Bubbles these up first — doesn&apos;t hide other places.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {AMENITY_BOOSTS.map((amenity) => {
                const selected = filters.boost_amenities ?? [];
                const on = selected.includes(amenity.value);
                return (
                  <Chip
                    key={amenity.value}
                    on={on}
                    accent
                    label={amenity.label}
                    onPress={() => {
                      const next = on
                        ? selected.filter((v) => v !== amenity.value)
                        : [...selected, amenity.value];
                      onChange({ ...filters, boost_amenities: next.length ? next : undefined });
                    }}
                  />
                );
              })}
            </View>
          </View>

        </ScrollView>

        {/* Pinned footer — always visible below the scroller, so the CTA is
            never hidden and the sheet's bottom edge is unmistakable (the
            content above it scrolls). */}
        <View style={{ paddingTop: space.md, marginTop: 2, borderTopWidth: 1, borderTopColor: t.line }}>
          <Button title={resultCount !== undefined ? `Show ${resultCount} places` : "Done"} onPress={onClose} />
        </View>
    </Sheet>
  );
}

function Chip({
  on,
  label,
  onPress,
  accent,
}: {
  on: boolean;
  label: string;
  onPress: () => void;
  /** When selected, fill with the brand emerald instead of ink — used by the
   *  non-restrictive "prioritize" boosts so they read apart from filters. */
  accent?: boolean;
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
        backgroundColor: on ? onBg : "transparent",
        borderWidth: 1,
        borderColor: on ? onBg : t.line,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: on ? onFg : t.ink, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}
