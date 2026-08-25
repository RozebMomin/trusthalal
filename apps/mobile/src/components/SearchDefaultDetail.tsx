import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import type { ConsumerPreferences } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

/** The five editable categories on the Search defaults hub. */
export type CategoryKey =
  | "trust"
  | "restaurant"
  | "chicken"
  | "redmeat"
  | "dietary";

type MCIName = keyof typeof MaterialCommunityIcons.glyphMap;

/** One selectable option in a detail page — the big radio/checkbox card. */
export function OptionCard({
  icon,
  title,
  recommended,
  desc,
  tag,
  tagIcon,
  on,
  kind,
  onPress,
}: {
  icon?: MCIName;
  title: string;
  recommended?: boolean;
  desc: string;
  tag?: string;
  tagIcon?: MCIName;
  on: boolean;
  kind: "radio" | "check";
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={kind === "radio" ? "radio" : "checkbox"}
      accessibilityState={kind === "radio" ? { selected: on } : { checked: on }}
      style={{
        flexDirection: "row",
        gap: 14,
        backgroundColor: on ? t.accentSoft : t.card,
        borderRadius: radii.xl,
        borderWidth: 1.5,
        borderColor: on ? t.accent : "transparent",
        padding: 16,
      }}
    >
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={30}
          color={on ? t.accentDeep : t.ink}
          style={{ marginTop: 2 }}
        />
      ) : null}
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 18 }}>{title}</Text>
        {recommended ? (
          <Text style={{ color: t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 13 }}>
            Recommended
          </Text>
        ) : null}
        <Text style={[ty.small, { color: t.sub, fontSize: 13.5, lineHeight: 19 }]}>{desc}</Text>
        {tag ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              alignSelf: "flex-start",
              marginTop: 4,
              backgroundColor: t.zincSoft,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}
          >
            {tagIcon ? <MaterialCommunityIcons name={tagIcon} size={13} color={t.sub} /> : null}
            <Text style={{ color: t.sub, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>{tag}</Text>
          </View>
        ) : null}
      </View>
      {/* Selection indicator */}
      {kind === "radio" ? (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: on ? t.accent : t.line,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 2,
          }}
        >
          {on ? (
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.accent }} />
          ) : null}
        </View>
      ) : (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            borderWidth: on ? 0 : 2,
            borderColor: t.line,
            backgroundColor: on ? t.accent : "transparent",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 2,
          }}
        >
          {on ? <Feather name="check" size={15} color={t.onAccent} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** A small "Also include…" subordinate checkbox row (e.g. include unsure). */
function SubCheck({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: t.card,
        borderRadius: radii.xl,
        padding: 16,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          borderWidth: on ? 0 : 2,
          borderColor: t.line,
          backgroundColor: on ? t.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on ? <Feather name="check" size={15} color={t.onAccent} /> : null}
      </View>
      <Text style={{ color: t.ink, fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1, lineHeight: 19 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const TITLES: Record<CategoryKey, { n: number; title: string; subtitle: string }> = {
  trust: {
    n: 1,
    title: "Trust level required",
    subtitle: "Choose the minimum level of proof you want to see in your search results.",
  },
  restaurant: {
    n: 2,
    title: "Restaurant type",
    subtitle: "Choose how much of the menu needs to be halal.",
  },
  chicken: {
    n: 3,
    title: "Chicken preference",
    subtitle: "Your preferred preparation for chicken dishes.",
  },
  redmeat: {
    n: 4,
    title: "Red meat preference",
    subtitle: "How beef, lamb and goat should be slaughtered.",
  },
  dietary: {
    n: 5,
    title: "Dietary preferences",
    subtitle: "Additional dietary and evidence preferences. Pick any that apply.",
  },
};

/**
 * The full-screen detail editor for one Search-defaults category. Slides in over
 * the hub. Edits are live on the shared draft; Cancel restores the snapshot the
 * modal captured on open, Save just closes (the hub's "Save changes" persists).
 */
export function SearchDefaultDetail({
  category,
  draft,
  set,
  onClose,
}: {
  category: CategoryKey | null;
  draft: ConsumerPreferences;
  set: (patch: Partial<ConsumerPreferences>) => void;
  /** Called with `revert=true` when the user cancels. */
  onClose: (revert: boolean) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [diffOpen, setDiffOpen] = useState(false);

  const tx = useRef(new Animated.Value(60)).current;
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (category) {
      tx.setValue(60);
      op.setValue(0);
      Animated.parallel([
        Animated.timing(tx, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    }
  }, [category, tx, op]);

  if (!category) return null;
  const meta = TITLES[category];

  const setRedMeat = (v: ConsumerPreferences["beef_zabihah"]) =>
    set({ beef_zabihah: v, lamb_zabihah: v, goat_zabihah: v });

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => onClose(true)} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: t.bg, opacity: op, transform: [{ translateX: tx }] }}>
        <View style={{ flex: 1, paddingTop: insets.top + space.md }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 24, gap: 12 }}>
            <Pressable
              onPress={() => onClose(true)}
              hitSlop={10}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
            >
              <Feather name="chevron-left" size={20} color={t.accentDeep} />
              <Text style={[ty.label, { color: t.accentDeep, fontSize: 15 }]}>Back</Text>
            </Pressable>
            <Text style={[ty.title, { color: t.ink, fontSize: 28, lineHeight: 32, marginTop: 6 }]}>
              {meta.n}. {meta.title}
            </Text>
            <Text style={[ty.small, { color: t.sub, fontSize: 14, lineHeight: 20, marginBottom: 4 }]}>
              {meta.subtitle}
            </Text>

            {category === "trust" ? <TrustOptions draft={draft} set={set} /> : null}
            {category === "restaurant" ? <RestaurantOptions draft={draft} set={set} /> : null}
            {category === "chicken" ? <ChickenOptions draft={draft} set={set} /> : null}
            {category === "redmeat" ? <RedMeatOptions draft={draft} setRedMeat={setRedMeat} /> : null}
            {category === "dietary" ? <DietaryOptions draft={draft} set={set} /> : null}

            {category === "trust" ? (
              <>
                <Pressable
                  onPress={() => setDiffOpen((v) => !v)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    backgroundColor: t.zincSoft,
                    borderRadius: radii.xl,
                    padding: 16,
                    marginTop: 4,
                  }}
                >
                  <Feather name="info" size={20} color={t.sub} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 15 }}>
                      What&rsquo;s the difference?
                    </Text>
                    <Text style={[ty.small, { color: t.sub, fontSize: 13, lineHeight: 18, marginTop: 2 }]}>
                      Higher trust levels mean fewer results, but greater confidence that a place is truly halal.
                    </Text>
                  </View>
                  <Feather name={diffOpen ? "chevron-up" : "chevron-down"} size={20} color={t.sub} />
                </Pressable>
                {diffOpen ? (
                  <View style={{ gap: 12, marginTop: 4 }}>
                    <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 17 }}>Examples</Text>
                    <ExampleRow icon="account-check" title="Verified" desc="A Trust Halal member visited and confirmed in person." />
                    <ExampleRow icon="certificate" title="Certified" desc="The restaurant provided a valid halal certificate." />
                    <ExampleRow icon="clipboard-check-outline" title="Any claim" desc="The restaurant self-identifies as halal." />
                  </View>
                ) : null}
              </>
            ) : null}
          </ScrollView>

          {/* Pinned footer */}
          <View
            style={{
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: insets.bottom + space.sm,
              borderTopWidth: 1,
              borderTopColor: t.line,
              gap: 6,
            }}
          >
            <Button title="Save selection" variant="accent" onPress={() => onClose(false)} />
            <Button title="Cancel" variant="secondary" onPress={() => onClose(true)} />
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

