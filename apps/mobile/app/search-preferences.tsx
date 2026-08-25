import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import {
  type CategoryKey,
  SearchDefaultDetail,
} from "@/components/SearchDefaultDetail";
import {
  useCurrentUser,
  useMyPreferences,
  useUpdateMyPreferences,
} from "@/lib/api/hooks";
import type { ConsumerPreferences } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, ScreenHeader } from "@/ui/kit";

/**
 * Search defaults — the filters every search starts from, saved server-side.
 *
 * A hub-and-detail layout: the hub lists each preference category with its
 * current value; tapping opens a full-screen picker (SearchDefaultDetail). Edits
 * are live on a local draft; "Save changes" commits to the server. The Explore
 * tab seeds its per-search filters from these on open.
 */

type MCIName = keyof typeof MaterialCommunityIcons.glyphMap;

const POSTURE_LABEL: Record<string, string> = {
  FULLY_HALAL: "Fully halal",
  MIXED_SEPARATE_KITCHENS: "Separate kitchen",
  HALAL_OPTIONS_ADVERTISED: "Halal options",
  HALAL_UPON_REQUEST: "On request",
  MIXED_SHARED_KITCHEN: "Shared kitchen",
};

function trustValue(p: ConsumerPreferences): string {
  if (p.min_validation_tier === "TRUST_HALAL_VERIFIED") return "Verified";
  if (p.min_validation_tier === "CERTIFICATE_ON_FILE") return "Certified";
  return "Any claim";
}
function trustDesc(p: ConsumerPreferences): string {
  if (p.min_validation_tier === "TRUST_HALAL_VERIFIED")
    return "Only show places verified in person by the Trust Halal community.";
  if (p.min_validation_tier === "CERTIFICATE_ON_FILE")
    return "Only places with a valid halal certificate on file.";
  return "All places with any halal claim, including self-attested.";
}
function restaurantValue(p: ConsumerPreferences): string {
  return p.min_menu_posture ? POSTURE_LABEL[p.min_menu_posture] : "No preference";
}
function restaurantDesc(p: ConsumerPreferences): string {
  switch (p.min_menu_posture) {
    case "FULLY_HALAL":
      return "Restaurants that are 100% halal throughout the menu.";
    case "MIXED_SEPARATE_KITCHENS":
      return "Halal kept separate from non-halal in the kitchen.";
    case "HALAL_OPTIONS_ADVERTISED":
      return "Some halal items on an otherwise mixed menu.";
    case "HALAL_UPON_REQUEST":
      return "Halal available when you ask the staff.";
    case "MIXED_SHARED_KITCHEN":
      return "Halal proteins cooked on shared equipment.";
    default:
      return "Any level of halal menu coverage.";
  }
}
function chickenValue(p: ConsumerPreferences): string {
  const v = (p.chicken_slaughter ?? [])[0];
  if (v === "HAND_CUT") return "Hand-slaughtered";
  if (v === "MACHINE_CUT") return "Machine-slaughtered";
  return "No preference";
}
function redMeatValue(p: ConsumerPreferences): string {
  const arr = p.beef_zabihah ?? [];
  if (!arr.includes("ZABIHAH")) return "No preference";
  return arr.includes("UNSURE") ? "Zabihah + unsure" : "Zabihah only";
}
function dietaryActive(p: ConsumerPreferences): string[] {
  return [
    p.no_pork ? "Pork-free" : null,
    p.no_alcohol_served ? "No alcohol" : null,
    p.has_certification ? "Certificate on file" : null,
  ].filter(Boolean) as string[];
}
function dietaryValue(p: ConsumerPreferences): string {
  const a = dietaryActive(p);
  return a.length ? a.join(", ") : "None set";
}

type Cat = {
  key: CategoryKey;
  n: number;
  icon: MCIName;
  title: string;
  short: string; // summary-strip value
  stripLabel: string; // summary-strip caption
  value: (p: ConsumerPreferences) => string;
  desc: (p: ConsumerPreferences) => string;
};

const CATS: Cat[] = [
  {
    key: "trust",
    n: 1,
    icon: "shield-check-outline",
    title: "Trust level required",
    stripLabel: "Trust level",
    short: "",
    value: trustValue,
    desc: trustDesc,
  },
  {
    key: "restaurant",
    n: 2,
    icon: "silverware-fork-knife",
    title: "Restaurant type",
    stripLabel: "Restaurant type",
    short: "",
    value: restaurantValue,
    desc: restaurantDesc,
  },
  {
    key: "chicken",
    n: 3,
    icon: "food-drumstick-outline",
    title: "Chicken preference",
    stripLabel: "Chicken",
    short: "",
    value: chickenValue,
    desc: () => "Your preferred preparation for chicken dishes.",
  },
  {
    key: "redmeat",
    n: 4,
    icon: "food-steak",
    title: "Red meat preference",
    stripLabel: "Red meat",
    short: "",
    value: redMeatValue,
    desc: () => "Beef, lamb and goat slaughter preference.",
  },
  {
    key: "dietary",
    n: 5,
    icon: "leaf",
    title: "Dietary preferences",
    stripLabel: "Preferences",
    short: "",
    value: dietaryValue,
    desc: () => "Additional dietary and evidence preferences.",
  },
];

