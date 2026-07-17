import { Pressable, ScrollView, Text, View } from "react-native";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "./Button";
import { Sheet } from "@/ui/kit";
import type { SearchPlacesParams, ValidationTier } from "@/lib/api/types";

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

export type Filters = Pick<
  SearchPlacesParams,
  | "min_validation_tier"
  | "min_menu_posture"
  | "no_pork"
  | "no_alcohol_served"
  | "has_certification"
  | "open_now"
>;

export function countFilters(f: Filters) {
  return [f.min_validation_tier, f.min_menu_posture, f.no_pork, f.no_alcohol_served, f.has_certification, f.open_now].filter(Boolean).length;
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
  return (
    <Sheet visible={visible} onClose={onClose}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: space.md }}>
          <Text style={[ty.h2, { color: t.ink }]}>Filters</Text>
          <Pressable onPress={() => onChange({})}>
            <Text style={[ty.small, { color: t.accentDeep, fontFamily: "Inter_700Bold" }]}>Reset</Text>
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 520 }}>
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

          <View style={{ marginTop: space.xl }}>
            <Button title={resultCount !== undefined ? `Show ${resultCount} places` : "Done"} onPress={onClose} />
          </View>
        </ScrollView>
    </Sheet>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: on ? t.ink : "transparent",
        borderWidth: 1,
        borderColor: on ? t.ink : t.line,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: on ? t.onInk : t.ink, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}