function ExampleRow({ icon, title, desc }: { icon: MCIName; title: string; desc: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: t.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MaterialCommunityIcons name={icon} size={20} color={t.accentDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 14 }}>{title}</Text>
        <Text style={[ty.small, { color: t.sub, fontSize: 13, lineHeight: 18 }]}>{desc}</Text>
      </View>
    </View>
  );
}

// --- Per-category option lists -------------------------------------------

function TrustOptions({
  draft,
  set,
}: {
  draft: ConsumerPreferences;
  set: (p: Partial<ConsumerPreferences>) => void;
}) {
  const v = draft.min_validation_tier;
  return (
    <View style={{ gap: 8 }}>
      <OptionCard
        icon="shield-check"
        title="Verified"
        recommended
        desc="Only show places verified in person by a Trust Halal community member."
        tag="Highest trust"
        tagIcon="account-group"
        kind="radio"
        on={v === "TRUST_HALAL_VERIFIED"}
        onPress={() => set({ min_validation_tier: "TRUST_HALAL_VERIFIED" })}
      />
      <OptionCard
        icon="certificate"
        title="Certified"
        desc="Only show places with a valid halal certificate from a recognized certifying body."
        tag="Third-party certified"
        tagIcon="shield-check-outline"
        kind="radio"
        on={v === "CERTIFICATE_ON_FILE"}
        onPress={() => set({ min_validation_tier: "CERTIFICATE_ON_FILE" })}
      />
      <OptionCard
        icon="magnify"
        title="Any claim"
        desc="Show all places with any halal claim, including self-attested."
        tag="Most results"
        tagIcon="information-outline"
        kind="radio"
        on={!v}
        onPress={() => set({ min_validation_tier: null })}
      />
    </View>
  );
}