/** Short value for the summary strip at the top. */
function stripValue(cat: Cat, p: ConsumerPreferences): string {
  switch (cat.key) {
    case "trust":
      return trustValue(p);
    case "restaurant":
      return p.min_menu_posture ? POSTURE_LABEL[p.min_menu_posture] : "Any";
    case "chicken": {
      const v = (p.chicken_slaughter ?? [])[0];
      return v === "HAND_CUT" ? "Hand-cut" : v === "MACHINE_CUT" ? "Machine-cut" : "Any";
    }
    case "redmeat":
      return (p.beef_zabihah ?? []).includes("ZABIHAH") ? "Zabihah" : "Any";
    case "dietary": {
      const n = dietaryActive(p).length;
      return n ? `${n} dietary` : "None";
    }
  }
}

function SummaryStrip({ draft }: { draft: ConsumerPreferences }) {
  const t = useTheme();
  return (
    <Card style={{ padding: 16, gap: 14 }}>
      <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 17 }}>Your default search</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row" }}>
          {CATS.map((cat, i) => (
            <View key={cat.key} style={{ flexDirection: "row" }}>
              <View style={{ width: 92, alignItems: "center", gap: 6, paddingHorizontal: 4 }}>
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 23,
                    backgroundColor: t.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MaterialCommunityIcons name={cat.icon} size={22} color={t.accentDeep} />
                </View>
                <Text
                  numberOfLines={1}
                  style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 12.5, textAlign: "center" }}
                >
                  {stripValue(cat, draft)}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: t.sub, fontFamily: "Inter_500Medium", fontSize: 11, textAlign: "center" }}
                >
                  {cat.stripLabel}
                </Text>
              </View>
              {i < CATS.length - 1 ? (
                <View style={{ width: 1, backgroundColor: t.line, marginVertical: 6 }} />
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </Card>
  );
}

function HubRow({
  cat,
  draft,
  onPress,
}: {
  cat: Cat;
  draft: ConsumerPreferences;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress}>
      <Card style={{ padding: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: t.zincSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialCommunityIcons name={cat.icon} size={24} color={t.ink} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 17 }}>
              {cat.n}. {cat.title}
            </Text>
            <Text style={{ color: t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 14 }}>
              {cat.value(draft)}
            </Text>
            <Text style={[ty.small, { color: t.sub, fontSize: 13, lineHeight: 18 }]}>{cat.desc(draft)}</Text>
          </View>
          <Feather name="chevron-right" size={22} color={t.sub} />
        </View>
      </Card>
    </Pressable>
  );
}

export default function SearchPreferences() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const signedIn = Boolean(me);

  const prefs = useMyPreferences(signedIn);
  const save = useUpdateMyPreferences();

  const [draft, setDraft] = useState<ConsumerPreferences>({});
  const [dirty, setDirty] = useState(false);
  const [openCat, setOpenCat] = useState<CategoryKey | null>(null);

  // Snapshot captured when a detail opens, so Cancel can revert its live edits.
  const snapshot = useRef<{ draft: ConsumerPreferences; dirty: boolean } | null>(null);

  useEffect(() => {
    if (prefs.data && !dirty) setDraft(prefs.data);
  }, [prefs.data, dirty]);

  const set = (patch: Partial<ConsumerPreferences>) => {
    setDirty(true);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const openDetail = (key: CategoryKey) => {
    snapshot.current = { draft, dirty };
    setOpenCat(key);
  };
  const closeDetail = (revert: boolean) => {
    if (revert && snapshot.current) {
      setDraft(snapshot.current.draft);
      setDirty(snapshot.current.dirty);
    }
    snapshot.current = null;
    setOpenCat(null);
  };

  const shell = (children: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          padding: space.lg,
          paddingBottom: 60,
          gap: space.md,
        }}
      >
        <ScreenHeader title="Search defaults" onBack={() => router.back()} />
        {children}
      </ScrollView>
    </View>
  );

  if (!signedIn) {
    return shell(
      <Card style={{ padding: space.lg, gap: 10 }}>
        <Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Sign in to save your defaults</Text>
        <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
          Saved defaults follow your account, so the same filters apply on the web and on a new phone. You
          can still set filters per-search from the Explore tab without an account.
        </Text>
        <Button title="Sign in" onPress={() => router.push("/(auth)/sign-in")} />
      </Card>,
    );
  }

  if (prefs.isLoading) {
    return shell(
      <View style={{ paddingVertical: 40, alignItems: "center" }}>
        <ActivityIndicator color={t.accent} />
      </View>,
    );
  }

  return (
    <>
      {shell(
        <>
          <Text style={[ty.small, { color: t.sub, lineHeight: 20, fontSize: 14 }]}>
            These preferences are used every time you search. You can change them for any individual
            search.
          </Text>

          <SummaryStrip draft={draft} />

          <View style={{ gap: space.md, marginTop: 4 }}>
            {CATS.map((cat) => (
              <HubRow key={cat.key} cat={cat} draft={draft} onPress={() => openDetail(cat.key)} />
            ))}
          </View>

          <View style={{ marginTop: space.md, gap: space.sm }}>
            <Button
              title={save.isPending ? "Saving…" : "Save changes"}
              icon="save"
              variant="accent"
              onPress={() => save.mutate(draft, { onSuccess: () => setDirty(false) })}
              disabled={save.isPending || !dirty}
            />
            {save.isError ? (
              <Text style={[ty.small, { color: t.danger ?? "#DC2626", textAlign: "center" }]}>
                Couldn&rsquo;t save. Check your connection and try again.
              </Text>
            ) : (
              <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
                {dirty ? "Unsaved changes." : "Changes will apply to all new searches."}
              </Text>
            )}
          </View>
        </>,
      )}

      <SearchDefaultDetail category={openCat} draft={draft} set={set} onClose={closeDetail} />
    </>
  );
}