const RESTAURANT_OPTIONS: Array<{ v: ConsumerPreferences["min_menu_posture"]; title: string; desc: string }> = [
  { v: "FULLY_HALAL", title: "Fully halal", desc: "Restaurants that are 100% halal throughout the menu." },
  { v: "MIXED_SEPARATE_KITCHENS", title: "Separate kitchen", desc: "Halal prepared in a kitchen kept separate from non-halal." },
  { v: "HALAL_OPTIONS_ADVERTISED", title: "Halal options", desc: "Some halal items on an otherwise mixed menu." },
  { v: "HALAL_UPON_REQUEST", title: "On request", desc: "Halal available when you ask the staff." },
  { v: "MIXED_SHARED_KITCHEN", title: "Shared kitchen", desc: "Halal proteins cooked on equipment shared with non-halal." },
];

function RestaurantOptions({
  draft,
  set,
}: {
  draft: ConsumerPreferences;
  set: (p: Partial<ConsumerPreferences>) => void;
}) {
  const v = draft.min_menu_posture;
  return (
    <View style={{ gap: 8 }}>
      {RESTAURANT_OPTIONS.map((o) => (
        <OptionCard
          key={o.v}
          title={o.title}
          desc={o.desc}
          kind="radio"
          on={v === o.v}
          onPress={() => set({ min_menu_posture: o.v })}
        />
      ))}
      <OptionCard
        title="No preference"
        desc="Show every level of halal menu coverage."
        kind="radio"
        on={!v}
        onPress={() => set({ min_menu_posture: null })}
      />
    </View>
  );
}

function ChickenOptions({
  draft,
  set,
}: {
  draft: ConsumerPreferences;
  set: (p: Partial<ConsumerPreferences>) => void;
}) {
  const arr = draft.chicken_slaughter ?? [];
  const val = arr[0];
  return (
    <View style={{ gap: 8 }}>
      <OptionCard
        title="Hand-slaughtered"
        desc="Only chicken slaughtered by hand."
        kind="radio"
        on={val === "HAND_CUT"}
        onPress={() => set({ chicken_slaughter: ["HAND_CUT"] })}
      />
      <OptionCard
        title="Machine-slaughtered"
        desc="Only chicken slaughtered by machine."
        kind="radio"
        on={val === "MACHINE_CUT"}
        onPress={() => set({ chicken_slaughter: ["MACHINE_CUT"] })}
      />
      <OptionCard
        title="No preference"
        desc="Show chicken slaughtered either way."
        kind="radio"
        on={!val}
        onPress={() => set({ chicken_slaughter: null })}
      />
    </View>
  );
}

function RedMeatOptions({
  draft,
  setRedMeat,
}: {
  draft: ConsumerPreferences;
  setRedMeat: (v: ConsumerPreferences["beef_zabihah"]) => void;
}) {
  const arr = draft.beef_zabihah ?? [];
  const zab = arr.includes("ZABIHAH");
  const unsure = arr.includes("UNSURE");
  return (
    <View style={{ gap: 8 }}>
      <OptionCard
        title="Zabihah only"
        desc="Beef, lamb and goat must be zabihah halal."
        kind="radio"
        on={zab}
        onPress={() => setRedMeat(unsure ? ["ZABIHAH", "UNSURE"] : ["ZABIHAH"])}
      />
      <OptionCard
        title="No preference"
        desc="Show red meat regardless of zabihah status."
        kind="radio"
        on={!zab}
        onPress={() => setRedMeat(null)}
      />
      {zab ? (
        <SubCheck
          label="Also show places whose zabihah status is unconfirmed"
          on={unsure}
          onPress={() => setRedMeat(unsure ? ["ZABIHAH"] : ["ZABIHAH", "UNSURE"])}
        />
      ) : null}
    </View>
  );
}

function DietaryOptions({
  draft,
  set,
}: {
  draft: ConsumerPreferences;
  set: (p: Partial<ConsumerPreferences>) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <OptionCard
        title="Pork-free"
        desc="No pork anywhere on the menu."
        kind="check"
        on={!!draft.no_pork}
        onPress={() => set({ no_pork: draft.no_pork ? null : true })}
      />
      <OptionCard
        title="No alcohol served"
        desc="The kitchen and floor serve no alcohol."
        kind="check"
        on={!!draft.no_alcohol_served}
        onPress={() => set({ no_alcohol_served: draft.no_alcohol_served ? null : true })}
      />
      <OptionCard
        title="Certificate on file"
        desc="A halal certificate is on record for the place."
        kind="check"
        on={!!draft.has_certification}
        onPress={() => set({ has_certification: draft.has_certification ? null : true })}
      />
    </View>
  );
}
